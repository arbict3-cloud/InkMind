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

import json
import logging
import re
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
_session_id: str = ""
_DEFAULT_TARGET_WORD_COUNT = 1800
_CONTEXT_PACK_CACHE: dict[str, dict[str, Any]] = {}


def init_tool_context(db_session_factory: Any, novel_id: int, session_id: str = "") -> None:
    global _db_session_factory, _novel_id, _session_id
    _db_session_factory = db_session_factory
    _novel_id = novel_id
    _session_id = session_id


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


def _clip_text(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _infer_memo_bucket(title: str, body: str) -> str:
    text = f"{title}\n{body}"
    if re.search(r"(禁写|不要|避免|禁忌|雷点|避雷|不允许|不能写)", text):
        return "forbidden"
    if re.search(r"(伏笔|线索|悬念|坑|铺垫|回收)", text):
        return "foreshadowing"
    return "general"


def _extract_target_word_count(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return _DEFAULT_TARGET_WORD_COUNT
    if 800 <= parsed <= 5000:
        return parsed
    return _DEFAULT_TARGET_WORD_COUNT


def _context_pack_cache_key() -> str:
    return f"{_session_id or 'default'}:{_novel_id}"


def _invalidate_context_pack_cache() -> None:
    _CONTEXT_PACK_CACHE.pop(_context_pack_cache_key(), None)


def _build_writing_context_pack(
    db: Session,
    novel: Novel,
    *,
    target_word_count: Any = None,
    chapter_summary_hint: Any = None,
) -> dict[str, Any]:
    target = _extract_target_word_count(target_word_count)
    hint = _clip_text(chapter_summary_hint, 800)

    chapters_query = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel.id)
        .order_by(Chapter.sort_order, Chapter.id)
    )
    chapter_count = chapters_query.count()
    recent_chapters = chapters_query.offset(max(0, chapter_count - 5)).limit(5).all()
    recent = [
        {
            "chapter_number": max(1, chapter_count - len(recent_chapters) + idx + 1),
            "id": ch.id,
            "title": ch.title,
            "summary": _clip_text(ch.summary, 360),
            "word_count": len(ch.content) if ch.content else 0,
        }
        for idx, ch in enumerate(recent_chapters)
    ]

    characters = (
        db.query(Character)
        .filter(Character.novel_id == novel.id)
        .order_by(Character.id.desc())
        .limit(10)
        .all()
    )
    active_characters = [
        {
            "id": ch.id,
            "name": ch.name,
            "profile": _clip_text(ch.profile, 320),
            "notes": _clip_text(ch.notes, 180),
        }
        for ch in characters
    ]

    memos = db.query(NovelMemo).filter(NovelMemo.novel_id == novel.id).all()
    foreshadowing: list[dict[str, str]] = []
    forbidden: list[dict[str, str]] = []
    constraints: list[dict[str, str]] = []
    for memo in memos:
        item = {"title": memo.title, "body": _clip_text(memo.body, 360)}
        bucket = _infer_memo_bucket(memo.title, memo.body or "")
        if bucket == "forbidden":
            forbidden.append(item)
        elif bucket == "foreshadowing":
            foreshadowing.append(item)
        else:
            constraints.append(item)

    return {
        "pack_version": 1,
        "novel": {
            "id": novel.id,
            "title": novel.title,
            "genre": novel.genre,
            "background": _clip_text(novel.background, 900),
            "writing_style": _clip_text(novel.writing_style, 520),
            "chapter_count": chapter_count,
            "next_chapter_number": chapter_count + 1,
            "next_sort_order": (db.scalar(select(func.max(Chapter.sort_order)).where(Chapter.novel_id == novel.id)) or 0) + 1,
        },
        "recent_chapter_summaries": recent,
        "active_characters": active_characters,
        "foreshadowing": foreshadowing[:8],
        "forbidden_content": forbidden[:8],
        "style_constraints": {
            "target_word_count": target,
            "minimum_word_count": max(800, int(target * 0.85)),
            "voice": _clip_text(novel.writing_style, 520),
            "chapter_summary_hint": hint,
            "notes": [_clip_text(item["body"], 180) for item in constraints[:6] if item["body"]],
        },
    }


def _get_cached_writing_context_pack(
    db: Session,
    novel: Novel,
    *,
    target_word_count: Any = None,
    chapter_summary_hint: Any = None,
) -> dict[str, Any]:
    key = _context_pack_cache_key()
    requested_target = _extract_target_word_count(target_word_count)
    cached = _CONTEXT_PACK_CACHE.get(key)
    if cached:
        cached_target = cached.get("style_constraints", {}).get("target_word_count")
        if cached_target == requested_target:
            return cached

    pack = _build_writing_context_pack(
        db,
        novel,
        target_word_count=requested_target,
        chapter_summary_hint=chapter_summary_hint,
    )
    _CONTEXT_PACK_CACHE[key] = pack
    return pack


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
    "get_writing_context_pack",
    "一次性获取写作上下文包：作品状态、最近章节摘要、活跃人物、伏笔、禁写内容、目标字数和风格约束。写作任务应优先调用它，避免重复读取章节/人物/备忘录。",
    {"target_word_count": int, "chapter_summary_hint": str},
)
async def get_writing_context_pack(args: dict[str, Any]) -> dict[str, Any]:
    db = _get_db()
    novel = db.query(Novel).filter(Novel.id == _novel_id).first()
    if novel is None:
        db.close()
        raise ValueError(f"小说 {_novel_id} 不存在")
    result = _get_cached_writing_context_pack(
        db,
        novel,
        target_word_count=args.get("target_word_count"),
        chapter_summary_hint=args.get("chapter_summary_hint"),
    )
    db.close()
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


@tool(
    "quality_check_chapter",
    "保存前对本章进行轻量质量检查：字数、标题、摘要、禁写内容和上下文一致性。必须在 save_chapter 前调用。",
    {"title": str, "content": str, "summary": str, "target_word_count": int, "context_pack": dict},
)
async def quality_check_chapter(args: dict[str, Any]) -> dict[str, Any]:
    title = (args.get("title") or "").strip()
    content = (args.get("content") or "").strip()
    summary = (args.get("summary") or "").strip()
    target_word_count = _extract_target_word_count(args.get("target_word_count"))
    context_pack = args.get("context_pack") if isinstance(args.get("context_pack"), dict) else {}
    minimum_word_count = int(
        context_pack.get("style_constraints", {}).get("minimum_word_count")
        or max(800, target_word_count * 0.85)
    )

    issues: list[dict[str, str]] = []
    if not title:
        issues.append({"level": "error", "message": "缺少章节标题"})
    if not content:
        issues.append({"level": "error", "message": "缺少章节正文"})
    if len(content) < minimum_word_count:
        issues.append({
            "level": "warning",
            "message": f"正文偏短：当前约 {len(content)} 字，建议至少 {minimum_word_count} 字",
        })
    if not summary:
        issues.append({"level": "warning", "message": "缺少章节摘要"})

    forbidden_items = context_pack.get("forbidden_content", []) if isinstance(context_pack, dict) else []
    for item in forbidden_items[:6]:
        body = str(item.get("body", "") if isinstance(item, dict) else "")
        title_text = str(item.get("title", "") if isinstance(item, dict) else "")
        for keyword in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{3,}", f"{title_text} {body}")[:4]:
            if keyword and keyword in content:
                issues.append({"level": "warning", "message": f"可能触及禁写内容：{keyword}"})
                break

    result = {
        "passed": not any(issue["level"] == "error" for issue in issues),
        "word_count": len(content),
        "target_word_count": target_word_count,
        "minimum_word_count": minimum_word_count,
        "issues": issues,
    }
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}


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

    if task_type == "generate_chapter" and "context_pack" not in params:
        db = _get_db()
        try:
            novel = db.query(Novel).filter(Novel.id == _novel_id).first()
            if novel is not None:
                params["context_pack"] = _get_cached_writing_context_pack(
                    db,
                    novel,
                    target_word_count=params.get("word_count"),
                    chapter_summary_hint=params.get("chapter_summary"),
                )
                params.setdefault(
                    "word_count",
                    params["context_pack"]["style_constraints"]["target_word_count"],
                )
        finally:
            db.close()

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
        "chapter_number": sort_order,
        "title": chapter.title,
        "word_count": len(content),
    }
    _invalidate_context_pack_cache()
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
    _invalidate_context_pack_cache()

    return {"content": [{"type": "text", "text": json.dumps({"success": True, "chapter_id": chapter_id, "title": title}, ensure_ascii=False, indent=2)}]}


ALL_TOOLS = [
    get_novel_state,
    get_chapters,
    get_chapter_detail,
    get_characters,
    get_memos,
    get_writing_context_pack,
    dispatch_generation_task,
    poll_task_result,
    poll_multiple_tasks,
    quality_check_chapter,
    save_chapter,
    delete_chapter,
]

ALL_TOOL_NAMES = [f"InkMind::{t.name}" for t in ALL_TOOLS]
