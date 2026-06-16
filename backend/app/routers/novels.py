import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.language import Language
from app.llm.llm_errors import LLMRequestError
from app.llm.ndjson_stream import filter_think_chunks, ndjson_line
from app.llm.providers import list_available_providers, resolve_llm_for_user
from app.models import Chapter, Character, Novel
from app.schemas.ai import (
    NovelAiChatIn,
    NovelChapterSummaryInspireIn,
    NovelNamingIn,
)
from app.schemas.export import NovelExportPdfIn
from app.schemas.novel import NovelCreate, NovelOut, NovelUpdate
from app.schemas.workflow_stage import NovelWorkflowStageGenerateIn
from app.services.novel_export_pdf import build_novel_pdf_bytes, safe_export_pdf_stem
from app.observability.otel_ai import ai_span
from app.services.novel_ai import (
    novel_chapter_summary_inspire_messages,
    novel_naming_messages,
    novel_writing_chat_messages,
)

router = APIRouter(prefix="/novels", tags=["novels"])

log = logging.getLogger(__name__)

_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _clip_workflow_text(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def _workflow_stage_messages(
    novel: Novel,
    chapters: list[Chapter],
    body: NovelWorkflowStageGenerateIn,
) -> tuple[str, str]:
    title = novel.title or "未命名作品"
    genre = novel.genre or "未填写"
    style = novel.writing_style or "未填写"
    background = _clip_workflow_text(novel.background, 2400) or "未填写"
    global_outline = _clip_workflow_text(body.global_outline, 6000) or "未填写"
    volume_outline = _clip_workflow_text(body.volume_outline, 6000) or "未填写"
    chapter_outline = _clip_workflow_text(body.chapter_outline, 6000) or "未填写"
    chapter_brief = "\n".join(
        f"{idx + 1}. {chapter.title or '未命名章节'}：{_clip_workflow_text(chapter.summary, 260)}"
        for idx, chapter in enumerate(chapters[-20:])
    ) or "暂无章节"

    if body.stage == "global":
        system = (
            "你是资深中文长篇小说策划编辑。只输出可直接保存的大纲正文，"
            "不要输出思考过程、解释或 Markdown 代码块。"
        )
        user_msg = f"""请为这部小说生成一份可执行的故事总纲。

【作品】
标题：{title}
类型：{genre}
文风：{style}
背景设定：{background}

【输出要求】
1. 包含核心卖点、主线冲突、主要人物、世界观、分卷方向、阶段性爽点和结局方向。
2. 适合长篇网文连续生成，注意伏笔、升级节奏和人物成长。
3. 用中文输出，结构清晰，可直接粘贴进项目的“故事总纲”框。"""
    elif body.stage == "volume":
        system = (
            "你是资深中文长篇小说分卷策划。只输出分卷大纲正文，"
            "不要输出思考过程、解释或 Markdown 代码块。"
        )
        user_msg = f"""请基于故事总纲拆分分卷大纲。

【作品】
标题：{title}
类型：{genre}
文风：{style}

【故事总纲】
{global_outline}

【输出要求】
1. 每卷包含：卷名、阶段目标、主要冲突、人物变化、关键爽点、结尾钩子。
2. 分卷之间要递进，避免重复同一类冲突。
3. 用中文输出，可直接保存为“分卷大纲”。"""
    elif body.stage == "chapter":
        system = (
            "你是资深中文长篇小说章节策划。只输出章节大纲，"
            "不要输出思考过程、解释或 Markdown 代码块。"
        )
        user_msg = f"""请基于分卷大纲拆成章节大纲。

【作品】
标题：{title}
类型：{genre}
文风：{style}

【故事总纲】
{global_outline}

【分卷大纲】
{volume_outline}

【已存在章节】
{chapter_brief}

【输出格式】
每章之间用一个空行分隔；每章第一行写章节标题，后面用 2-4 句写章节摘要。不要写正文。"""
    else:
        target = next((chapter for chapter in chapters if chapter.id == body.target_chapter_id), None)
        if target is None:
            target = next((chapter for chapter in chapters if not (chapter.content or "").strip()), None)
        if target is None and chapters:
            target = chapters[-1]
        target_title = target.title if target else "未选择章节"
        target_summary = target.summary if target else chapter_outline
        previous = [chapter for chapter in chapters if target is None or chapter.sort_order < target.sort_order][-5:]
        previous_brief = "\n".join(
            f"{chapter.title or '未命名章节'}：{_clip_workflow_text(chapter.summary or chapter.content, 360)}"
            for chapter in previous
        ) or "暂无前文"
        system = (
            "你是专业中文长篇小说作者。只输出章节正文，不要输出章节标题、解释、"
            "思考过程或 Markdown 代码块。"
        )
        user_msg = f"""请根据下面信息生成本章正文。

【作品】
标题：{title}
类型：{genre}
文风：{style}
背景设定：{background}

【故事总纲】
{global_outline}

【分卷大纲】
{volume_outline}

【前文摘要】
{previous_brief}

【目标章节】
标题：{target_title}
摘要：{target_summary or '未填写'}

【写作要求】
1. 直接写正文，不要复述设定。
2. 与前文自然衔接，人物行为符合设定。
3. 推进新剧情，避免重复已发生事件。
4. 中文输出，适合作为章节正文初稿。"""

    return system, user_msg


@router.get("", response_model=list[NovelOut])
def list_novels(user: CurrentUser, db: Annotated[Session, Depends(get_db)]) -> list[Novel]:
    return db.query(Novel).filter(Novel.user_id == user.id).order_by(Novel.updated_at.desc()).all()


@router.post("", response_model=NovelOut, status_code=status.HTTP_201_CREATED)
def create_novel(
    body: NovelCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Novel:
    n = Novel(
        user_id=user.id,
        title=body.title,
        background=body.background,
        genre=body.genre,
        writing_style=body.writing_style,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def _get_owned_novel(db: Session, user_id: int, novel_id: int) -> Novel:
    n = db.get(Novel, novel_id)
    if n is None or n.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作品不存在")
    return n


@router.post("/{novel_id}/ai-workflow-stage")
def novel_ai_workflow_stage(
    novel_id: int,
    body: NovelWorkflowStageGenerateIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    novel = _get_owned_novel(db, user.id, novel_id)
    provider_name = (body.provider or "").strip().lower() or None
    if provider_name and provider_name not in list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"未配置 {provider_name} 的 API Key",
        )
    if not provider_name and not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )

    chapters = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    system, user_msg = _workflow_stage_messages(novel, chapters, body)
    action = {
        "global": "AI故事总纲",
        "volume": "AI分卷大纲",
        "chapter": "AI章节大纲",
        "body": "AI章节正文",
    }[body.stage]

    def gen():
        try:
            llm = resolve_llm_for_user(
                user,
                provider_name,
                explicit_model=(body.model or "").strip() or None,
                db=db,
                action=action,
            )
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.workflow_stage.stream_complete", novel_id=novel_id, stage=body.stage):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"text": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/ai-chat")
def novel_ai_chat(
    novel_id: int,
    body: NovelAiChatIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    chapters = db.query(Chapter).filter(Chapter.novel_id == novel_id).order_by(Chapter.sort_order).all()
    characters = db.query(Character).filter(Character.novel_id == novel_id).order_by(Character.id).all()
    system, user_msg = novel_writing_chat_messages(novel, body.message, body.history, language=language, chapters=chapters, characters=characters, db=db)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI提问")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.ai_chat.stream_complete", novel_id=novel_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"reply": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/ai-naming")
def novel_ai_naming(
    novel_id: int,
    body: NovelNamingIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    system, user_msg = novel_naming_messages(novel, body, language=language)

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI起名")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.ai_naming.stream_complete", novel_id=novel_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"text": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/ai-chapter-summary-inspire")
def novel_ai_chapter_summary_inspire_ep(
    novel_id: int,
    body: NovelChapterSummaryInspireIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    language: Language,
):
    novel = _get_owned_novel(db, user.id, novel_id)
    if not list_available_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置任何 LLM API Key",
        )
    chapters = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    previous: list[Chapter]
    if body.chapter_id is not None:
        idx = next((i for i, c in enumerate(chapters) if c.id == body.chapter_id), None)
        if idx is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="章节不存在")
        current = chapters[idx]
        include_current = body.chapter_count > 1 and bool((current.content or "").strip())
        previous = chapters[: idx + 1] if include_current else chapters[:idx]
    else:
        previous = chapters
    system, user_msg = novel_chapter_summary_inspire_messages(
        novel,
        previous,
        chapter_count=body.chapter_count,
        language=language,
    )

    def gen():
        try:
            llm = resolve_llm_for_user(user, None, db=db, action="AI概要灵感")
        except ValueError as e:
            yield ndjson_line({"error": str(e)})
            return
        buf: list[str] = []
        try:
            with ai_span("novel.chapter_summary_inspire.stream_complete", novel_id=novel_id):
                for part in filter_think_chunks(llm.stream_complete(system, user_msg)):
                    buf.append(part)
                    yield ndjson_line({"t": part})
            yield ndjson_line({"summary": "".join(buf).strip()})
        except LLMRequestError as e:
            yield ndjson_line({"error": e.message})
        except Exception as e:
            yield ndjson_line({"error": str(e) or "请求失败"})

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=_STREAM_HEADERS)


@router.post("/{novel_id}/export/pdf")
def export_novel_pdf(
    novel_id: int,
    body: NovelExportPdfIn,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """服务端将正文写成 PDF：优先本机或 fpdf2 自带字体，否则用核心字体（中文可能显示为 ?）。"""
    novel = _get_owned_novel(db, user.id, novel_id)
    rows = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    want = body.chapter_ids
    if want:
        allow = {c.id for c in rows}
        missing = [i for i in want if i not in allow]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"无效的章节 id: {missing}",
            )
        id_set = set(want)
        chapters = [c for c in rows if c.id in id_set]
    else:
        chapters = list(rows)
    try:
        raw = build_novel_pdf_bytes(novel, chapters)
    except Exception as e:
        log.exception("novel pdf export failed novel_id=%s", novel_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF 生成失败：{e!s}",
        ) from e
    stem = safe_export_pdf_stem(novel.title)
    fname = f"{stem}.pdf"
    ascii_name = fname.encode("ascii", "replace").decode()
    cd = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(fname)}'
    return Response(content=raw, media_type="application/pdf", headers={"Content-Disposition": cd})


@router.get("/{novel_id}", response_model=NovelOut)
def get_novel(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Novel:
    return _get_owned_novel(db, user.id, novel_id)


@router.patch("/{novel_id}", response_model=NovelOut)
def update_novel(
    novel_id: int,
    body: NovelUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Novel:
    n = _get_owned_novel(db, user.id, novel_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(n, k, v)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@router.delete("/{novel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_novel(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    n = _get_owned_novel(db, user.id, novel_id)
    db.delete(n)
    db.commit()
