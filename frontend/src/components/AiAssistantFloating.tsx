import { useCallback, useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/i18n";
import {
  createAgentSession,
  agentChat,
  agentAnswerQuestion,
  updateAgentTaskOutput,
  interruptAgentSession,
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
  postTaskContent?: string;
  timestamp: number;
  isStreaming?: boolean;
  savedChapter?: SseChapterSavedData;
  taskSections?: AgentTaskSection[];
}

interface AgentTaskSection {
  taskId: string;
  taskType: string;
  title: string;
  content: string;
  draftContent?: string;
  collapsed?: boolean;
  editing?: boolean;
  saving?: boolean;
  saved?: boolean;
}

export interface AiAssistantFloatingProps {
  novelId?: number;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
}

const SESSION_KEY = "inkmind_agent_session";
const PANEL_WIDTH_KEY = "inkmind_ai_panel_width";
const PANEL_RECT_KEY = "inkmind_ai_panel_rect";
const ICON_POS_KEY = "inkmind_ai_icon_pos";
const DEFAULT_PANEL_WIDTH = 560;
const DEFAULT_PANEL_HEIGHT = 720;
const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 980;
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
  const viewportMax = typeof window === "undefined" ? MAX_PANEL_WIDTH : window.innerWidth - 72;
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

function taskSectionTitle(taskType: string): string {
  if (taskType === "generate_summary") return "agent_task_section_summary";
  if (taskType === "generate_chapter") return "agent_task_section_chapter";
  if (taskType === "revise_chapter") return "agent_task_section_revise";
  if (taskType === "append_chapter") return "agent_task_section_append";
  return "agent_task_section_content";
}

function isTaskIntroChunk(content: string): boolean {
  return /^\s*#{1,4}\s*(章节摘要|正文草稿|改写草稿|续写草稿|生成内容)\s*$/m.test(content);
}

function stopAgentSteps(steps: SseAgentStepData[]): SseAgentStepData[] {
  const next = [...steps];
  const latestPhase = new Map<string, SseAgentStepData>();
  for (const step of steps) {
    if (step.step_type === "phase" && step.phase_id) latestPhase.set(step.phase_id, step);
  }
  for (const phase of latestPhase.values()) {
    if (phase.phase_status === "running" && phase.phase_id) {
      next.push({
        step_type: "phase",
        phase_id: phase.phase_id,
        phase_status: "cancelled",
        phase_title: phase.phase_title,
        phase_detail: "已停止",
        is_parallel: false,
        ts: Date.now(),
      });
    }
  }
  next.push({ step_type: "finish", thought: "cancelled", is_parallel: false, ts: Date.now() });
  return next;
}

function finishUserConfirmStep(steps: SseAgentStepData[]): SseAgentStepData[] {
  const hasRunningConfirm = steps.some(
    (step) => step.step_type === "phase"
      && step.phase_id === "user_confirm"
      && step.phase_status === "running",
  );
  if (!hasRunningConfirm) return steps;
  return [
    ...steps,
    {
      step_type: "phase" as const,
      phase_id: "user_confirm",
      phase_status: "done" as const,
      phase_title: "用户确认",
      is_parallel: false,
      ts: Date.now(),
    },
  ];
}

function sanitizeAssistantContent(content: string): string {
  return content
    .replace(/[（(]\s*章节\s*ID\s*[:：]\s*\d+\s*[）)]/gi, "")
    .replace(/章节\s*ID\s*[:：]\s*\d+/gi, "")
    .replace(/[（(]\s*chapter\s*id\s*[:：]\s*\d+\s*[）)]/gi, "")
    .replace(/chapter\s*id\s*[:：]\s*\d+/gi, "")
    .replace(/\s+([！!。,.，])/g, "$1");
}

const ACTIVITY_TOOL_LABELS: Record<string, string> = {
  get_novel_state: "agent_activity_tool_get_novel_state",
  get_chapters: "agent_activity_tool_get_chapters",
  get_chapter_detail: "agent_activity_tool_get_chapter_detail",
  get_characters: "agent_activity_tool_get_characters",
  get_memos: "agent_activity_tool_get_memos",
  get_writing_context_pack: "agent_activity_tool_get_writing_context_pack",
  dispatch_generation_task: "agent_activity_tool_dispatch_generation_task",
  poll_task_result: "agent_activity_tool_poll_task_result",
  poll_multiple_tasks: "agent_activity_tool_poll_task_result",
  quality_check_chapter: "agent_activity_tool_quality_check_chapter",
  save_chapter: "agent_activity_tool_save_chapter",
  delete_chapter: "agent_activity_tool_delete_chapter",
  ask_user: "agent_activity_tool_ask_user",
};

const ACTIVITY_PHASE_LABELS: Record<string, string> = {
  read_context: "agent_activity_phase_read_context",
  chapter_summary: "agent_activity_phase_chapter_summary",
  chapter_content: "agent_activity_phase_chapter_content",
  quality_check: "agent_activity_phase_quality_check",
  save_chapter: "agent_activity_phase_save_chapter",
};

function cleanAgentToolName(raw: string): string {
  return raw
    .replace(/^mcp__inkmind__/, "")
    .replace(/^mcp_+inkmind_+/, "")
    .replace(/^InkMind::/, "");
}

function isInternalAgentTool(name: string): boolean {
  return /^tool_[a-f0-9_]+$/.test(name) || name === "agent_connect" || name === "agent_query";
}

function getAgentActivityLabel(steps: SseAgentStepData[], t: (key: string) => string): string {
  const latestPhases = new Map<string, SseAgentStepData>();
  const runningTools = new Map<string, number>();
  let latestGenerating = false;
  let latestEvaluating = false;

  for (const step of steps) {
    if (step.step_type === "phase" && step.phase_id) {
      latestPhases.set(step.phase_id, step);
    } else if (step.step_type === "tool_call") {
      const name = cleanAgentToolName(step.tool_name || "");
      if (name && !isInternalAgentTool(name)) {
        runningTools.set(name, (runningTools.get(name) || 0) + 1);
      }
      latestGenerating = false;
      latestEvaluating = false;
    } else if (step.step_type === "tool_result") {
      const name = cleanAgentToolName(step.tool_name || "");
      const count = runningTools.get(name) || 0;
      if (count <= 1) runningTools.delete(name);
      else runningTools.set(name, count - 1);
      latestGenerating = false;
      latestEvaluating = false;
    } else if (step.step_type === "generating") {
      latestGenerating = true;
      latestEvaluating = false;
    } else if (step.step_type === "evaluating") {
      latestEvaluating = true;
      latestGenerating = false;
    } else if (step.step_type === "finish") {
      runningTools.clear();
      latestGenerating = false;
      latestEvaluating = false;
    }
  }

  const activePhase = [...latestPhases.values()].find(
    (step) => step.phase_status === "running" && step.phase_id !== "user_confirm",
  );
  if (activePhase?.phase_id) {
    return t(ACTIVITY_PHASE_LABELS[activePhase.phase_id] || "agent_activity_working");
  }
  if (latestGenerating) return t("agent_activity_generating");
  if (latestEvaluating) return t("agent_activity_evaluating");
  const runningTool = [...runningTools.keys()].at(-1);
  if (runningTool) {
    return t(ACTIVITY_TOOL_LABELS[runningTool] || "agent_activity_using_named_tool")
      .replace("{tool}", runningTool);
  }
  return t("agent_activity_thinking");
}

function AiAssistantMark({ className = "" }: { className?: string }) {
  return (
    <span className={`ai-assistant-mark ${className}`} aria-hidden="true">
      <svg className="ai-assistant-mark__glyph" viewBox="0 0 24 24" focusable="false">
        <path d="M7.3 8.4h9.4c1 0 1.8.8 1.8 1.8v5.6c0 1-.8 1.8-1.8 1.8H7.3c-1 0-1.8-.8-1.8-1.8v-5.6c0-1 .8-1.8 1.8-1.8Z" />
        <path d="M12 8.2V5.5m-2 0h4" />
        <circle cx="9.6" cy="12.7" r="1.2" />
        <circle cx="14.4" cy="12.7" r="1.2" />
      </svg>
    </span>
  );
}

function AgentActivityIndicator({ label }: { label: string }) {
  return (
    <div className="agent-activity" aria-live="polite">
      <span className="agent-activity__orb" aria-hidden="true" />
      <span className="agent-activity__text">{label}</span>
      <span className="agent-activity__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
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
  const activeRunIdRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const activeCloseRef = useRef<(() => void) | null>(null);
  const answeringQuestionRef = useRef(false);
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
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ novelId?: number; prompt?: string }>).detail;
      if (detail?.novelId && novelId && detail.novelId !== novelId) return;
      setIsOpen(true);
      if (detail?.prompt) {
        setInput(detail.prompt);
      }
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("inkmind:assistant-open", handleOpen);
    return () => window.removeEventListener("inkmind:assistant-open", handleOpen);
  }, [novelId]);

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

  const buildChatHandlers = useCallback((aid: string, runId: number) => {
    activeAssistantIdRef.current = aid;
    const isStaleRun = () => activeRunIdRef.current !== runId;
    return {
      onPatch: (data: any) => {
        if (isStaleRun()) return;
        if (data.message?.role === "assistant") {
          const currentAid = activeAssistantIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === currentAid ? { ...m, content: data.message?.content || "", isStreaming: data.message?.is_streaming } : m));
        }
      },
      onDelta: (data: any) => {
        if (isStaleRun()) return;
        if (data.type === "task_text" && data.content) {
          const currentAid = activeAssistantIdRef.current;
          const taskId = data.task_id || "task";
          const taskType = data.task_type || "content";
          const chunk = isTaskIntroChunk(data.content) ? "" : data.content;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== currentAid) return m;
            const sections = [...(m.taskSections || [])];
            const idx = sections.findIndex((section) => section.taskId === taskId);
            if (idx >= 0) {
              const current = sections[idx];
              sections[idx] = {
                ...current,
                content: current.content + chunk,
                draftContent: current.editing ? current.draftContent : undefined,
                saved: false,
              };
            } else {
              sections.push({
                taskId,
                taskType,
                title: taskSectionTitle(taskType),
                content: chunk,
                collapsed: false,
              });
            }
            return { ...m, taskSections: sections };
          }));
        } else if (data.type === "text" && data.content) {
          const currentAid = activeAssistantIdRef.current;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== currentAid) return m;
            if (m.taskSections?.length) {
              return { ...m, postTaskContent: (m.postTaskContent || "") + data.content };
            }
            return { ...m, content: m.content + data.content };
          }));
        }
      },
      onAgentStep: (data: any) => {
        if (isStaleRun()) return;
        if (
          answeringQuestionRef.current
          && data.step_type === "phase"
          && data.phase_id === "user_confirm"
          && data.phase_status === "running"
        ) {
          return;
        }
        console.log("[AgentStep]", data.step_type, data.tool_name);
        setAgentSteps((prev) => [...prev, data]);
      },
      onQuestion: (data: any) => {
        if (isStaleRun()) return;
        answeringQuestionRef.current = false;
        console.log("[Question]", data.question, data.options);
        setMessages((prev) => stopStreamingMessages(prev));
        setPendingQuestion(data);
      },
      onChapterSaved: (data: any) => {
        if (isStaleRun()) return;
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
        if (isStaleRun()) return;
        console.log("[ChapterDeleted]", data.id, data.title);
        window.dispatchEvent(new CustomEvent("inkmind:chapter-deleted", { detail: data }));
      },
      onStatus: (data: any) => {
        if (isStaleRun()) return;
        const s = data.status || "idle";
        if (s === "waiting_for_user" && answeringQuestionRef.current) return;
        setStatus(s);
        if (s === "waiting_for_user") {
          setMessages((prev) => stopStreamingMessages(prev));
          setIsLoading(false);
          activeAbortRef.current = null;
          activeCloseRef.current = null;
        } else if (s === "idle") {
          answeringQuestionRef.current = false;
          setMessages((prev) => stopStreamingMessages(prev));
          setIsLoading(false);
          activeAbortRef.current = null;
          activeCloseRef.current = null;
        }
      },
      onDone: () => {
        if (isStaleRun()) return;
        answeringQuestionRef.current = false;
        setMessages((prev) => stopStreamingMessages(prev));
        setAgentSteps((prev) => [...prev, { step_type: "finish" as const, is_parallel: false, ts: Date.now() }]);
        setIsLoading(false);
        activeAbortRef.current = null;
        activeCloseRef.current = null;
      },
      onError: (data: any) => {
        if (isStaleRun()) return;
        answeringQuestionRef.current = false;
        setMessages((prev) => [
          ...stopStreamingMessages(prev),
          { id: generateId(), role: "error", content: data.message, timestamp: Date.now() },
        ]);
        setIsLoading(false);
        activeAbortRef.current = null;
        activeCloseRef.current = null;
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
    answeringQuestionRef.current = false;
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;

    setMessages((prev) => [...stopStreamingMessages(prev), { id: generateId(), role: "user", content: text, timestamp: Date.now() }]);

    try {
      const cur = await ensureSession();
      if (activeRunIdRef.current !== runId) return;
      const aid = generateId();
      setMessages((prev) => [...prev, { id: aid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true }]);

      const handlers = buildChatHandlers(aid, runId);
      const retryOnError: typeof handlers = {
        ...handlers,
        onError: async (data: any) => {
          if (activeRunIdRef.current !== runId) return;
          const msg = data.message || "";
          if (msg.includes("会话不存在") || msg.includes("not found")) {
            resetSession();
	            try {
	              const newSess = await createNewSession();
                if (activeRunIdRef.current !== runId) return;
	              const retryHandlers = buildChatHandlers(aid, runId);
	              const retryController = new AbortController();
	              activeAbortRef.current = retryController;
	              const retryConn = await agentChat(novelId, newSess.session_id, text, retryHandlers, { signal: retryController.signal });
                if (activeRunIdRef.current !== runId) {
                  retryConn.close();
                  return;
                }
	              activeCloseRef.current = retryConn.close;
	            } catch {
                if (activeRunIdRef.current !== runId) return;
	              setMessages((prev) => [...prev, { id: generateId(), role: "error", content: "创建新会话失败", timestamp: Date.now() }]);
	              setIsLoading(false);
            }
          } else {
            handlers.onError(data);
          }
        },
	      };

	      const controller = new AbortController();
	      activeAbortRef.current = controller;
	      const conn = await agentChat(novelId, cur.session_id, text, retryOnError, { signal: controller.signal });
        if (activeRunIdRef.current !== runId) {
          conn.close();
          return;
        }
	      activeCloseRef.current = conn.close;
	    } catch (err) {
      if (activeRunIdRef.current !== runId) return;
      setMessages((prev) => [...prev, { id: generateId(), role: "error", content: err instanceof Error ? err.message : "连接失败", timestamp: Date.now() }]);
      setIsLoading(false);
    }
  }, [input, isLoading, novelId, ensureSession, resetSession, createNewSession, buildChatHandlers]);

  const handleInterrupt = useCallback(async () => {
    if (!isLoading || !novelId || !session) return;
    activeRunIdRef.current += 1;
    activeCloseRef.current?.();
    activeAbortRef.current?.abort();
    activeCloseRef.current = null;
    activeAbortRef.current = null;
    answeringQuestionRef.current = false;
    setIsLoading(false);
    setPendingQuestion(null);
    setStatus("idle");
    setAgentSteps((prev) => stopAgentSteps(prev));
    setMessages((prev) => [
      ...stopStreamingMessages(prev),
      { id: generateId(), role: "system", content: t("agent_interrupted"), timestamp: Date.now() },
    ]);
    try {
      await interruptAgentSession(novelId, session.session_id);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: "error",
        content: err instanceof Error ? err.message : t("agent_interrupt_failed"),
        timestamp: Date.now(),
      }]);
    }
  }, [isLoading, novelId, session, t]);

  const handleAnswerQuestion = useCallback(async (questionId: string, answer: string, selectedOption?: string) => {
    if (!session || !pendingQuestion) return;
    setPendingQuestion(null);
    setIsLoading(true);
    setStatus("running");
    answeringQuestionRef.current = true;
    setAgentSteps((prev) => finishUserConfirmStep(prev));
    const answerText = selectedOption || answer;
    const runId = activeRunIdRef.current;

    const newAid = generateId();
    activeAssistantIdRef.current = newAid;
    setMessages((prev) => [
      ...stopStreamingMessages(prev),
      { id: generateId(), role: "user", content: answerText, timestamp: Date.now() },
      { id: newAid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
    ]);

    try {
	      const result = await agentAnswerQuestion(novelId!, session.session_id, questionId, answer, selectedOption);
        if (activeRunIdRef.current !== runId) return;
	      if (!result.resolved) {
          const fallbackRunId = activeRunIdRef.current + 1;
          activeRunIdRef.current = fallbackRunId;
	        const handlers = buildChatHandlers(newAid, fallbackRunId);
	        const controller = new AbortController();
	        activeAbortRef.current = controller;
	        const conn = await agentChat(novelId!, session.session_id, answerText, handlers, { signal: controller.signal });
          if (activeRunIdRef.current !== fallbackRunId) {
            conn.close();
            return;
          }
	        activeCloseRef.current = conn.close;
	      }
    } catch (err) {
      if (activeRunIdRef.current !== runId) return;
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

  const updateTaskSection = useCallback((
    messageId: string,
    taskId: string,
    updater: (section: AgentTaskSection) => AgentTaskSection,
  ) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || !message.taskSections) return message;
      return {
        ...message,
        taskSections: message.taskSections.map((section) => (
          section.taskId === taskId ? updater(section) : section
        )),
      };
    }));
  }, []);

  const handleToggleTaskSection = useCallback((messageId: string, taskId: string) => {
    updateTaskSection(messageId, taskId, (section) => ({ ...section, collapsed: !section.collapsed }));
  }, [updateTaskSection]);

  const handleEditTaskSection = useCallback((messageId: string, taskId: string) => {
    updateTaskSection(messageId, taskId, (section) => ({
      ...section,
      editing: true,
      collapsed: false,
      draftContent: section.content,
      saved: false,
    }));
  }, [updateTaskSection]);

  const handleCancelTaskSectionEdit = useCallback((messageId: string, taskId: string) => {
    updateTaskSection(messageId, taskId, (section) => ({
      ...section,
      editing: false,
      draftContent: undefined,
      saving: false,
    }));
  }, [updateTaskSection]);

  const handleTaskSectionDraftChange = useCallback((messageId: string, taskId: string, value: string) => {
    updateTaskSection(messageId, taskId, (section) => ({ ...section, draftContent: value, saved: false }));
  }, [updateTaskSection]);

  const handleApplyTaskSectionEdit = useCallback(async (messageId: string, section: AgentTaskSection) => {
    if (!novelId || !session) return;
    const content = (section.draftContent ?? section.content).trim();
    updateTaskSection(messageId, section.taskId, (current) => ({ ...current, saving: true }));
    try {
      await updateAgentTaskOutput(novelId, session.session_id, section.taskId, section.taskType, content);
      updateTaskSection(messageId, section.taskId, (current) => ({
        ...current,
        content,
        draftContent: undefined,
        editing: false,
        saving: false,
        saved: true,
      }));
    } catch (err) {
      updateTaskSection(messageId, section.taskId, (current) => ({ ...current, saving: false }));
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: "error",
        content: err instanceof Error ? err.message : t("agent_task_section_apply_failed"),
        timestamp: Date.now(),
      }]);
    }
  }, [novelId, session, t, updateTaskSection]);

  const handleContinueAfterSaved = useCallback(() => {
    setInput(t("smart_writer_suggestion_1"));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [t]);

  const handleSuggestionClick = useCallback((prompt: string) => {
    if (isLoading) return;
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isLoading]);

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

  const activityLabel = getAgentActivityLabel(agentSteps, t);

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
                <div className="agent-welcome__copy">
                  <p className="agent-welcome__eyebrow">{t("smart_writer_welcome_eyebrow")}</p>
                  <p className="agent-welcome__title">{t("smart_writer_welcome_title")}</p>
                  <p className="agent-welcome__text">{t("smart_writer_welcome")}</p>
                </div>
                <div className="agent-welcome__actions" aria-label={t("smart_writer_recommended_actions")}>
                  {[
                    t("smart_writer_suggestion_1"),
                    t("smart_writer_suggestion_2"),
                    t("smart_writer_suggestion_check"),
                    t("smart_writer_suggestion_character"),
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="agent-welcome__action"
                      disabled={isLoading}
                      onClick={() => handleSuggestionClick(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => {
              const isEmptyAssistant = msg.role === "assistant"
                && !msg.content.trim()
                && !msg.postTaskContent?.trim()
                && !(msg.taskSections?.length);
              const showAssistantActivity = msg.role === "assistant" && msg.isStreaming && isLoading && !pendingQuestion;
              if (isEmptyAssistant && !msg.isStreaming) {
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
                        {isEmptyAssistant && msg.isStreaming ? (
                          <AgentActivityIndicator label={activityLabel} />
                        ) : msg.content.trim() && (
	                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeAssistantContent(msg.content)}</ReactMarkdown>
	                      )}
	                      {msg.taskSections?.map((section) => (
	                        <div key={section.taskId} className={`agent-task-section${section.collapsed ? " agent-task-section--collapsed" : ""}`}>
	                          <div className="agent-task-section__header">
	                            <button
	                              type="button"
	                              className="agent-task-section__toggle"
	                              onClick={() => handleToggleTaskSection(msg.id, section.taskId)}
	                            >
	                              <span className="agent-task-section__chevron">{section.collapsed ? "›" : "⌄"}</span>
	                              <span>{t(section.title)}</span>
	                            </button>
	                            <div className="agent-task-section__meta">
	                              <span>{t("agent_task_section_word_count").replace("{count}", String(section.content.length))}</span>
	                              {section.saved && <span>{t("agent_task_section_applied")}</span>}
	                              <button type="button" onClick={() => handleEditTaskSection(msg.id, section.taskId)}>
	                                {t("common_edit")}
	                              </button>
	                            </div>
	                          </div>
	                          {!section.collapsed && (
	                            <div className="agent-task-section__body">
	                              {section.editing ? (
	                                <>
	                                  <textarea
	                                    className="agent-task-section__editor"
	                                    value={section.draftContent ?? section.content}
	                                    onChange={(event) => handleTaskSectionDraftChange(msg.id, section.taskId, event.target.value)}
	                                  />
	                                  <div className="agent-task-section__actions">
	                                    <button
	                                      type="button"
	                                      onClick={() => handleApplyTaskSectionEdit(msg.id, section)}
	                                      disabled={section.saving}
	                                    >
	                                      {section.saving ? t("agent_task_section_applying") : t("agent_task_section_apply")}
	                                    </button>
	                                    <button
	                                      type="button"
	                                      onClick={() => handleCancelTaskSectionEdit(msg.id, section.taskId)}
	                                      disabled={section.saving}
	                                    >
	                                      {t("smart_writer_action_cancel")}
	                                    </button>
	                                  </div>
	                                </>
	                              ) : (
	                                <div className="agent-task-section__content">
	                                  {section.content || (msg.isStreaming ? t("agent_task_section_generating") : "")}
	                                </div>
	                              )}
	                            </div>
	                          )}
	                        </div>
	                      ))}
                        {msg.postTaskContent?.trim() && (
                          <div className="agent-message-post-task">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeAssistantContent(msg.postTaskContent)}</ReactMarkdown>
                          </div>
                        )}
                        {!isEmptyAssistant && showAssistantActivity && (
                          <AgentActivityIndicator label={activityLabel} />
                        )}
	                      {msg.isStreaming && msg.content.trim() && !showAssistantActivity && <span className="agent-cursor" aria-hidden="true" />}
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
	              className={`agent-send-btn${isLoading ? " agent-send-btn--stop" : ""}`}
	              onClick={isLoading ? handleInterrupt : handleSend}
	              disabled={!isLoading && !input.trim()}
	              aria-label={isLoading ? t("agent_chat_stop") : t("agent_chat_send")}
	            >
	              {isLoading ? (
	                <span className="agent-stop-icon" aria-hidden="true" />
	              ) : (
	                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
	                  <line x1="22" y1="2" x2="11" y2="13" />
	                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
	                </svg>
	              )}
	            </button>
          </div>
        </div>
      )}
    </>
  );
}
