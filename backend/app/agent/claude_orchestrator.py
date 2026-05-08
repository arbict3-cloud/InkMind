"""Claude 编排器 —— 项目总指挥。

使用 claude-agent-sdk 的 ClaudeSDKClient 实现 Claude 作为总指挥：
- 理解用户意图
- 管理项目状态（通过 @tool 定义的 MCP 工具读 DB）
- 拆解任务步骤
- 调度子智能体（Qwen/Minimax）执行内容生成
- 与用户对话（问偏好、确认继续、展示摘要）

核心流程：
1. 用户消息 → ClaudeSDKClient.query() → Claude 推理
2. Claude 调用 MCP 工具（get_novel_state / dispatch_generation_task / ask_user 等）
3. 工具结果 → Claude 继续推理 → 可能再调用工具或回复用户
4. 生成任务 → 写入 TaskQueue → 子智能体执行 → 结果返回 Claude
5. SDK 消息流 → 转换为 SSE 事件 → 前端实时展示
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    UserMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    ResultMessage,
    create_sdk_mcp_server,
)

from app.agent.agent_tools import ALL_TOOLS, ALL_TOOL_NAMES, init_tool_context
from app.agent.sub_agent import register_sub_agent_handlers
from app.agent.task_queue import get_task_queue
from app.config import settings
from app.database import SessionLocal
from app.language import Language
from app.llm.sse_stream import SseEvent, SseStreamBuilder, sse_agent_step, sse_error
from app.models import Novel, User

log = logging.getLogger(__name__)

_ORCHESTRATOR_SYSTEM_PROMPT = """你是 InkMind 的 AI 创作总监（项目总指挥）。你的职责是：

1. **理解用户意图**：分析用户的创作需求，判断需要执行什么操作
2. **管理项目状态**：通过工具读取小说的当前进度、章节、人物等
3. **拆解任务步骤**：将复杂的创作需求分解为可执行的步骤
4. **调度子智能体**：将内容生成任务派发给专业的执行模型
5. **与用户对话**：询问创作偏好、确认继续、展示摘要等

## 工作原则

- 你是**总指挥**，不直接生成小说正文，而是调度子智能体执行
- 先了解项目状态，再制定计划，最后执行
- 主动向用户确认关键决策（风格、方向、字数等）
- 生成任务提交后，轮询等待结果，然后向用户汇报
- 用中文与用户交流
- **引用章节时务必使用 chapter_number 字段**（如"第3章"），不要使用 id 或 sort_order

## 可用操作

- 读取作品信息、章节列表、人物设定、备忘录
- 调度章节生成、摘要生成、批量规划、改写、续写、命名等任务
- 向用户提问以获取确认或偏好
- 将生成结果保存为正式章节
"""


@dataclass
class OrchestratorSession:
    session_id: str
    novel_id: int
    user_id: int
    sdk_client: ClaudeSDKClient | None = None
    pending_question: dict[str, Any] | None = None
    pending_task_ids: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "novel_id": self.novel_id,
            "user_id": self.user_id,
            "pending_question": self.pending_question,
            "pending_task_ids": self.pending_task_ids,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


_active_sessions: dict[str, OrchestratorSession] = {}


def _build_mcp_server(novel_id: int) -> dict[str, Any]:
    init_tool_context(SessionLocal, novel_id)
    return create_sdk_mcp_server(
        name="inkmind",
        version="1.0.0",
        tools=ALL_TOOLS,
    )


def _build_agent_options(novel_id: int) -> ClaudeAgentOptions:
    mcp_server = _build_mcp_server(novel_id)
    options_kwargs: dict[str, Any] = {
        "system_prompt": _ORCHESTRATOR_SYSTEM_PROMPT,
        "mcp_servers": {"inkmind": mcp_server},
        "allowed_tools": ALL_TOOL_NAMES,
        "permission_mode": settings.agent_permission_mode,
        "max_turns": settings.agent_max_turns,
    }
    if settings.claude_cli_path:
        options_kwargs["cli_path"] = settings.claude_cli_path
    if settings.anthropic_model:
        options_kwargs["model"] = settings.anthropic_model
    return ClaudeAgentOptions(**options_kwargs)


class ClaudeOrchestrator:
    """Claude 编排器。

    使用 claude-agent-sdk 的 ClaudeSDKClient 实现 Claude 作为项目总指挥。
    """

    def __init__(
        self,
        db_session_factory: Any,
        novel: Novel,
        user: User,
        language: Language = "zh",
    ) -> None:
        self._db_session_factory = db_session_factory
        self._novel = novel
        self._user = user
        self._language = language
        self._queue = get_task_queue()
        register_sub_agent_handlers(
            self._queue, db_session_factory(), novel, language
        )

    def create_session(self) -> OrchestratorSession:
        session_id = f"osess_{uuid.uuid4().hex[:12]}"
        session = OrchestratorSession(
            session_id=session_id,
            novel_id=self._novel.id,
            user_id=self._user.id,
        )
        _active_sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> OrchestratorSession | None:
        return _active_sessions.get(session_id)

    async def chat(
        self,
        session: OrchestratorSession,
        user_message: str,
    ) -> AsyncIterator[SseEvent]:
        """处理用户消息，返回 SSE 事件流。

        使用 ClaudeSDKClient 与 Claude 交互：
        1. 创建/复用 SDK Client
        2. 发送用户消息
        3. 接收 Claude 的响应流
        4. 将 SDK 消息转换为 SSE 事件
        """
        builder = SseStreamBuilder(workflow_id=session.session_id)

        yield builder.build_user_message(user_message)
        yield builder.build_status("running")

        try:
            if session.sdk_client is None:
                options = _build_agent_options(session.novel_id)
                client = ClaudeSDKClient(options=options)
                await client.connect()
                session.sdk_client = client
            else:
                client = session.sdk_client

            await client.query(user_message)

            full_text = ""
            msg_id = str(uuid.uuid4())
            _, start_event = builder.build_assistant_message_start("")
            yield start_event

            pending_tool_calls: dict[str, str] = {}

            async for message in client.receive_response():
                log.debug("SDK message type=%s", type(message).__name__)
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            full_text += block.text
                            yield builder.build_text_delta(block.text)
                        elif isinstance(block, ToolUseBlock):
                            tool_name = block.name
                            tool_input = block.input
                            tool_id = block.id
                            log.info("ToolUseBlock: name=%s, input_keys=%s", tool_name, list(tool_input.keys()) if isinstance(tool_input, dict) else "non-dict")

                            if "save_chapter" in tool_name:
                                pending_tool_calls[tool_id] = "save_chapter"

                            if "ask_user" in tool_name:
                                question = tool_input.get("question", "") if isinstance(tool_input, dict) else ""
                                options = tool_input.get("options") if isinstance(tool_input, dict) else None
                                header = tool_input.get("header") if isinstance(tool_input, dict) else None
                                allow_custom = tool_input.get("allow_custom", True) if isinstance(tool_input, dict) else True

                                yield builder.build_tool_call_step(
                                    tool_name=tool_name,
                                    params=tool_input if isinstance(tool_input, dict) else None,
                                    thought=f"调用 {tool_name}",
                                )
                                yield builder.build_tool_result_step(
                                    tool_name=tool_name,
                                    result_preview="等待用户回答",
                                )
                                yield builder.build_question(
                                    question=question,
                                    options=options,
                                    header=header,
                                    allow_custom=allow_custom,
                                )
                                session.pending_question = {
                                    "question": question,
                                    "options": options,
                                    "header": header,
                                    "allow_custom": allow_custom,
                                }
                                yield builder.build_status("idle")
                                yield builder.build_done()

                                async for _msg in client.receive_response():
                                    pass

                                return

                            yield builder.build_tool_call_step(
                                tool_name=tool_name,
                                params=tool_input if isinstance(tool_input, dict) else None,
                                thought=f"调用 {tool_name}",
                            )

                elif isinstance(message, UserMessage):
                    if isinstance(message.content, list):
                        for block in message.content:
                            if isinstance(block, ToolResultBlock):
                                tool_use_id = block.tool_use_id
                                preview = ""
                                if block.content:
                                    for c in block.content:
                                        if hasattr(c, "text"):
                                            preview = c.text[:200]
                                            break

                                tracked_tool = pending_tool_calls.pop(tool_use_id, None)
                                if tracked_tool == "save_chapter" and preview:
                                    try:
                                        result_data = json.loads(preview)
                                        if result_data.get("success"):
                                            yield builder.build_chapter_saved(
                                                chapter_id=result_data["chapter_id"],
                                                title=result_data.get("title", ""),
                                                novel_id=session.novel_id,
                                                word_count=result_data.get("word_count", 0),
                                            )
                                    except (json.JSONDecodeError, KeyError):
                                        pass

                                yield builder.build_tool_result_step(
                                    tool_name=f"tool_{tool_use_id[:8]}",
                                    result_preview=preview,
                                )

                elif isinstance(message, ResultMessage):
                    if message.is_error:
                        err_msg = message.result or "Agent 执行出错"
                        if message.errors:
                            err_msg = "; ".join(message.errors)
                        yield builder.build_error(err_msg)
                    elif message.result:
                        full_text += message.result
                        yield builder.build_text_delta(message.result)

            yield builder.build_status("idle")
            yield builder.build_done()

        except Exception as e:
            log.exception("ClaudeOrchestrator chat error")
            yield builder.build_error(f"Agent 调用失败: {e}")
            yield builder.build_status("idle")
            yield builder.build_done()

    async def answer_question(
        self,
        session: OrchestratorSession,
        question_id: str,
        answer: str,
        selected_option: str | None = None,
    ) -> AsyncIterator[SseEvent]:
        """用户回答了 Claude 的问题，继续对话。

        将用户回答作为新消息发送给 SDK Client，
        Claude 会看到之前的 ask_user 调用和用户的回答，
        然后继续推理。
        """
        answer_text = selected_option or answer
        session.pending_question = None
        builder = SseStreamBuilder(workflow_id=session.session_id)

        yield builder.build_user_message(answer_text)
        yield builder.build_status("running")

        try:
            client = session.sdk_client
            if client is None:
                async for event in self.chat(session, answer_text):
                    yield event
                return

            await client.query(answer_text)

            full_text = ""
            pending_tool_calls: dict[str, str] = {}
            async for message in client.receive_response():
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            full_text += block.text
                            yield builder.build_text_delta(block.text)
                        elif isinstance(block, ToolUseBlock):
                            tool_name = block.name
                            tool_input = block.input
                            tool_id = block.id

                            if "save_chapter" in tool_name:
                                pending_tool_calls[tool_id] = "save_chapter"

                            if "ask_user" in tool_name:
                                question = tool_input.get("question", "") if isinstance(tool_input, dict) else ""
                                options = tool_input.get("options") if isinstance(tool_input, dict) else None
                                header = tool_input.get("header") if isinstance(tool_input, dict) else None
                                allow_custom = tool_input.get("allow_custom", True) if isinstance(tool_input, dict) else True

                                yield builder.build_tool_call_step(
                                    tool_name=tool_name,
                                    params=tool_input if isinstance(tool_input, dict) else None,
                                    thought=f"调用 {tool_name}",
                                )
                                yield builder.build_tool_result_step(
                                    tool_name=tool_name,
                                    result_preview="等待用户回答",
                                )
                                yield builder.build_question(
                                    question=question,
                                    options=options,
                                    header=header,
                                    allow_custom=allow_custom,
                                )
                                session.pending_question = {
                                    "question": question,
                                    "options": options,
                                    "header": header,
                                    "allow_custom": allow_custom,
                                }
                                yield builder.build_status("idle")
                                yield builder.build_done()

                                async for _msg in client.receive_response():
                                    pass

                                return

                            yield builder.build_tool_call_step(
                                tool_name=tool_name,
                                params=tool_input if isinstance(tool_input, dict) else None,
                                thought=f"调用 {tool_name}",
                            )

                elif isinstance(message, UserMessage):
                    if isinstance(message.content, list):
                        for block in message.content:
                            if isinstance(block, ToolResultBlock):
                                tool_use_id = block.tool_use_id
                                preview = ""
                                if block.content:
                                    for c in block.content:
                                        if hasattr(c, "text"):
                                            preview = c.text[:200]
                                            break

                                tracked_tool = pending_tool_calls.pop(tool_use_id, None)
                                if tracked_tool == "save_chapter" and preview:
                                    try:
                                        result_data = json.loads(preview)
                                        if result_data.get("success"):
                                            yield builder.build_chapter_saved(
                                                chapter_id=result_data["chapter_id"],
                                                title=result_data.get("title", ""),
                                                novel_id=session.novel_id,
                                                word_count=result_data.get("word_count", 0),
                                            )
                                    except (json.JSONDecodeError, KeyError):
                                        pass

                                yield builder.build_tool_result_step(
                                    tool_name=f"tool_{tool_use_id[:8]}",
                                    result_preview=preview,
                                )

                elif isinstance(message, ResultMessage):
                    if message.is_error:
                        err_msg = message.result or "Agent 执行出错"
                        if message.errors:
                            err_msg = "; ".join(message.errors)
                        yield builder.build_error(err_msg)
                    elif message.result:
                        full_text += message.result
                        yield builder.build_text_delta(message.result)

            yield builder.build_status("idle")
            yield builder.build_done()

        except Exception as e:
            log.exception("ClaudeOrchestrator answer_question error")
            yield builder.build_error(f"Agent 调用失败: {e}")
            yield builder.build_status("idle")
            yield builder.build_done()

    async def close_session(self, session: OrchestratorSession) -> None:
        """关闭会话，释放 SDK Client 资源。"""
        if session.sdk_client is not None:
            try:
                await session.sdk_client.disconnect()
            except Exception as e:
                log.warning("Failed to disconnect SDK client: %s", e)
            session.sdk_client = None
        _active_sessions.pop(session.session_id, None)
