import { useCallback, useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/i18n";
import {
  createAgentSession,
  agentChat,
  agentAnswerQuestion,
  type AgentSession,
} from "@/api/client";
import type { PendingQuestionData, SseAgentStepData, SseChapterSavedData } from "@/types/sse";
import AskUserQuestion from "@/components/AskUserQuestion";
import AgentStepDisplay from "@/components/AgentStepDisplay";
import type { Chapter } from "@/types";

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error" | "chapter_saved";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  savedChapter?: SseChapterSavedData;
}

export interface AiAssistantFloatingProps {
  novelId?: number;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
}

const SESSION_KEY = "inkmind_agent_session";
const PANEL_WIDTH_KEY = "inkmind_ai_panel_width";
const PANEL_RECT_KEY = "inkmind_ai_panel_rect";
const ICON_POS_KEY = "inkmind_ai_icon_pos";
const DEFAULT_PANEL_WIDTH = 400;
const DEFAULT_PANEL_HEIGHT = 640;
const MIN_PANEL_WIDTH = 340;
const MAX_PANEL_WIDTH = 620;
const MIN_PANEL_HEIGHT = 420;
const PANEL_MARGIN = 18;

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

function clampPanelWidth(width: number): number {
  const viewportMax = typeof window === "undefined" ? MAX_PANEL_WIDTH : window.innerWidth - 120;
  const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, viewportMax));
  return Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

type PanelRect = { left: number; top: number; width: number; height: number };
type IconPos = { left: number; top: number };
type PanelResizeMode = "left" | "nw" | "ne" | "sw" | "se";

function defaultPanelRect(): PanelRect {
  if (typeof window === "undefined") {
    return { left: 960, top: 80, width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
  }
  const width = clampPanelWidth(loadJson(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH));
  const height = Math.min(DEFAULT_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, window.innerHeight - 140));
  return {
    left: Math.max(PANEL_MARGIN, window.innerWidth - width - 28),
    top: Math.max(PANEL_MARGIN, window.innerHeight - height - 28),
    width,
    height,
  };
}

function clampPanelRect(rect: PanelRect): PanelRect {
  if (typeof window === "undefined") return rect;
  const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
  const width = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, Math.round(rect.width)));
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - PANEL_MARGIN * 2);
  const height = Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, Math.round(rect.height)));
  const left = Math.min(window.innerWidth - width - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(rect.left)));
  const top = Math.min(window.innerHeight - height - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(rect.top)));
  return { left, top, width, height };
}

function defaultIconPos(): IconPos {
  if (typeof window === "undefined") return { left: 24, top: 420 };
  return {
    left: Math.max(PANEL_MARGIN, window.innerWidth - 156),
    top: Math.max(PANEL_MARGIN, Math.min(window.innerHeight - 74, Math.round(window.innerHeight * 0.5))),
  };
}

function clampIconPos(pos: IconPos): IconPos {
  if (typeof window === "undefined") return pos;
  const iconWidth = window.innerWidth <= 480 ? 48 : 138;
  return {
    left: Math.min(window.innerWidth - iconWidth - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(pos.left))),
    top: Math.min(window.innerHeight - 56 - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(pos.top))),
  };
}

function stopStreamingMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => (
    message.role === "assistant" && message.isStreaming
      ? { ...message, isStreaming: false }
      : message
  ));
}

function sanitizeAssistantContent(content: string): string {
  return content
    .replace(/[（(]\s*章节\s*ID\s*[:：]\s*\d+\s*[）)]/gi, "")
    .replace(/章节\s*ID\s*[:：]\s*\d+/gi, "")
    .replace(/[（(]\s*chapter\s*id\s*[:：]\s*\d+\s*[）)]/gi, "")
    .replace(/chapter\s*id\s*[:：]\s*\d+/gi, "")
    .replace(/\s+([！!。,.，])/g, "$1");
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
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startRect: PanelRect;
    mode: PanelResizeMode;
  } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startRect: PanelRect } | null>(null);
  const iconDragRef = useRef<{ startX: number; startY: number; startPos: IconPos; moved: boolean } | null>(null);
  const [panelRect, setPanelRect] = useState<PanelRect>(() => clampPanelRect(loadJson(PANEL_RECT_KEY, defaultPanelRect())));
  const [iconPos, setIconPos] = useState<IconPos>(() => clampIconPos(loadJson(ICON_POS_KEY, defaultIconPos())));
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isIconDragging, setIsIconDragging] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentSteps]);

  useEffect(() => {
    document.body.classList.toggle("ai-assistant-is-resizing", isPanelResizing);
    if (!isPanelResizing) return;

    const handleMove = (event: PointerEvent) => {
      if (!resizeRef.current) return;
      const { startX, startY, startRect, mode } = resizeRef.current;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (mode === "left") {
        setPanelRect(clampPanelRect({
          ...startRect,
          left: startRect.left + deltaX,
          width: startRect.width - deltaX,
        }));
      } else if (mode === "se") {
        setPanelRect(clampPanelRect({
          ...startRect,
          width: startRect.width + deltaX,
          height: startRect.height + deltaY,
        }));
      } else if (mode === "sw") {
        setPanelRect(clampPanelRect({
          ...startRect,
          left: startRect.left + deltaX,
          width: startRect.width - deltaX,
          height: startRect.height + deltaY,
        }));
      } else if (mode === "ne") {
        setPanelRect(clampPanelRect({
          ...startRect,
          top: startRect.top + deltaY,
          width: startRect.width + deltaX,
          height: startRect.height - deltaY,
        }));
      } else {
        setPanelRect(clampPanelRect({
          ...startRect,
          left: startRect.left + deltaX,
          top: startRect.top + deltaY,
          width: startRect.width - deltaX,
          height: startRect.height - deltaY,
        }));
      }
    };

    const handleUp = () => {
      setIsPanelResizing(false);
      resizeRef.current = null;
      setPanelRect((current) => {
        const next = clampPanelRect(current);
        saveJson(PANEL_WIDTH_KEY, next.width);
        saveJson(PANEL_RECT_KEY, next);
        return next;
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      document.body.classList.remove("ai-assistant-is-resizing");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isPanelResizing]);

  useEffect(() => {
    document.body.classList.toggle("ai-assistant-is-dragging", isPanelDragging);
    if (!isPanelDragging) return;

    const handleMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const { startX, startY, startRect } = dragRef.current;
      setPanelRect(clampPanelRect({
        ...startRect,
        left: startRect.left + event.clientX - startX,
        top: startRect.top + event.clientY - startY,
      }));
    };

    const handleUp = () => {
      setIsPanelDragging(false);
      dragRef.current = null;
      setPanelRect((current) => {
        const next = clampPanelRect(current);
        saveJson(PANEL_RECT_KEY, next);
        return next;
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      document.body.classList.remove("ai-assistant-is-dragging");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isPanelDragging]);

  useEffect(() => {
    document.body.classList.toggle("ai-assistant-is-dragging", isIconDragging);
    if (!isIconDragging) return;

    const handleMove = (event: PointerEvent) => {
      if (!iconDragRef.current) return;
      const deltaX = event.clientX - iconDragRef.current.startX;
      const deltaY = event.clientY - iconDragRef.current.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        iconDragRef.current.moved = true;
      }
      setIconPos(clampIconPos({
        left: iconDragRef.current.startPos.left + deltaX,
        top: iconDragRef.current.startPos.top + deltaY,
      }));
    };

    const handleUp = () => {
      const moved = iconDragRef.current?.moved ?? false;
      setIsIconDragging(false);
      iconDragRef.current = null;
      setIconPos((current) => {
        const next = clampIconPos(current);
        saveJson(ICON_POS_KEY, next);
        return next;
      });
      if (!moved) setIsOpen(true);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      document.body.classList.remove("ai-assistant-is-dragging");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isIconDragging]);

  useEffect(() => {
    const handleResize = () => {
      setPanelRect((current) => clampPanelRect(current));
      setIconPos((current) => clampIconPos(current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
        if ((data.type === "text" || data.type === "task_text") && data.content) {
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
        setMessages((prev) => stopStreamingMessages(prev));
        setPendingQuestion(data);
      },
      onChapterSaved: (data: any) => {
        console.log("[ChapterSaved]", data.id, data.title);
        setMessages((prev) => [
          ...stopStreamingMessages(prev),
          {
            id: generateId(),
            role: "chapter_saved",
            content: "",
            timestamp: Date.now(),
            savedChapter: data,
          },
        ]);
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
          setMessages((prev) => stopStreamingMessages(prev));
          setIsLoading(false);
        } else if (s === "idle") {
          setMessages((prev) => stopStreamingMessages(prev));
          setIsLoading(false);
        }
      },
      onDone: () => {
        setMessages((prev) => stopStreamingMessages(prev));
        setAgentSteps((prev) => [...prev, { step_type: "finish" as const, is_parallel: false, ts: Date.now() }]);
        setIsLoading(false);
      },
      onError: (data: any) => {
        setMessages((prev) => [
          ...stopStreamingMessages(prev),
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

    setMessages((prev) => [...stopStreamingMessages(prev), { id: generateId(), role: "user", content: text, timestamp: Date.now() }]);

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

    const newAid = generateId();
    activeAssistantIdRef.current = newAid;
    setMessages((prev) => [
      ...stopStreamingMessages(prev),
      { id: generateId(), role: "user", content: answerText, timestamp: Date.now() },
      { id: newAid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
    ]);

    try {
      const result = await agentAnswerQuestion(novelId!, session.session_id, questionId, answer, selectedOption);
      if (!result.resolved) {
        const handlers = buildChatHandlers(newAid);
        await agentChat(novelId!, session.session_id, answerText, handlers);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { id: generateId(), role: "error", content: err instanceof Error ? err.message : "连接失败", timestamp: Date.now() }]);
      setIsLoading(false);
    }
  }, [session, pendingQuestion, novelId, buildChatHandlers]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleOpenSavedChapter = useCallback((chapter: SseChapterSavedData) => {
    window.dispatchEvent(new CustomEvent("inkmind:chapter-saved", { detail: chapter }));
  }, []);

  const handleContinueAfterSaved = useCallback(() => {
    setInput(t("smart_writer_suggestion_1"));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [t]);

  const handlePanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>, mode: PanelResizeMode) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, startY: event.clientY, startRect: panelRect, mode };
    setIsPanelResizing(true);
  }, [panelRect]);

  const handlePanelDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, a")) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, startRect: panelRect };
    setIsPanelDragging(true);
  }, [panelRect]);

  const handleIconPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    iconDragRef.current = { startX: event.clientX, startY: event.clientY, startPos: iconPos, moved: false };
    setIsIconDragging(true);
  }, [iconPos]);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className={`ai-assistant-float-btn${isIconDragging ? " ai-assistant-float-btn--dragging" : ""}`}
          style={{ left: iconPos.left, top: iconPos.top }}
          onPointerDown={handleIconPointerDown}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen(true);
            }
          }}
          title={t("smart_writer_title")}
        >
          <AiAssistantMark />
          <span className="ai-assistant-float-btn__label">{t("smart_writer_title")}</span>
        </button>
      )}

      {isOpen && (
        <div
          className={`ai-assistant-panel${isPanelResizing ? " ai-assistant-panel--resizing" : ""}${isPanelDragging ? " ai-assistant-panel--dragging" : ""}`}
          style={{
            left: panelRect.left,
            top: panelRect.top,
            width: panelRect.width,
            height: panelRect.height,
          }}
        >
          <div
            className="ai-assistant-panel__width-handle"
            onPointerDown={(event) => handlePanelResizeStart(event, "left")}
            aria-hidden="true"
          />
          {(["nw", "ne", "sw", "se"] as const).map((mode) => (
            <div
              key={mode}
              className={`ai-assistant-panel__resize ai-assistant-panel__resize--${mode}`}
              onPointerDown={(event) => handlePanelResizeStart(event, mode)}
              aria-hidden="true"
            />
          ))}
          <div className="ai-assistant-header" onPointerDown={handlePanelDragStart}>
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
                ) : msg.role === "chapter_saved" && msg.savedChapter ? (
                  <div className="agent-message-content agent-message-content--saved">
                    <div className="agent-saved-card">
                      <div className="agent-saved-card__mark" aria-hidden="true">✓</div>
                      <div className="agent-saved-card__body">
                        <div className="agent-saved-card__eyebrow">{t("agent_saved_card_label")}</div>
                        <div className="agent-saved-card__title">
                          {t("agent_saved_card_title")
                            .replace("{chapter}", String(msg.savedChapter.chapter_number || ""))
                            .replace("{title}", msg.savedChapter.title || t("common_untitled"))}
                        </div>
                        <div className="agent-saved-card__meta">
                          {t("agent_saved_card_meta").replace("{count}", String(msg.savedChapter.word_count || 0))}
                        </div>
                        <div className="agent-saved-card__actions">
                          <button type="button" onClick={() => handleOpenSavedChapter(msg.savedChapter!)}>
                            {t("agent_saved_card_open")}
                          </button>
                          <button type="button" onClick={handleContinueAfterSaved}>
                            {t("agent_saved_card_continue")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="agent-message-content agent-message-content--assistant">
                    <div className="agent-message-avatar">
                      <AiAssistantMark className="ai-assistant-mark--avatar" />
                    </div>
                    <div className="agent-message-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeAssistantContent(msg.content)}</ReactMarkdown>
                      {msg.isStreaming && msg.content.trim() && <span className="agent-cursor" aria-hidden="true" />}
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
        </div>
      )}
    </>
  );
}
