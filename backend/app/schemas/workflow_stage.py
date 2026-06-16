from typing import Literal

from pydantic import BaseModel, Field


class NovelWorkflowStageGenerateIn(BaseModel):
    stage: Literal["global", "volume", "chapter", "body"] = Field(
        ...,
        description="global=故事总纲 volume=分卷大纲 chapter=章节大纲 body=正文",
    )
    provider: str | None = Field(default=None, description="指定模型提供商")
    model: str | None = Field(default=None, description="指定模型名称")
    global_outline: str = Field(default="", description="已有故事总纲")
    volume_outline: str = Field(default="", description="已有分卷大纲")
    chapter_outline: str = Field(default="", description="已有章节大纲")
    target_chapter_id: int | None = Field(default=None, description="正文生成目标章节")


class NovelWorkflowStageGenerateOut(BaseModel):
    text: str
