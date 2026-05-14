import { useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import type { SseAgentStepData } from "@/types/sse";

interface Props {
  steps: SseAgentStepData[];
}

type StepStatus = "running" | "done" | "error" | "cancelled";
type PhaseStatus = "pending" | "running" | "done" | "error" | "cancelled";

interface GroupedStep {
  rawName: string;
  tool_name: string;
  label: string;
  status: StepStatus;
  result?: string;
  count: number;
}

interface PhaseItem {
  id: string;
  title: string;
  status: PhaseStatus;
  detail?: string;
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
  delete_chapter: "agent_tool_delete_chapter",
  ask_user: "agent_tool_ask_user",
  agent_connect: "agent_tool_agent_connect",
  agent_query: "agent_tool_agent_query",
  get_writing_context_pack: "agent_tool_get_writing_context_pack",
  quality_check_chapter: "agent_tool_quality_check_chapter",
};

const PHASE_ORDER = [
  "read_context",
  "chapter_summary",
  "user_confirm",
  "chapter_content",
  "quality_check",
  "save_chapter",
];

const PHASE_I18N: Record<string, string> = {
  read_context: "agent_phase_read_context",
  chapter_summary: "agent_phase_chapter_summary",
  user_confirm: "agent_phase_user_confirm",
  chapter_content: "agent_phase_chapter_content",
  quality_check: "agent_phase_quality_check",
  save_chapter: "agent_phase_save_chapter",
};

function cleanToolName(raw: string): string {
  return raw
    .replace(/^mcp__inkmind__/, "")
    .replace(/^mcp_+inkmind_+/, "")
    .replace(/^InkMind::/, "");
}

function isInternalTool(name: string): boolean {
  return /^tool_[a-f0-9_]+$/.test(name);
}

function groupSteps(steps: SseAgentStepData[], t: (key: string) => string): GroupedStep[] {
  const result: GroupedStep[] = [];
  const groupedByTool = new Map<string, number>();

  const upsertTool = (rawName: string, status: StepStatus, resultPreview?: string) => {
    const displayName = cleanToolName(rawName);
    if (isInternalTool(displayName)) return;
    const existingIdx = groupedByTool.get(displayName);
    const preview = resultPreview
      ? resultPreview.length > 96 ? resultPreview.slice(0, 96) + "…" : resultPreview
      : undefined;

    if (existingIdx !== undefined) {
      const existing = result[existingIdx];
      existing.count += status === "running" ? 1 : 0;
      existing.status = status;
      if (preview) existing.result = preview;
      return;
    }

    const idx = result.length;
    groupedByTool.set(displayName, idx);
    result.push({
      rawName,
      tool_name: displayName,
      label: `${t("agent_step_calling")} ${displayName}`,
      status,
      result: preview,
      count: 1,
    });
  };

  for (const step of steps) {
    if (step.step_type === "phase") {
      continue;
    }
    if (step.step_type === "tool_call") {
      const rawName = step.tool_name || "unknown";
      upsertTool(rawName, "running");
    } else if (step.step_type === "tool_result") {
      const rawName = step.tool_name || "unknown";
      upsertTool(rawName, "done", step.result_preview || undefined);
    } else if (step.step_type === "generating") {
      result.push({
        rawName: "generating",
        tool_name: "",
        label: t("agent_step_generating"),
        status: "running",
        count: 1,
      });
    } else if (step.step_type === "evaluating") {
      result.push({
        rawName: "evaluating",
        tool_name: "",
        label: t("agent_step_evaluating"),
        status: "running",
        count: 1,
      });
    } else if (step.step_type === "finish") {
      for (const item of result) {
        if (item.status === "running") item.status = step.thought === "cancelled" ? "cancelled" : "done";
      }
    }
  }

  return result;
}

function collectPhases(steps: SseAgentStepData[], t: (key: string) => string): PhaseItem[] {
  const latest = new Map<string, PhaseItem>();
  for (const step of steps) {
    if (step.step_type !== "phase" || !step.phase_id) continue;
    latest.set(step.phase_id, {
      id: step.phase_id,
      title: step.phase_title || t(PHASE_I18N[step.phase_id] || step.phase_id),
      status: step.phase_status || "pending",
      detail: step.phase_detail,
    });
  }
  return PHASE_ORDER
    .filter((id) => latest.has(id))
    .map((id) => latest.get(id)!)
    .concat([...latest.values()].filter((phase) => !PHASE_ORDER.includes(phase.id)));
}

function statusIcon(status: StepStatus) {
  if (status === "done") return "✓";
  if (status === "error") return "✗";
  if (status === "cancelled") return "×";
  return "→";
}

function phaseIcon(status: PhaseStatus) {
  if (status === "done") return "✓";
  if (status === "error") return "!";
  if (status === "cancelled") return "×";
  if (status === "running") return "•";
  return "";
}

export default function AgentStepDisplay({ steps }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const grouped = useMemo(() => groupSteps(steps, t), [steps, t]);
  const phases = useMemo(() => collectPhases(steps, t), [steps, t]);
  const runningCount = grouped.filter((group) => group.status === "running").length;
  const totalCalls = grouped.reduce((sum, group) => sum + group.count, 0);
  const activePhase = phases.find((phase) => phase.status === "running");

  if (!steps.length) return null;

  return (
    <div className="ai-assistant-agent-steps">
      <button
        type="button"
        className="ai-assistant-agent-steps__header"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="ai-assistant-agent-steps__title">
          {phases.length > 0 ? t("agent_phases_title") : t("agent_steps_title")}
        </span>
        <span className="ai-assistant-agent-steps__meta">
          {activePhase
            ? t(PHASE_I18N[activePhase.id] || activePhase.title)
            : runningCount > 0
              ? t("agent_steps_running").replace("{count}", String(runningCount))
              : t("agent_steps_done").replace("{count}", String(totalCalls))}
        </span>
        <span className={`ai-assistant-agent-steps__chevron${collapsed ? " is-collapsed" : ""}`}>⌃</span>
      </button>
      {!collapsed && phases.length > 0 && (
        <div className="ai-assistant-phase-timeline" aria-label={t("agent_phases_title")}>
          {phases.map((phase) => (
            <div key={phase.id} className={`ai-assistant-phase ai-assistant-phase--${phase.status}`}>
              <span className="ai-assistant-phase__rail" />
              <span className="ai-assistant-phase__dot">{phaseIcon(phase.status)}</span>
              <span className="ai-assistant-phase__body">
                <span className="ai-assistant-phase__title">{t(PHASE_I18N[phase.id] || phase.title)}</span>
                {phase.detail && <span className="ai-assistant-phase__detail">{phase.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {!collapsed && (
        <div className="ai-assistant-agent-steps__list">
          {grouped.map((group, i) => (
            <div key={`${group.rawName}-${i}`} className={`ai-assistant-agent-step ai-assistant-agent-step--${group.status}`}>
              <span className="ai-assistant-agent-step__icon">{statusIcon(group.status)}</span>
              <span className="ai-assistant-agent-step__label">
                {group.tool_name
                  ? t(TOOL_DISPLAY_NAMES[group.tool_name] || group.tool_name)
                  : group.label}
              </span>
              {group.count > 1 && <span className="ai-assistant-agent-step__count">×{group.count}</span>}
              {group.status === "running" && <span className="ai-assistant-agent-step__pulse" />}
              {group.result && (
                <span className="ai-assistant-agent-step__result">{group.result}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {collapsed && grouped.length > 0 && (
        <div className="ai-assistant-agent-steps__summary">
          {grouped.slice(0, 4).map((group) => (
            <span key={group.tool_name || group.label} className={`ai-assistant-agent-steps__chip ai-assistant-agent-steps__chip--${group.status}`}>
              {group.tool_name ? t(TOOL_DISPLAY_NAMES[group.tool_name] || group.tool_name) : group.label}
              {group.count > 1 ? ` ×${group.count}` : ""}
            </span>
          ))}
          {grouped.length > 4 && (
            <span className="ai-assistant-agent-steps__chip">+{grouped.length - 4}</span>
          )}
        </div>
      )}
    </div>
  );
}
