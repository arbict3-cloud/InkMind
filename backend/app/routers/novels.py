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
    reference = _clip_workflow_text(body.reference_text, 5000) or "无"
    world = _clip_workflow_text(body.world, 7000) or "未采纳"
    story = _clip_workflow_text(body.story, 7000) or "未采纳"
    characters = _clip_workflow_text(body.characters, 7000) or "未采纳"
    book_outline = _clip_workflow_text(body.book_outline, 8000) or "未采纳"
    volume_outline = _clip_workflow_text(body.volume_outline, 8000) or "未采纳"
    chapter_outline = _clip_workflow_text(body.chapter_outline, 8000) or "未采纳"
    planner_notes = _clip_workflow_text(body.planner_notes, 5000) or "无"
    chapter_brief = "\n".join(
        f"{idx + 1}. {chapter.title or '未命名章节'}：{_clip_workflow_text(chapter.summary or chapter.content, 320)}"
        for idx, chapter in enumerate(chapters[-20:])
    ) or "暂无章节"

    system = (
        "你是资深中文长篇小说策划编辑和网文作者。"
        "只输出可直接保存到创作工具里的正文内容，不要输出思考过程、解释、寒暄或 Markdown 代码块。"
        "内容必须原创；参考作品只能用于拆解结构和创作方法，不能照搬人物、专有名词、剧情细节。"
    )

    if body.stage == "world":
        user_msg = f"""请生成或重构一份原创小说世界观。

【作品】
标题：{title}
类型：{genre}
文风：{style}
背景备注：{background}

【用户参考或要求】
{reference}

【输出要求】
1. 如果用户提供参考作品拆解，请先抽象其结构方法，再生成新的原创世界观。
2. 如果用户只提供类型方向，例如修仙、科幻、都市异能，请直接构造完整世界观。
3. 输出必须包含：世界核心概念、地理/势力格局、历史源流、力量体系、社会秩序、资源与限制、主要矛盾、主题表达、可持续展开的故事接口。
4. 名称、规则、冲突必须原创，避免简单替换参考作品名词。
5. 结构清晰，内容详细，适合后续生成故事创意、人物和大纲。"""
    elif body.stage == "story":
        user_msg = f"""请基于已采纳世界观，设计多个有趣的长篇小说核心故事方案，并推荐最适合展开的一条。

【已采纳世界观】
{world}

【用户补充要求】
{reference}

【输出要求】
1. 先给出 3-5 个故事创意方向，每个包含主角处境、核心冲突、爽点/悬念、反转潜力。
2. 再选择一个最适合长篇连载的方案，展开为详细故事种子。
3. 明确主线问题、阶段性目标、敌我关系、核心秘密、情绪卖点和结局张力。
4. 不要写成完整大纲，这一步重点是“这个世界里最有意思的故事是什么”。"""
    elif body.stage == "character":
        user_msg = f"""请根据已采纳世界观和故事创意，生成人物卡。

【已采纳世界观】
{world}

【已采纳故事创意】
{story}

【用户补充要求】
{reference}

【输出要求】
1. 至少包含主角、关键同伴、主要对手、灰色立场人物、推动世界秘密的人物。
2. 每张人物卡包含：姓名/称号、身份、外在目标、真实欲望、性格关键词、能力或资源、致命缺陷、与主线关系、人物成长线、可制造冲突的关系网。
3. 人物性格必须服务剧情，不要只写标签。
4. 可以额外给出“人物之间最有戏的矛盾组合”。"""
    elif body.stage == "book":
        user_msg = f"""请基于已采纳世界观、故事创意和人物卡，生成详细全书大纲。

【已采纳世界观】
{world}

【已采纳故事创意】
{story}

【已采纳人物卡】
{characters}

【用户补充要求】
{reference}

【输出要求】
1. 输出长篇小说全书大纲，详细一些。
2. 包含开局钩子、主线推进、人物成长、关键反转、世界秘密揭露节奏、阶段高潮、最终结局方向。
3. 标出主要伏笔、回收点和中后期升级方向。
4. 不要进入逐章细纲，重点是全书结构。"""
    elif body.stage == "volume":
        user_msg = f"""请基于全书大纲生成详细卷大纲。

【已采纳世界观】
{world}

【已采纳人物卡】
{characters}

【已采纳全书大纲】
{book_outline}

【用户补充要求】
{reference}

【输出要求】
1. 每卷独立成段，标题建议使用“第一卷：卷名”。
2. 每卷包含：阶段定位、卷目标、主要冲突、人物变化、关键事件、高潮、结尾钩子、需要埋下或回收的伏笔。
3. 卷与卷之间必须有递进，不要重复同一种危机。"""
    elif body.stage == "chapter":
        user_msg = f"""请基于卷大纲拆出章节大纲。

【已采纳世界观】
{world}

【已采纳人物卡】
{characters}

【已采纳卷大纲】
{volume_outline}

【已存在章节】
{chapter_brief}

【用户补充要求】
{reference}

【输出格式】
每章之间用空行分隔。每章第一行写章节标题，后面写详细章节概要。
每章概要需要包含：本章目标、冲突、场景推进、信息释放、人物变化、结尾钩子。
不要写正文。"""
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
            f"{chapter.title or '未命名章节'}：{_clip_workflow_text(chapter.summary or chapter.content, 520)}"
            for chapter in previous
        ) or "暂无前文"
        if body.stage == "body":
            user_msg = f"""请生成目标章节正文。

【作品】
标题：{title}
类型：{genre}
文风：{style}
背景：{background}

【已采纳世界观】
{world}

【已采纳人物卡】
{characters}

【全书/卷/章纲】
全书大纲：{book_outline}
卷大纲：{volume_outline}
章节大纲：{chapter_outline}

【策划建议】
{planner_notes}

【前文摘要】
{previous_brief}

【目标章节】
标题：{target_title}
概要：{target_summary or '未填写'}

【写作要求】
1. 直接写正文，不要输出章节标题。
2. 目标字数约 {body.target_words} 字，可以略有浮动。
3. 不要复述设定，不要重复已发生情节，从目标章节的新场景直接推进。
4. 人物行为必须符合人物卡和前文逻辑。
5. 保持中文网文可读性，有场景、有动作、有情绪、有结尾钩子。"""
        else:
            user_msg = f"""请作为小说策划编辑，阅读当前全部已采纳内容和章节状态，提出可执行的优化建议。

【世界观】
{world}

【故事创意】
{story}

【人物卡】
{characters}

【全书大纲】
{book_outline}

【卷大纲】
{volume_outline}

【章节大纲】
{chapter_outline}

【已有章节】
{chapter_brief}

【用户重点关注】
{reference}

【输出要求】
1. 指出当前最值得加强的 5-10 个点。
2. 分析情节哪里可以更有趣，人物哪里能更合理，冲突哪里可以升级。
3. 给出可直接采纳的修改方案，而不是泛泛建议。
4. 如果发现逻辑矛盾、动机薄弱、节奏问题，直接指出。"""

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

    chapters = (
        db.query(Chapter)
        .filter(Chapter.novel_id == novel_id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    system, user_msg = _workflow_stage_messages(novel, chapters, body)
    action = {
        "world": "AI世界观",
        "story": "AI故事创意",
        "character": "AI人物卡",
        "book": "AI全书大纲",
        "volume": "AI分卷大纲",
        "chapter": "AI章节大纲",
        "body": "AI章节正文",
        "planner": "AI策划分析",
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
