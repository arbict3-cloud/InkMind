from datetime import datetime, timezone

from pydantic import BaseModel, field_serializer


def _utc_dt(v: datetime) -> datetime:
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


class LLMUsageItemOut(BaseModel):
    id: int
    provider: str
    source: str = "builtin"
    action: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()


class LLMUsageListOut(BaseModel):
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    builtin_calls: int = 0
    builtin_input_tokens: int = 0
    builtin_output_tokens: int = 0
    builtin_total_tokens: int = 0
    custom_calls: int = 0
    custom_input_tokens: int = 0
    custom_output_tokens: int = 0
    custom_total_tokens: int = 0
    items: list[LLMUsageItemOut]
