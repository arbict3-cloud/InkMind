"""Claude Agent SDK 工具定义。

使用 @tool 装饰器定义 Claude 可调用的 MCP 工具。
这些工具通过 create_sdk_mcp_server() 注册为进程内 MCP 服务器，
Claude 通过 ClaudeSDKClient 调用它们。

工具分类：
- 读取工具：从 DB 读取小说状态、章节、人物、备忘录
- 调度工具：将生成任务提交到 TaskQueue
- 轮询工具：查询任务执行结果
- 写入工具：保存章节到 DB
- 交互工具：向用户提问
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from claude_agent_sdk import tool

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agent.task_queue import AgentTaskStatus, get_task_queue
from app.models import Chapter, Character, Novel, NovelMemo

log = logging.getLogger(__name__)

_db_session_factory: Any = None
_novel_id: int = 0

_pending_ask_user_events: dict[str, asyncio.Event] = {}
_pending_ask_user_answers: dict[str, str] = {}


def init_tool_context(db_session_factory: Any, novel_id: int) -> None:
    global _db_session_factory, _novel_id
    _db_session_factory = db_session_factory
    _novel_id = novel_id


def _get_db() -> Session:
    if _db_session_factory is None:
        raise RuntimeError("工具上下文未初始化：请先调用 init_tool_context()")
    return _db_session_factory()


def _get_novel() -> Novel:
    db = _get_db()
    novel = db.query(Novel).filter(Novel.id == _novel_id).first()
    if novel is None:
        raise ValueError(f"小说 {_novel_id} 不存在")
    return novel


@tool("get_novel_state", "获取小说的当前状态：基本信息、章节数量、最近章节概要、人物数量等。用于了解项目进度。", {})
async def get_novel_state(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    novel = _get_novel()
    chapter_count = db.query(Chapter).filter(Chapter.novel_id == novel.id).count()
    character_count = db.query(Character).filter(Character.novel_id == novel.id).count()
    memo_count = db.query(NovelMemo).filter(NovelMemo.novel_id == novel.id).count()

    recent_chapters = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel.id)
        .order_by(Chapter.sort_order.desc())
        .limit(3)
        .all()
    )
    recent = [
        {
            "chapter_number": idx,
            "id": ch.id,
            "title": ch.title,
            "summary": (ch.summary or "")[:200],
            "word_count": len(ch.content) if ch.content else 0,
        }
        for idx, ch in enumerate(reversed(recent_chapters), start=max(1, chapter_count - 2))
    ]

    result = {
        "title": novel.title,
        "genre": novel.genre,
        "background": (novel.background or "")[:500],
        "writing_style": (novel.writing_style or "")[:300],
        "chapter_count": chapter_count,
        "character_count": character_count,
        "memo_count": memo_count,
        "recent_chapters": recent,
    }
    db.close()
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "get_chapters",
    "获取小说的章节列表。可指定获取范围和是否包含正文。",
    {"limit": int, "offset": int, "include_content": bool},
)
async def get_chapters(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    novel = _get_novel()
    limit = min(args.get("limit", 10), 50)
    offset = args.get("offset", 0)
    include_content = args.get("include_content", False)

    query = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel.id)
        .order_by(Chapter.sort_order, Chapter.id)
    )
    total = query.count()
    chapters = query.offset(offset).limit(limit).all()

    items = []
    for idx, ch in enumerate(chapters, start=offset + 1):
        item: dict[str, Any] = {
            "chapter_number": idx,
            "id": ch.id,
            "title": ch.title,
            "summary": (ch.summary or "")[:300],
            "word_count": len(ch.content) if ch.content else 0,
            "sort_order": ch.sort_order,
        }
        if include_content:
            item["content"] = ch.content
        items.append(item)

    result = {"total": total, "chapters": items}
    db.close()
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "get_chapter_detail",
    "获取指定章节的完整内容，包括标题、概要和正文。",
    {"chapter_id": int},
)
async def get_chapter_detail(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    chapter_id = args["chapter_id"]
    chapter = db.query(Chapter).filter(
        Chapter.id == chapter_id,
        Chapter.novel_id == _novel_id,
    ).first()
    if not chapter:
        db.close()
        return {"content": [{"type": "text", "text": json.dumps({"error": f"章节 {chapter_id} 不存在"}, ensure_ascii=False)}]}

    chapter_number = (
        db.query(Chapter)
        .filter(Chapter.novel_id == _novel_id, Chapter.sort_order <= chapter.sort_order)
        .count()
    )

    result = {
        "chapter_number": chapter_number,
        "id": chapter.id,
        "title": chapter.title,
        "summary": chapter.summary,
        "content": chapter.content,
        "word_count": len(chapter.content) if chapter.content else 0,
        "sort_order": chapter.sort_order,
    }
    db.close()
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "get_characters",
    "获取小说的人物设定列表。可按名称过滤。",
    {"name_filter": str},
)
async def get_characters(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    name_filter = args.get("name_filter")
    query = db.query(Character).filter(Character.novel_id == _novel_id)
    if name_filter:
        query = query.filter(Character.name.contains(name_filter))
    characters = query.all()

    items = [
        {
            "id": ch.id,
            "name": ch.name,
            "profile": (ch.profile or "")[:500],
            "notes": (ch.notes or "")[:200],
        }
        for ch in characters
    ]
    db.close()
    return {"content": [{"type": "text", "text": json.dumps({"characters": items}, ensure_ascii=False, indent=2)}]}


@tool("get_memos", "获取小说的备忘录列表。", {})
async def get_memos(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    memos = db.query(NovelMemo).filter(NovelMemo.novel_id == _novel_id).all()
    items = [
        {"id": m.id, "title": m.title, "body": (m.body or "")[:500]}
        for m in memos
    ]
    db.close()
    return {"content": [{"type": "text", "text": json.dumps({"memos": items}, ensure_ascii=False, indent=2)}]}


@tool(
    "dispatch_generation_task",
    "调度内容生成任务到子智能体。任务异步执行，立即返回任务 ID，需要用 poll_task_result 轮询结果。",
    {"task_type": str, "params": dict},
)
async def dispatch_generation_task(args: dict[str, Any]) -> dict[str, Any]:
    task_type = args["task_type"]
    params = args.get("params", {})

    from app.config import settings
    if "sub_agent_provider" not in params:
        params["sub_agent_provider"] = settings.default_llm_provider

    queue = get_task_queue()
    task_id = await queue.submit(task_type=task_type, params=params)

    result = {
        "task_id": task_id,
        "task_type": task_type,
        "status": "submitted",
        "message": f"任务已提交到队列，ID: {task_id}。请使用 poll_task_result 轮询结果。",
    }
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "poll_task_result",
    "轮询任务执行结果。如果任务还在执行中，返回当前进度；如果完成，返回结果。",
    {"task_id": str},
)
async def poll_task_result(args: dict[str, Any]) -> dict[str, Any]:
    task_id = args["task_id"]
    queue = get_task_queue()
    task = await queue.poll(task_id)
    if task is None:
        return {"content": [{"type": "text", "text": json.dumps({"error": f"任务 {task_id} 不存在"}, ensure_ascii=False)}]}

    result: dict[str, Any] = {
        "task_id": task.task_id,
        "task_type": task.task_type,
        "status": task.status.value,
        "progress": task.progress,
    }
    if task.progress_message:
        result["progress_message"] = task.progress_message
    if task.status == AgentTaskStatus.COMPLETED and task.result:
        result["result"] = task.result
    if task.status == AgentTaskStatus.FAILED and task.error:
        result["error"] = task.error
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "poll_multiple_tasks",
    "批量轮询多个任务的执行结果。",
    {"task_ids": list},
)
async def poll_multiple_tasks(args: dict[str, Any]) -> dict[str, Any]:
    task_ids = args["task_ids"]
    queue = get_task_queue()
    results = await queue.poll_batch(task_ids)
    items = []
    for tid, task in results.items():
        if task is None:
            items.append({"task_id": tid, "status": "not_found"})
            continue
        item: dict[str, Any] = {
            "task_id": task.task_id,
            "task_type": task.task_type,
            "status": task.status.value,
            "progress": task.progress,
        }
        if task.status == AgentTaskStatus.COMPLETED and task.result:
            item["result"] = task.result
        if task.status == AgentTaskStatus.FAILED and task.error:
            item["error"] = task.error
        items.append(item)
    return {"content": [{"type": "text", "text": json.dumps({"tasks": items}, ensure_ascii=False, indent=2)}]}


@tool(
    "save_chapter",
    "将生成的内容保存为正式章节到数据库。",
    {"title": str, "content": str, "summary": str, "sort_order": int},
)
async def save_chapter(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    title = args["title"]
    content = args["content"]
    summary = args.get("summary", "")
    sort_order = args.get("sort_order")

    if sort_order is None:
        max_order = db.scalar(
            select(func.max(Chapter.sort_order)).where(Chapter.novel_id == _novel_id)
        )
        sort_order = (max_order or 0) + 1

    chapter = Chapter(
        novel_id=_novel_id,
        title=title,
        content=content,
        summary=summary,
        sort_order=sort_order,
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)

    result = {
        "success": True,
        "chapter_id": chapter.id,
        "title": chapter.title,
        "word_count": len(content),
    }
    db.close()
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "delete_chapter",
    "删除指定章节。需要提供章节 ID，删除前应先确认用户意图。",
    {"chapter_id": int},
)
async def delete_chapter(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    chapter_id = args["chapter_id"]

    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        db.close()
        return {"content": [{"type": "text", "text": json.dumps({"success": False, "error": f"章节 {chapter_id} 不存在"}, ensure_ascii=False)}]}

    if chapter.novel_id != _novel_id:
        db.close()
        return {"content": [{"type": "text", "text": json.dumps({"success": False, "error": "章节不属于当前作品"}, ensure_ascii=False)}]}

    title = chapter.title
    db.delete(chapter)
    db.commit()
    db.close()

    return {"content": [{"type": "text", "text": json.dumps({"success": True, "chapter_id": chapter_id, "title": title}, ensure_ascii=False, indent=2)}]}


@tool(
    "ask_user",
    "向用户提问以获取确认、选择或补充信息。当需要用户决策时使用。",
    {"question": str, "options": list, "header": str, "allow_custom": bool},
)
async def ask_user(args: dict[str, Any]) -> dict[str, Any]:
    question = args["question"]
    options = args.get("options", [])
    header = args.get("header")
    allow_custom = args.get("allow_custom", True)

    question_id = str(uuid.uuid4())
    event = asyncio.Event()
    _pending_ask_user_events[question_id] = event

    await event.wait()

    answer = _pending_ask_user_answers.pop(question_id, "")
    _pending_ask_user_events.pop(question_id, None)

    return {"content": [{"type": "text", "text": f"用户回答: {answer}"}]}


def resolve_ask_user_answer(question_id: str, answer: str) -> bool:
    if question_id not in _pending_ask_user_events:
        return False
    _pending_ask_user_answers[question_id] = answer
    _pending_ask_user_events[question_id].set()
    return True


ALL_TOOLS = [
    get_novel_state,
    get_chapters,
    get_chapter_detail,
    get_characters,
    get_memos,
    dispatch_generation_task,
    poll_task_result,
    poll_multiple_tasks,
    save_chapter,
    ask_user,
]

ALL_TOOL_NAMES = [f"InkMind::{t.name}" for t in ALL_TOOLS]
