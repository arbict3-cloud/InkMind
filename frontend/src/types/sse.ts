/**
 * SSE 流式传输类型定义
 */

export type SseEventType = "snapshot" | "patch" | "delta" | "status" | "question" | "agent_step" | "chapter_saved" | "chapter_deleted" | "error" | "done";

export interface SseSnapshotData {
  messages: SseMessage[];
  status: string;
  workflow_id?: string;
  current_phase?: string;
  pending_question?: PendingQuestionData;
  ts: number;
}

export interface SsePatchData {
  action: "append" | "replace_last" | "reset";
  message?: SseMessage;
}

export interface SseDeltaData {
  type: "text" | "thinking" | "input_json";
  content: string;
  message_id?: string;
  ts: number;
}

export interface SseStatusData {
  status: string;
  workflow_id?: string;
  current_phase?: string;
  ts: number;
}

export interface PendingQuestionData {
  question_id: string;
  question: string;
  options: string[];
  header?: string;
  allow_custom: boolean;
  ts: number;
}

export interface SseAgentStepData {
  step_type: "tool_call" | "tool_result" | "generating" | "evaluating" | "finish";
  tool_name?: string;
  tool_params?: Record<string, unknown>;
  thought?: string;
  result_preview?: string;
  step_number?: number;
  total_steps?: number;
  is_parallel: boolean;
  ts: number;
}

export interface SseErrorData {
  message: string;
  code?: string;
}

export interface SseChapterSavedData {
  id: number;
  title: string;
  novel_id: number;
  word_count: number;
  ts: number;
}

export interface SseChapterDeletedData {
  id: number;
  title: string;
  novel_id: number;
  ts: number;
}

export interface SseDoneData {
  done: true;
  workflow_id?: string;
  progress?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  chapter?: Record<string, unknown>;
  evaluate?: Record<string, unknown>;
}

export interface SseMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  ts: number;
  is_streaming?: boolean;
  agent_steps?: SseAgentStepData[];
}

export type SseEventMap = {
  snapshot: SseSnapshotData;
  patch: SsePatchData;
  delta: SseDeltaData;
  status: SseStatusData;
  question: PendingQuestionData;
  agent_step: SseAgentStepData;
  chapter_saved: SseChapterSavedData;
  chapter_deleted: SseChapterDeletedData;
  error: SseErrorData;
  done: SseDoneData;
};

export interface SseEvent<T extends SseEventType = SseEventType> {
  event_type: T;
  data: SseEventMap[T];
  id?: string;
}
