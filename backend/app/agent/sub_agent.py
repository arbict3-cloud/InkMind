"""子智能体执行器。

Qwen/Minimax/DeepSeek 等模型作为专业执行者，
只负责文本内容生成（章节正文、摘要、命名等），
由 ClaudeOrchestrator 调度。

设计原则：
- 子智能体不参与决策，只执行具体的生成任务
- 每个子智能体任务通过 TaskQueue 解耦
- 执行结果返回给 ClaudeOrchestrator 继续处理
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterator

from sqlalchemy.orm import Session

from app.agent.memory import NovelMemory
from app.agent.task_queue import AgentTask, AgentTaskQueue, get_task_queue
from app.config import settings
from app.language import Language
from app.llm.base import LLMProvider
from app.llm.metered_llm import LLMUsageAccumulator
from app.llm.providers import get_llm, resolve_llm_for_user
from app.llm.ndjson_stream import filter_think_chunks
from app.models import Chapter, Character, Novel
from app.prompts import get_prompt

log = logging.getLogger(__name__)

_BG_MAX = 2200
_WRITING_STYLE_MAX = 700
_SUMMARY_LINE_MAX = 320
_TASK_SUMMARY_MAX = 2800


def _clip(s: str | None, n: int) -> str:
    t = (s or "").strip()
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"


def _strip_code_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.MULTILINE)
        s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def _resolve_sub_agent_llm(
    explicit_provider: str | None = None,
) -> LLMProvider:
    provider = explicit_provider or settings.default_llm_provider
    if provider == "anthropic":
        fallback = "qwen" if settings.qwen_api_key else "openai"
        log.info(
            "Sub-agent: anthropic is reserved for orchestrator, using %s for content generation",
            fallback,
        )
        provider = fallback
    return get_llm(provider)


class SubAgentExecutor:
    """子智能体执行器。

    提供各种文本生成能力，由 ClaudeOrchestrator 通过 TaskQueue 调度。
    """

    def __init__(self, db: Session, novel: Novel, language: Language = "zh") -> None:
        self._db = db
        self._novel = novel
        self._language = language

    async def execute_generate_chapter(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_summary = params.get("chapter_summary", "")
        fixed_title = params.get("fixed_title")
        word_count = params.get("word_count")
        sub_provider = params.get("sub_agent_provider")

        llm = _resolve_sub_agent_llm(sub_provider)
        memory = NovelMemory(self._db, self._novel)
        context = memory.build_context(chapter_summary)

        word_count_req = ""
        if word_count and 500 <= word_count <= 4000:
            word_count_req = get_prompt("gen_word_count_req", self._language, count=word_count)

        if fixed_title:
            system = get_prompt("gen_system_fixed_title", self._language, word_count_req=word_count_req)
            title_line = get_prompt("gen_title_line_fixed", self._language, title=fixed_title.strip())
        else:
            system = get_prompt("gen_system_dynamic_title", self._language, word_count_req=word_count_req)
            title_line = ""

        summary_display = _clip(chapter_summary, _TASK_SUMMARY_MAX) or get_prompt("common_none", self._language)
        user = (
            context + "\n\n" +
            get_prompt("gen_user_task", self._language, summary=summary_display) +
            title_line + "\n\n" +
            get_prompt("gen_user_warning", self._language)
        )

        raw = "".join(filter_think_chunks(llm.stream_complete(system, user))).strip()
        text = _strip_code_fence(raw)

        title_out = ""
        body_text = text
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                title_out = str(data.get("title") or "").strip()
                body_text = str(data.get("body") or "").strip()
        except json.JSONDecodeError:
            pass

        if fixed_title:
            title_out = fixed_title

        return {
            "title": title_out,
            "body": body_text,
            "word_count": len(body_text),
            "provider": sub_provider or settings.default_llm_provider,
        }

    async def execute_generate_summary(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_content = params.get("chapter_content", "")
        chapter_title = params.get("chapter_title", "")

        llm = _resolve_sub_agent_llm(params.get("sub_agent_provider"))
        system = get_prompt("summarize_body_system", self._language)
        title_display = chapter_title or get_prompt("common_none", self._language)
        user_msg = get_prompt(
            "summarize_body_user",
            self._language,
            title=title_display,
            content=chapter_content[:8000],
        )
        summary = llm.complete(system, user_msg).strip()

        return {"summary": summary}

    async def execute_generate_batch_plan(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        total_summary = params.get("total_summary", "")
        chapter_count = params.get("chapter_count", 1)

        llm = _resolve_sub_agent_llm(params.get("sub_agent_provider"))
        memory = NovelMemory(self._db, self._novel)
        context = memory.build_context(total_summary)

        from app.services.chapter_gen import plan_batch_chapters
        plan = plan_batch_chapters(
            self._db,
            self._novel,
            llm,
            total_summary=total_summary,
            chapter_count=chapter_count,
            language=self._language,
        )

        return {"chapters": plan}

    async def execute_revise_chapter(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_id = params.get("chapter_id")
        instruction = params.get("instruction", "")

        chapter = self._db.query(Chapter).filter(Chapter.id == chapter_id).first()
        if not chapter:
            return {"error": f"章节 {chapter_id} 不存在"}

        llm = _resolve_sub_agent_llm(params.get("sub_agent_provider"))
        from app.services.chapter_llm import revise_chapter_body
        revised = revise_chapter_body(llm, self._novel, chapter, instruction, language=self._language)

        return {"revised_content": revised}

    async def execute_append_chapter(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        chapter_id = params.get("chapter_id")
        instruction = params.get("instruction", "")

        chapter = self._db.query(Chapter).filter(Chapter.id == chapter_id).first()
        if not chapter:
            return {"error": f"章节 {chapter_id} 不存在"}

        llm = _resolve_sub_agent_llm(params.get("sub_agent_provider"))
        from app.services.chapter_llm import append_chapter_body
        appended = append_chapter_body(llm, self._novel, chapter, instruction, language=self._language)

        return {"appended_content": appended}

    async def execute_naming(self, task: AgentTask) -> dict[str, Any]:
        params = task.params
        category = params.get("category", "character")
        description = params.get("description", "")
        hint = params.get("hint", "")

        llm = _resolve_sub_agent_llm(params.get("sub_agent_provider"))
        from app.schemas.ai import NovelNamingIn
        from app.services.novel_ai import novel_naming_suggest
        body = NovelNamingIn(
            category=category,
            description=description or "未提供描述",
            hint=hint,
        )
        result = novel_naming_suggest(llm, self._novel, body, language=self._language)

        return {"names": result}


def register_sub_agent_handlers(
    queue: AgentTaskQueue,
    db: Session,
    novel: Novel,
    language: Language = "zh",
) -> SubAgentExecutor:
    executor = SubAgentExecutor(db, novel, language)

    queue.register_handler("generate_chapter", executor.execute_generate_chapter)
    queue.register_handler("generate_summary", executor.execute_generate_summary)
    queue.register_handler("generate_batch_plan", executor.execute_generate_batch_plan)
    queue.register_handler("revise_chapter", executor.execute_revise_chapter)
    queue.register_handler("append_chapter", executor.execute_append_chapter)
    queue.register_handler("naming", executor.execute_naming)

    return executor
