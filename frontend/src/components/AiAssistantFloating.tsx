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

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_novel_state: "agent_tool_get_novel_state",
  get_chapters: "agent_tool_get_chapters",
  get_chapter_detail: "agent_tool_get_chapter_detail",
  get_characters: "agent_tool_get_characters",
  get_memos: "agent_tool_get_memos",
  dispatch_generation_task: "agent_tool_dispatch_generation_task",
  poll_task_result: "agent_tool_poll_task_result",
  poll_multiple_tasks: "agent_tool_poll_multiple_tasks",
  save_chapter: "agent_tool_save_chapter",
  ask_user: "agent_tool_ask_user",
};

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

  const [position, setPosition] = useState(() => loadJson(POSITION_KEY, DEFAULT_POSITION));
  const [panelSize, setPanelSize] = useState(() => loadJson(PANEL_SIZE_KEY, DEFAULT_PANEL_SIZE));
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

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
    const s = await createAgentSession(novelId!);
    setSession(s);
    saveJson(`${SESSION_KEY}_${novelId}`, s);
    return s;
  }, [session, novelId]);

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

  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    resizeRef.current = { x: cx, y: cy, w: panelSize.width, h: panelSize.height };
    setIsResizing(true);
  }, [panelSize]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!resizeRef.current) return;
      const cx = "touches" in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const cy = "touches" in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const nw = Math.max(MIN_PANEL_SIZE.width, Math.min(window.innerWidth - 50, resizeRef.current.w - (cx - resizeRef.current.x)));
      const nh = Math.max(MIN_PANEL_SIZE.height, Math.min(window.innerHeight - 100, resizeRef.current.h + (cy - resizeRef.current.y)));
      setPanelSize({ width: nw, height: nh });
    };
    const onUp = () => { setIsResizing(false); saveJson(PANEL_SIZE_KEY, panelSize); resizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, [isResizing, panelSize]);

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

      await agentChat(novelId, cur.session_id, text, {
        onPatch: (data) => {
          if (data.message?.role === "assistant") {
            setMessages((prev) => prev.map((m) => m.id === aid ? { ...m, content: data.message?.content || "", isStreaming: data.message?.is_streaming } : m));
          }
        },
        onDelta: (data) => {
          if (data.type === "text" && data.content) {
            setMessages((prev) => prev.map((m) => m.id === aid ? { ...m, content: m.content + data.content } : m));
          }
        },
        onAgentStep: (data) => { setAgentSteps((prev) => [...prev, data]); },
        onQuestion: (data) => { setPendingQuestion(data); },
        onStatus: (data) => { setStatus(data.status || "idle"); },
        onDone: () => { setMessages((prev) => prev.map((m) => m.id === aid ? { ...m, isStreaming: false } : m)); setIsLoading(false); },
        onError: (data) => { setMessages((prev) => [...prev, { id: generateId(), role: "error", content: data.message, timestamp: Date.now() }]); setIsLoading(false); },
      });
    } catch (err) {
      setMessages((prev) => [...prev, { id: generateId(), role: "error", content: err instanceof Error ? err.message : "连接失败", timestamp: Date.now() }]);
      setIsLoading(false);
    }
  }, [input, isLoading, novelId, ensureSession]);

  const handleAnswerQuestion = useCallback(async (questionId: string, answer: string, selectedOption?: string) => {
    if (!session || !pendingQuestion) return;
    setPendingQuestion(null);
    setIsLoading(true);
    setAgentSteps([]);
    const answerText = selectedOption || answer;
    setMessages((prev) => [...prev, { id: generateId(), role: "user", content: answerText, timestamp: Date.now() }]);

    try {
      const aid = generateId();
      setMessages((prev) => [...prev, { id: aid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true }]);
      await agentAnswerQuestion(novelId!, session.session_id, questionId, answer, selectedOption, {
        onDelta: (data) => { if (data.type === "text" && data.content) setMessages((prev) => prev.map((m) => m.id === aid ? { ...m, content: m.content + data.content } : m)); },
        onAgentStep: (data) => { setAgentSteps((prev) => [...prev, data]); },
        onQuestion: (data) => { setPendingQuestion(data); },
        onStatus: (data) => { setStatus(data.status || "idle"); },
        onDone: () => { setMessages((prev) => prev.map((m) => m.id === aid ? { ...m, isStreaming: false } : m)); setIsLoading(false); },
        onError: (data) => { setMessages((prev) => [...prev, { id: generateId(), role: "error", content: data.message, timestamp: Date.now() }]); setIsLoading(false); },
      });
    } catch (err) {
      setMessages((prev) => [...prev, { id: generateId(), role: "error", content: err instanceof Error ? err.message : "连接失败", timestamp: Date.now() }]);
      setIsLoading(false);
    }
  }, [session, pendingQuestion, novelId]);

  const getToolDisplayName = (name: string) => {
    const key = TOOL_DISPLAY_NAMES[name];
    return key ? t(key) : name;
  };

  const displaySteps = agentSteps.map((s) => ({ ...s, tool_name: s.tool_name ? getToolDisplayName(s.tool_name) : s.tool_name }));

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="ai-assistant-float-btn"
          style={{ right: `${Math.abs(position.x)}px`, top: `${position.y}px`, transform: isDragging ? "scale(1.1)" : undefined }}
          onClick={() => setIsOpen(true)}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </button>
      )}

      {isOpen && (
        <div
          className="ai-assistant-panel"
          style={{ right: `${Math.abs(position.x)}px`, top: `${position.y}px`, width: `${panelSize.width}px`, height: `${panelSize.height}px`, maxHeight: "calc(100vh - 88px)" }}
        >
          <div className="ai-assistant-header" onMouseDown={handleDragStart} onTouchStart={handleDragStart} style={{ cursor: "grab" }}>
            <div className="ai-assistant-header__title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <span>{t("smart_writer_title")}</span>
              {status === "running" && <span className="ai-assistant-header__status-dot" />}
            </div>
            <button type="button" className="ai-assistant-header__close" onClick={() => setIsOpen(false)}>×</button>
          </div>

          {displaySteps.length > 0 && (
            <div className="agent-steps-container">
              <AgentStepDisplay steps={displaySteps} />
            </div>
          )}

          <div className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-welcome">
                <div className="agent-welcome__icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <p className="agent-welcome__text">{t("smart_writer_welcome")}</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`agent-message agent-message-${msg.role}`}>
                {msg.role === "user" ? (
                  <div className="agent-message-content">{msg.content}</div>
                ) : msg.role === "error" ? (
                  <div className="agent-message-content agent-message-error">{msg.content}</div>
                ) : (
                  <div className="agent-message-content">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                    {msg.isStreaming && <span className="agent-cursor">▊</span>}
                  </div>
                )}
              </div>
            ))}
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
              rows={2}
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
            className="ai-assistant-panel__resize-handle"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            style={{ cursor: isResizing ? "se-resize" : "sw-resize" }}
          />
        </div>
      )}
    </>
  );
}
