import type { SseAgentStepData } from "@/types/sse";
import { useI18n } from "@/i18n";

export interface AgentStepDisplayProps {
  steps: SseAgentStepData[];
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_novel_context: "📖 获取作品设定",
  get_previous_chapters: "📋 获取前文概要",
  get_character_profiles: "👤 获取人物设定",
  generate_chapter: "✍️ 生成章节正文",
  finish: "✅ 完成任务",
  ask_user: "❓ 询问用户",
  direct_generation: "⚡ 直接生成",
  flexible_agent: "🤖 智能体生成",
  react_agent: "🔄 推理生成",
  auto_audit: "🔍 自动审核",
  parallel: "⚡ 并行调用",
  get_novel_state: "📊 获取作品状态",
  get_chapters: "📋 获取章节列表",
  get_chapter_detail: "📄 获取章节详情",
  get_characters: "👤 获取人物设定",
  get_memos: "📝 获取备忘录",
  dispatch_generation_task: "🚀 调度生成任务",
  poll_task_result: "⏳ 轮询任务结果",
  poll_multiple_tasks: "⏳ 批量轮询任务",
  save_chapter: "💾 保存章节",
};

function getStepIcon(step: SseAgentStepData): string {
  switch (step.step_type) {
    case "tool_call":
      return "🔧";
    case "tool_result":
      return "✓";
    case "generating":
      return "✍️";
    case "evaluating":
      return "🔍";
    case "finish":
      return "✅";
    default:
      return "•";
  }
}

function getStepLabel(step: SseAgentStepData, t: (key: string) => string): string {
  const toolName = step.tool_name || "";
  const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName;

  switch (step.step_type) {
    case "tool_call":
      if (step.is_parallel) {
        return t("agent_step_parallel_call") || "并行调用工具";
      }
      return `${t("agent_step_calling") || "正在调用"} ${displayName}`;
    case "tool_result":
      return `${displayName} ${t("agent_step_completed") || "完成"}`;
    case "generating":
      return `${t("agent_step_generating") || "正在生成内容"}...`;
    case "evaluating":
      return `${t("agent_step_evaluating") || "正在评估内容"}...`;
    case "finish":
      return step.thought || (t("agent_step_finished") || "任务完成");
    default:
      return displayName;
  }
}

export default function AgentStepDisplay({ steps }: AgentStepDisplayProps) {
  const { t } = useI18n();

  if (!steps.length) return null;

  return (
    <div className="ai-assistant-agent-steps">
      {steps.map((step, idx) => {
        const isActive =
          step.step_type === "tool_call" ||
          step.step_type === "generating" ||
          step.step_type === "evaluating";

        return (
          <div
            key={idx}
            className={`ai-assistant-agent-step${
              isActive ? " ai-assistant-agent-step--active" : ""
            }${
              step.step_type === "tool_result" || step.step_type === "finish"
                ? " ai-assistant-agent-step--done"
                : ""
            }`}
          >
            <span className="ai-assistant-agent-step__icon">
              {getStepIcon(step)}
            </span>
            <span className="ai-assistant-agent-step__label">
              {getStepLabel(step, t)}
            </span>
            {step.thought && step.step_type !== "finish" && (
              <span className="ai-assistant-agent-step__thought">
                {step.thought}
              </span>
            )}
            {isActive && (
              <span className="ai-assistant-agent-step__pulse" />
            )}
          </div>
        );
      })}
    </div>
  );
}
