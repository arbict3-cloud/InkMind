from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import LLMUsageEvent
from app.schemas.usage import LLMUsageItemOut, LLMUsageListOut

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/llm", response_model=LLMUsageListOut)
def llm_usage(
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=100, ge=1, le=500),
) -> LLMUsageListOut:
    base_q = db.query(LLMUsageEvent).filter(LLMUsageEvent.user_id == user.id)
    total_count = db.query(func.count(LLMUsageEvent.id)).filter(LLMUsageEvent.user_id == user.id).scalar() or 0

    if total_count > 50:
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        rows = (
            base_q.filter(LLMUsageEvent.created_at >= cutoff)
            .order_by(LLMUsageEvent.created_at.desc(), LLMUsageEvent.id.desc())
            .limit(limit)
            .all()
        )
    else:
        rows = base_q.order_by(LLMUsageEvent.created_at.desc(), LLMUsageEvent.id.desc()).limit(limit).all()

    total_calls, total_in, total_out, total_all = (
        db.query(
            func.count(LLMUsageEvent.id),
            func.coalesce(func.sum(LLMUsageEvent.input_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.output_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
        )
        .filter(LLMUsageEvent.user_id == user.id)
        .one()
    )

    builtin_calls, builtin_in, builtin_out, builtin_total = (
        db.query(
            func.count(LLMUsageEvent.id),
            func.coalesce(func.sum(LLMUsageEvent.input_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.output_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
        )
        .filter(LLMUsageEvent.user_id == user.id, LLMUsageEvent.source == "builtin")
        .one()
    )

    custom_calls, custom_in, custom_out, custom_total = (
        db.query(
            func.count(LLMUsageEvent.id),
            func.coalesce(func.sum(LLMUsageEvent.input_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.output_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
        )
        .filter(LLMUsageEvent.user_id == user.id, LLMUsageEvent.source == "custom")
        .one()
    )

    return LLMUsageListOut(
        total_calls=int(total_calls or 0),
        total_input_tokens=int(total_in or 0),
        total_output_tokens=int(total_out or 0),
        total_tokens=int(total_all or 0),
        builtin_calls=int(builtin_calls or 0),
        builtin_input_tokens=int(builtin_in or 0),
        builtin_output_tokens=int(builtin_out or 0),
        builtin_total_tokens=int(builtin_total or 0),
        custom_calls=int(custom_calls or 0),
        custom_input_tokens=int(custom_in or 0),
        custom_output_tokens=int(custom_out or 0),
        custom_total_tokens=int(custom_total or 0),
        items=[LLMUsageItemOut.model_validate(x) for x in rows],
    )
