import { useCallback, useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { useI18n } from "@/i18n";
import {
  createAgentSession,
  agentChat,
  agentAnswerQuestion,
  type AgentSession,
} from "@/api/client";
import type { PendingQuestionData, SseAgentStepData } from "@/types/sse";
import AskUserQuestion from "@/components/AskUserQuestion";
import AgentStepDisplay from "@/components/AgentStepDisplay";
import type { Chapter } from "@/types";

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface AiAssistantFloatingProps {
  novelId?: number;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
}

const POSITION_KEY = "inkmind_ai_position";
const DEFAULT_POSITION = { x: -16, y: 72 };
const PANEL_SIZE_KEY = "inkmind_ai_panel_size";
const DEFAULT_PANEL_SIZE = { width: 520, height: 780 };
const MIN_PANEL_SIZE = { width: 340, height: 400 };
const SESSION_KEY = "inkmind_agent_session";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return fallback;
}

function saveJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function AiAssistantMark({ className = "" }: { className?: string }) {
  return (
    <span className={`ai-assistant-mark ${className}`} aria-hidden="true">
      <span className="ai-assistant-mark__spark ai-assistant-mark__spark--top" />
      <span className="ai-assistant-mark__spark ai-assistant-mark__spark--side" />
      <span className="ai-assistant-mark__cursor" />
    </span>
  );
}

export default function AiAssistantFloating({ novelId }: AiAssistantFloatingProps) {
  const { t } = useI18n();

  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [agentSteps, setAgentSteps] = useState<SseAgentStepData[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestionData | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initializedRef = useRef(false);
  const activeAssistantIdRef = useRef<string>("");

  const [position, setPosition] = useState(() => loadJson(POSITION_KEY, DEFAULT_POSITION));
  const [panelSize, setPanelSize] = useState(() => loadJson(PANEL_SIZE_KEY, DEFAULT_PANEL_SIZE));
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number; px: number; py: number; corner: string } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentSteps]);

  useEffect(() => {
    if (!isOpen || !novelId || initializedRef.current) return;
    initializedRef.current = true;
    const stored = loadJson<{ session_id: string; novel_id: number } | null>(`${SESSION_KEY}_${novelId}`, null);
    if (stored?.session_id && stored.novel_id === novelId) {
      setSession(stored as AgentSession);
    }
  }, [isOpen, novelId]);

  const ensureSession = useCallback(async () => {
    if (session) return session;
    return await createNewSession();
  }, [session, novelId]);

  const createNewSession = useCallback(async () => {
    const s = await createAgentSession(novelId!);
    setSession(s);
    saveJson(`${SESSION_KEY}_${novelId}`, s);
    return s;
  }, [novelId]);

  const resetSession = useCallback(() => {
    setSession(null);
    try { localStorage.removeItem(`${SESSION_KEY}_${novelId}`); } catch { /* ignore */ }
  }, [novelId]);

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { x: cx, y: cy, px: position.x, py: position.y };
    setIsDragging(true);
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;
      const cx = "touches" in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const cy = "touches" in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const nx = Math.min(-16, Math.max(-(window.innerWidth - 100), dragRef.current.px + cx - dragRef.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 100, dragRef.current.py + cy - dragRef.current.y));
      setPosition({ x: nx, y: ny });
    };
    const onUp = () => { setIsDragging(false); saveJson(POSITION_KEY, position); dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, [isDragging, position]);

  const handleResizeStart = useCallback((corner: string) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    resizeRef.current = { x: cx, y: cy, w: panelSize.width, h: panelSize.height, px: position.x, py: position.y, corner };
    setIsResizing(true);
  }, [panelSize, position]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!resizeRef.current) return;
      const cx = "touches" in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const cy = "touches" in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const ref = resizeRef.current;
      const dx = cx - ref.x;
      const dy = cy - ref.y;

      let nw = ref.w;
      let nh = ref.h;
      let nx = ref.px;
      let ny = ref.py;

      if (ref.corner === "se") {
        nw = Math.max(MIN_PANEL_SIZE.width, Math.min(window.innerWidth - 50, ref.w + dx));
        nh = Math.max(MIN_PANEL_SIZE.height, Math.min(window.innerHeight - 100, ref.h + dy));
        nx = ref.px + dx;
      } else if (ref.corner === "sw") {
        nw = Math.max(MIN_PANEL_SIZE.width, Math.min(window.innerWidth - 50, ref.w - dx));
        nh = Math.max(MIN_PANEL_SIZE.height, Math.min(window.innerHeight - 100, ref.h + dy));
      } else if (ref.corner === "ne") {
        nw = Math.max(MIN_PANEL_SIZE.width, Math.min(window.innerWidth - 50, ref.w + dx));
        nh = Math.max(MIN_PANEL_SIZE.height, Math.min(window.innerHeight - 100, ref.h - dy));
        nx = ref.px + dx;
        ny = ref.py + dy;
      } else if (ref.corner === "nw") {
        nw = Math.max(MIN_PANEL_SIZE.width, Math.min(window.innerWidth - 50, ref.w - dx));
        nh = Math.max(MIN_PANEL_SIZE.height, Math.min(window.innerHeight - 100, ref.h - dy));
        ny = ref.py + dy;
      }

      setPanelSize({ width: nw, height: nh });
      setPosition({ x: nx, y: ny });
    };
    const onUp = () => { setIsResizing(false); saveJson(PANEL_SIZE_KEY, panelSize); saveJson(POSITION_KEY, position); resizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, [isResizing, panelSize, position]);

  const buildChatHandlers = useCallback((aid: string) => {
    activeAssistantIdRef.current = aid;
    return {
      onPatch: (data: any) => {
        if (data.message?.role === "assistant") {
          const currentAid = activeAssistantIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === currentAid ? { ...m, content: data.message?.content || "", isStreaming: data.message?.is_streaming } : m));
        }
      },
      onDelta: (data: any) => {
        if (data.type === "text" && data.content) {
          const currentAid = activeAssistantIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === currentAid ? { ...m, content: m.content + data.content } : m));
        }
      },
      onAgentStep: (data: any) => {
        console.log("[AgentStep]", data.step_type, data.tool_name);
        setAgentSteps((prev) => [...prev, data]);
      },
      onQuestion: (data: any) => {
        console.log("[Question]", data.question, data.options);
        setPendingQuestion(data);
      },
      onChapterSaved: (data: any) => {
        console.log("[ChapterSaved]", data.id, data.title);
        window.dispatchEvent(new CustomEvent("inkmind:chapter-saved", { detail: data }));
      },
      onChapterDeleted: (data: any) => {
        console.log("[ChapterDeleted]", data.id, data.title);
        window.dispatchEvent(new CustomEvent("inkmind:chapter-deleted", { detail: data }));
      },
      onStatus: (data: any) => {
        const s = data.status || "idle";
        setStatus(s);
        if (s === "waiting_for_user") {
          setIsLoading(false);
        } else if (s === "idle") {
          setIsLoading(false);
        }
      },
      onDone: () => {
        const currentAid = activeAssistantIdRef.current;
        setMessages((prev) => prev.map((m) => m.id === currentAid ? { ...m, isStreaming: false } : m));
        setAgentSteps((prev) => [...prev, { step_type: "finish" as const, is_parallel: false, ts: Date.now() }]);
        setIsLoading(false);
      },
      onError: (data: any) => {
        const currentAid = activeAssistantIdRef.current;
        setMessages((prev) => [
          ...prev.map((m) => m.id === currentAid ? { ...m, isStreaming: false } : m),
          { id: generateId(), role: "error", content: data.message, timestamp: Date.now() },
        ]);
        setIsLoading(false);
      },
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !novelId) return;

    setInput("");
    setIsLoading(true);
    setPendingQuestion(null);
    setAgentSteps([]);

    setMessages((prev) => [...prev, { id: generateId(), role: "user", content: text, timestamp: Date.now() }]);

    try {
      const cur = await ensureSession();
      const aid = generateId();
      setMessages((prev) => [...prev, { id: aid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true }]);

      const handlers = buildChatHandlers(aid);
      const retryOnError: typeof handlers = {
        ...handlers,
        onError: async (data: any) => {
          const msg = data.message || "";
          if (msg.includes("会话不存在") || msg.includes("not found")) {
            resetSession();
            try {
              const newSess = await createNewSession();
              const retryHandlers = buildChatHandlers(aid);
              await agentChat(novelId, newSess.session_id, text, retryHandlers);
            } catch {
              setMessages((prev) => [...prev, { id: generateId(), role: "error", content: "创建新会话失败", timestamp: Date.now() }]);
              setIsLoading(false);
            }
          } else {
            handlers.onError(data);
          }
        },
      };

      await agentChat(novelId, cur.session_id, text, retryOnError);
    } catch (err) {
      setMessages((prev) => [...prev, { id: generateId(), role: "error", content: err instanceof Error ? err.message : "连接失败", timestamp: Date.now() }]);
      setIsLoading(false);
    }
  }, [input, isLoading, novelId, ensureSession, resetSession, createNewSession, buildChatHandlers]);

  const handleAnswerQuestion = useCallback(async (questionId: string, answer: string, selectedOption?: string) => {
    if (!session || !pendingQuestion) return;
    setPendingQuestion(null);
    setIsLoading(true);
    const answerText = selectedOption || answer;
    setMessages((prev) => [...prev, { id: generateId(), role: "user", content: answerText, timestamp: Date.now() }]);

    const newAid = generateId();
    activeAssistantIdRef.current = newAid;
    setMessages((prev) => [...prev, { id: newAid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true }]);

    try {
      await agentAnswerQuestion(novelId!, session.session_id, questionId, answer, selectedOption);
    } catch (err) {
      setMessages((prev) => [...prev, { id: generateId(), role: "error", content: err instanceof Error ? err.message : "连接失败", timestamp: Date.now() }]);
      setIsLoading(false);
    }
  }, [session, pendingQuestion, novelId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="ai-assistant-float-btn"
          style={{ right: `${Math.abs(position.x)}px`, top: `${position.y}px`, transform: isDragging ? "scale(1.05)" : undefined }}
          onClick={() => setIsOpen(true)}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          title={t("smart_writer_title")}
        >
          <AiAssistantMark />
          <span className="ai-assistant-float-btn__label">{t("smart_writer_title")}</span>
        </button>
      )}

      {isOpen && (
        <div
          className="ai-assistant-panel"
          style={{
            right: `${Math.abs(position.x)}px`,
            top: `${position.y}px`,
            width: `min(${panelSize.width}px, calc(100vw - 24px))`,
            height: `min(${panelSize.height}px, calc(100vh - 24px))`,
            maxHeight: "calc(100vh - 88px)",
          }}
        >
          <div className="ai-assistant-header" onMouseDown={handleDragStart} onTouchStart={handleDragStart} style={{ cursor: "grab" }}>
            <div className="ai-assistant-header__title">
              <AiAssistantMark className="ai-assistant-mark--header" />
              <span>{t("smart_writer_title")}</span>
              {status === "running" && <span className="ai-assistant-header__status-dot" />}
            </div>
            <button type="button" className="ai-assistant-header__close" onClick={() => setIsOpen(false)}>×</button>
          </div>

          {agentSteps.length > 0 && (
            <div className="agent-steps-container">
              <AgentStepDisplay steps={agentSteps} />
            </div>
          )}

          <div className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-welcome">
                <div className="agent-welcome__icon"><AiAssistantMark /></div>
                <p className="agent-welcome__text">{t("smart_writer_welcome")}</p>
              </div>
            )}
            {messages.map((msg) => {
              if (msg.role === "assistant" && msg.isStreaming && !msg.content.trim()) {
                return null;
              }
              return (
              <div key={msg.id} className={`agent-message agent-message-${msg.role}`}>
                {msg.role === "user" ? (
                  <div className="agent-message-content agent-message-content--user">{msg.content}</div>
                ) : msg.role === "error" ? (
                  <div className="agent-message-content agent-message-content--error">{msg.content}</div>
                ) : (
                  <div className="agent-message-content agent-message-content--assistant">
                    <div className="agent-message-avatar">
                      <AiAssistantMark className="ai-assistant-mark--avatar" />
                    </div>
                    <div className="agent-message-body">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                      {msg.isStreaming && msg.content.trim() && <span className="agent-cursor">▊</span>}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {pendingQuestion && (
            <div className="agent-question-container">
              <AskUserQuestion question={pendingQuestion} onAnswer={handleAnswerQuestion} disabled={isLoading} />
            </div>
          )}

          <div className="agent-input-container">
            <textarea
              ref={inputRef}
              className="agent-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("agent_chat_placeholder")}
              disabled={isLoading}
            />
            <button
              className="agent-send-btn"
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              aria-label={t("agent_chat_send")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>

          <div
            className="ai-assistant-panel__resize ai-assistant-panel__resize--nw"
            onMouseDown={handleResizeStart("nw")}
            onTouchStart={handleResizeStart("nw")}
          />
          <div
            className="ai-assistant-panel__resize ai-assistant-panel__resize--ne"
            onMouseDown={handleResizeStart("ne")}
            onTouchStart={handleResizeStart("ne")}
          />
          <div
            className="ai-assistant-panel__resize ai-assistant-panel__resize--sw"
            onMouseDown={handleResizeStart("sw")}
            onTouchStart={handleResizeStart("sw")}
          />
          <div
            className="ai-assistant-panel__resize ai-assistant-panel__resize--se"
            onMouseDown={handleResizeStart("se")}
            onTouchStart={handleResizeStart("se")}
          />
        </div>
      )}
    </>
  );
}
