import { useI18n } from "@/i18n";
import type { SseAgentStepData } from "@/types/sse";

interface Props {
  steps: SseAgentStepData[];
}

type StepStatus = "running" | "done" | "error";

interface GroupedStep {
  rawName: string;
  tool_name: string;
  label: string;
  status: StepStatus;
  result?: string;
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
};

function cleanToolName(raw: string): string {
  return raw
    .replace(/^mcp__inkmind__/, "")
    .replace(/^InkMind::/, "");
}

function isInternalTool(name: string): boolean {
  return /^tool_[a-f0-9_]+$/.test(name);
}

function groupSteps(steps: SseAgentStepData[], t: (key: string) => string): GroupedStep[] {
  const result: GroupedStep[] = [];
  const pendingCalls = new Map<string, number>();

  for (const step of steps) {
    if (step.step_type === "tool_call") {
      const rawName = step.tool_name || "unknown";
      const displayName = cleanToolName(rawName);
      if (isInternalTool(displayName)) continue;
      const idx = result.length;
      pendingCalls.set(displayName, idx);
      result.push({
        rawName,
        tool_name: displayName,
        label: `${t("agent_step_calling")} ${displayName}`,
        status: "running",
      });
    } else if (step.step_type === "tool_result") {
      const rawName = step.tool_name || "unknown";
      const displayName = cleanToolName(rawName);
      const pendingIdx = pendingCalls.get(displayName);

      if (pendingIdx !== undefined) {
        result[pendingIdx].status = "done";
        const preview = step.result_preview || "";
        if (preview) {
          result[pendingIdx].result = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;
        }
        pendingCalls.delete(displayName);
      } else if (!isInternalTool(displayName)) {
        result.push({
          rawName,
          tool_name: displayName,
          label: displayName,
          status: "done",
          result: step.result_preview || undefined,
        });
      }
    } else if (step.step_type === "generating") {
      result.push({
        rawName: "generating",
        tool_name: "",
        label: t("agent_step_generating"),
        status: "running",
      });
    } else if (step.step_type === "evaluating") {
      result.push({
        rawName: "evaluating",
        tool_name: "",
        label: t("agent_step_evaluating"),
        status: "running",
      });
    } else if (step.step_type === "finish") {
      for (const item of result) {
        if (item.status === "running") item.status = "done";
      }
    }
  }

  return result;
}

function statusIcon(status: StepStatus) {
  if (status === "done") return "✓";
  if (status === "error") return "✗";
  return "→";
}

export default function AgentStepDisplay({ steps }: Props) {
  const { t } = useI18n();

  if (!steps.length) return null;

  const grouped = groupSteps(steps, t);

  return (
    <div className="ai-assistant-agent-steps">
      {grouped.map((group, i) => (
        <div key={i} className={`ai-assistant-agent-step ai-assistant-agent-step--${group.status}`}>
          <span className="ai-assistant-agent-step__icon">{statusIcon(group.status)}</span>
          <span className="ai-assistant-agent-step__label">
            {group.tool_name
              ? t(TOOL_DISPLAY_NAMES[group.rawName] || group.rawName) || group.tool_name
              : group.label}
          </span>
          {group.status === "running" && <span className="ai-assistant-agent-step__pulse" />}
          {group.result && (
            <span className="ai-assistant-agent-step__result">{group.result}</span>
          )}
        </div>
      ))}
    </div>
  );
}
