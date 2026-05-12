from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_serializer


def _mask_api_key(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 8:
        return "***"
    return key[:4] + "***" + key[-4:]


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str | None
    preferred_llm_provider: str | None = None
    preferred_llm_model: str | None = None
    llm_call_count: int = 0

    agent_mode: str = "flexible"
    max_llm_iterations: int = 10
    max_tokens_per_task: int = 50000
    enable_auto_audit: bool = True
    preview_before_save: bool = True
    auto_audit_min_score: int = 60
    ai_language: str | None = None

    agent_use_custom: bool = False
    agent_custom_llm_id: int | None = None
    agent_model: str | None = None

    generation_use_custom: bool = False
    generation_custom_llm_id: int | None = None

    is_admin: bool = False

    token_quota: int | None = None
    token_quota_used: int = 0
    token_quota_reset_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    preferred_llm_provider: str | None = None
    preferred_llm_model: str | None = None

    agent_mode: str | None = None
    max_llm_iterations: int | None = None
    max_tokens_per_task: int | None = None
    enable_auto_audit: bool | None = None
    preview_before_save: bool | None = None
    auto_audit_min_score: int | None = None
    ai_language: str | None = None

    agent_use_custom: bool | None = None
    agent_custom_llm_id: int | None = None
    agent_model: str | None = None

    generation_use_custom: bool | None = None
    generation_custom_llm_id: int | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
