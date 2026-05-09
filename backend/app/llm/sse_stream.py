"""SSE (Server-Sent Events) 流式传输模块。

提供三层增量更新模型：
- snapshot: 完整状态快照（首次连接或重连时）
- patch: 增量补丁（新增/替换消息）
- delta: 流式增量（文本/思考/工具调用的逐 token 更新）
- status: 会话状态变更
- question: AskUserQuestion 交互请求
- agent_step: Agent 工具调用步骤
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterator

log = logging.getLogger(__name__)


@dataclass
class SseEvent:
    event_type: str
    data: dict[str, Any]
    id: str | None = None

    def encode(self) -> str:
        lines: list[str] = []
        if self.id:
            lines.append(f"id: {self.id}")
        lines.append(f"event: {self.event_type}")
        lines.append(f"data: {json.dumps(self.data, ensure_ascii=False)}")
        lines.append("")
        lines.append("")
        return "\n".join(lines)


def sse_snapshot(
    *,
    messages: list[dict[str, Any]] | None = None,
    status: str = "idle",
    workflow_id: str | None = None,
    current_phase: str | None = None,
    pending_question: dict[str, Any] | None = None,
) -> SseEvent:
    return SseEvent(
        event_type="snapshot",
        data={
            "messages": messages or [],
            "status": status,
            "workflow_id": workflow_id,
            "current_phase": current_phase,
            "pending_question": pending_question,
            "ts": time.time(),
        },
        id=str(uuid.uuid4()),
    )


def sse_patch(
    *,
    action: str = "append",
    message: dict[str, Any] | None = None,
    replace_last: bool = False,
) -> SseEvent:
    if replace_last:
        action = "replace_last"
    data: dict[str, Any] = {"action": action}
    if message:
        data["message"] = message
    return SseEvent(event_type="patch", data=data)


def sse_delta(
    *,
    delta_type: str = "text",
    content: str = "",
    message_id: str | None = None,
) -> SseEvent:
    return SseEvent(
        event_type="delta",
        data={
            "type": delta_type,
            "content": content,
            "message_id": message_id,
            "ts": time.time(),
        },
    )


def sse_status(
    *,
    status: str = "idle",
    workflow_id: str | None = None,
    current_phase: str | None = None,
) -> SseEvent:
    return SseEvent(
        event_type="status",
        data={
            "status": status,
            "workflow_id": workflow_id,
            "current_phase": current_phase,
            "ts": time.time(),
        },
    )


def sse_question(
    *,
    question_id: str,
    question: str,
    options: list[dict[str, str]] | None = None,
    header: str | None = None,
    allow_custom: bool = True,
    multi_select: bool = False,
    questions: list[dict[str, Any]] | None = None,
) -> SseEvent:
    return SseEvent(
        event_type="question",
        data={
            "question_id": question_id,
            "question": question,
            "options": options or [],
            "header": header,
            "allow_custom": allow_custom,
            "multi_select": multi_select,
            "questions": questions or [],
            "ts": time.time(),
        },
    )


def sse_agent_step(
    *,
    step_type: str = "tool_call",
    tool_name: str | None = None,
    tool_params: dict[str, Any] | None = None,
    thought: str | None = None,
    result_preview: str | None = None,
    phase_id: str | None = None,
    phase_status: str | None = None,
    phase_title: str | None = None,
    phase_detail: str | None = None,
    step_number: int | None = None,
    total_steps: int | None = None,
    is_parallel: bool = False,
) -> SseEvent:
    data: dict[str, Any] = {
        "step_type": step_type,
        "ts": time.time(),
    }
    if tool_name:
        data["tool_name"] = tool_name
    if tool_params:
        data["tool_params"] = tool_params
    if thought:
        data["thought"] = thought
    if result_preview:
        data["result_preview"] = result_preview
    if phase_id:
        data["phase_id"] = phase_id
    if phase_status:
        data["phase_status"] = phase_status
    if phase_title:
        data["phase_title"] = phase_title
    if phase_detail:
        data["phase_detail"] = phase_detail
    if step_number is not None:
        data["step_number"] = step_number
    if total_steps is not None:
        data["total_steps"] = total_steps
    data["is_parallel"] = is_parallel
    return SseEvent(event_type="agent_step", data=data)


def sse_error(*, message: str, code: str | None = None) -> SseEvent:
    data: dict[str, Any] = {"message": message}
    if code:
        data["code"] = code
    return SseEvent(event_type="error", data=data)


def sse_chapter_saved(
    *,
    chapter_id: int,
    chapter_number: int | None = None,
    title: str,
    novel_id: int,
    word_count: int = 0,
) -> SseEvent:
    data = {
        "id": chapter_id,
        "title": title,
        "novel_id": novel_id,
        "word_count": word_count,
        "ts": time.time(),
    }
    if chapter_number is not None:
        data["chapter_number"] = chapter_number
    return SseEvent(
        event_type="chapter_saved",
        data=data,
    )


def sse_chapter_deleted(
    *,
    chapter_id: int,
    title: str,
    novel_id: int,
) -> SseEvent:
    return SseEvent(
        event_type="chapter_deleted",
        data={
            "id": chapter_id,
            "title": title,
            "novel_id": novel_id,
            "ts": time.time(),
        },
    )


def sse_done(*, workflow_id: str | None = None, progress: dict[str, Any] | None = None) -> SseEvent:
    data: dict[str, Any] = {"done": True}
    if workflow_id:
        data["workflow_id"] = workflow_id
    if progress:
        data["progress"] = progress
    return SseEvent(event_type="done", data=data)


class SseStreamBuilder:
    """SSE 流构建器。

    将 Agent 执行过程中的各种事件转换为 SSE 事件流。
    支持将 NDJSON 风格的文本输出转换为 SSE delta 事件，
    同时支持 Agent 步骤、问题和状态事件。
    """

    def __init__(self, *, workflow_id: str | None = None) -> None:
        self._workflow_id = workflow_id
        self._message_id: str = str(uuid.uuid4())
        self._step_number = 0
        self._messages: list[dict[str, Any]] = []

    def build_initial_snapshot(
        self,
        *,
        status: str = "idle",
        current_phase: str | None = None,
        pending_question: dict[str, Any] | None = None,
    ) -> SseEvent:
        return sse_snapshot(
            messages=self._messages,
            status=status,
            workflow_id=self._workflow_id,
            current_phase=current_phase,
            pending_question=pending_question,
        )

    def build_user_message(self, content: str) -> SseEvent:
        msg = {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": content,
            "ts": time.time(),
        }
        self._messages.append(msg)
        return sse_patch(action="append", message=msg)

    def build_assistant_message_start(self, content: str = "") -> tuple[str, SseEvent]:
        msg_id = str(uuid.uuid4())
        msg = {
            "id": msg_id,
            "role": "assistant",
            "content": content,
            "ts": time.time(),
            "is_streaming": True,
        }
        self._messages.append(msg)
        self._message_id = msg_id
        return msg_id, sse_patch(action="append", message=msg)

    def build_text_delta(self, content: str) -> SseEvent:
        return sse_delta(delta_type="text", content=content, message_id=self._message_id)

    def build_thinking_delta(self, content: str) -> SseEvent:
        return sse_delta(delta_type="thinking", content=content, message_id=self._message_id)

    def build_tool_call_step(
        self,
        tool_name: str,
        params: dict[str, Any] | None = None,
        thought: str | None = None,
        is_parallel: bool = False,
    ) -> SseEvent:
        self._step_number += 1
        return sse_agent_step(
            step_type="tool_call",
            tool_name=tool_name,
            tool_params=params,
            thought=thought,
            step_number=self._step_number,
            is_parallel=is_parallel,
        )

    def build_tool_result_step(
        self,
        tool_name: str,
        result_preview: str | None = None,
    ) -> SseEvent:
        return sse_agent_step(
            step_type="tool_result",
            tool_name=tool_name,
            result_preview=result_preview,
        )

    def build_phase_step(
        self,
        phase_id: str,
        phase_status: str,
        *,
        title: str | None = None,
        detail: str | None = None,
    ) -> SseEvent:
        return sse_agent_step(
            step_type="phase",
            phase_id=phase_id,
            phase_status=phase_status,
            phase_title=title,
            phase_detail=detail,
        )

    def build_generation_start(self) -> SseEvent:
        self._step_number += 1
        return sse_agent_step(
            step_type="generating",
            tool_name="generate_chapter",
            step_number=self._step_number,
        )

    def build_finish_step(self, reason: str | None = None) -> SseEvent:
        return sse_agent_step(
            step_type="finish",
            thought=reason,
        )

    def build_question(
        self,
        question: str,
        *,
        question_id: str | None = None,
        options: list[dict[str, str]] | None = None,
        header: str | None = None,
        allow_custom: bool = True,
        multi_select: bool = False,
        questions: list[dict[str, Any]] | None = None,
    ) -> SseEvent:
        return sse_question(
            question_id=question_id or str(uuid.uuid4()),
            question=question,
            options=options,
            header=header,
            allow_custom=allow_custom,
            multi_select=multi_select,
            questions=questions,
        )

    def build_status(self, status: str, current_phase: str | None = None) -> SseEvent:
        return sse_status(
            status=status,
            workflow_id=self._workflow_id,
            current_phase=current_phase,
        )

    def build_chapter_saved(
        self,
        *,
        chapter_id: int,
        chapter_number: int | None = None,
        title: str,
        novel_id: int,
        word_count: int = 0,
    ) -> SseEvent:
        return sse_chapter_saved(
            chapter_id=chapter_id,
            chapter_number=chapter_number,
            title=title,
            novel_id=novel_id,
            word_count=word_count,
        )

    def build_chapter_deleted(
        self,
        *,
        chapter_id: int,
        title: str,
        novel_id: int,
    ) -> SseEvent:
        return sse_chapter_deleted(
            chapter_id=chapter_id,
            title=title,
            novel_id=novel_id,
        )

    def build_done(self, progress: dict[str, Any] | None = None) -> SseEvent:
        return sse_done(workflow_id=self._workflow_id, progress=progress)

    def build_error(self, message: str) -> SseEvent:
        return sse_error(message=message)


def convert_ndjson_chunk_to_sse(
    chunk: str,
    builder: SseStreamBuilder,
) -> list[SseEvent]:
    """将 NDJSON 风格的文本 chunk 转换为 SSE 事件列表。

    识别 [调用工具]、[工具结果]、[开始生成正文]、[完成]、[错误] 等标记，
    转换为对应的 agent_step / delta 事件。
    """
    events: list[SseEvent] = []

    if chunk.startswith("[调用工具]"):
        tool_match = chunk.replace("[调用工具]", "").strip()
        tool_name = tool_match.split("参数")[0].strip() if "参数" in tool_match else tool_match.strip()
        events.append(builder.build_tool_call_step(tool_name))

    elif chunk.startswith("[工具结果]"):
        tool_name = chunk.replace("[工具结果]", "").replace("执行完成", "").strip()
        events.append(builder.build_tool_result_step(tool_name))

    elif chunk.startswith("[并行调用工具]"):
        events.append(builder.build_tool_call_step("parallel", is_parallel=True))

    elif chunk.startswith("[并行调用完成]"):
        events.append(builder.build_tool_result_step("parallel"))

    elif chunk.startswith("[开始生成正文]"):
        events.append(builder.build_generation_start())

    elif chunk.startswith("[完成]"):
        reason = chunk.replace("[完成]", "").strip()
        events.append(builder.build_finish_step(reason or None))

    elif chunk.startswith("[错误]"):
        error_msg = chunk.replace("[错误]", "").strip()
        events.append(builder.build_error(error_msg))

    elif chunk.startswith("[系统]"):
        pass
    else:
        events.append(builder.build_text_delta(chunk))

    return events
