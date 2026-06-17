from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer


def _utc_dt(v: datetime) -> datetime:
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


class VolumeCreate(BaseModel):
    title: str = Field(default="", max_length=512)
    summary: str = ""
    sort_order: int = 0


class VolumeUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=512)
    summary: str | None = None
    sort_order: int | None = None


class VolumeOut(BaseModel):
    id: int
    novel_id: int
    title: str
    summary: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, v: datetime) -> str:
        return _utc_dt(v).isoformat()
