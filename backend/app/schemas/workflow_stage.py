from typing import Literal

from pydantic import BaseModel, Field


WorkflowStage = Literal[
    "world",
    "story",
    "character",
    "book",
    "volume",
    "chapter",
    "body",
    "planner",
]


class NovelWorkflowStageGenerateIn(BaseModel):
    stage: WorkflowStage = Field(..., description="当前创作阶段")
    provider: str | None = Field(default=None, description="指定模型提供商")
    model: str | None = Field(default=None, description="指定模型名称")
    reference_text: str = Field(default="", description="用户输入的参考、拆解文本或补充要求")
    world: str = Field(default="", description="已采纳世界观")
    story: str = Field(default="", description="已采纳故事创意")
    characters: str = Field(default="", description="已采纳人物卡")
    book_outline: str = Field(default="", description="已采纳全书大纲")
    volume_outline: str = Field(default="", description="已采纳卷大纲")
    chapter_outline: str = Field(default="", description="已采纳章节大纲")
    planner_notes: str = Field(default="", description="已采纳策划建议")
    target_chapter_id: int | None = Field(default=None, description="正文生成目标章节")
    target_words: int = Field(default=3000, ge=500, le=20000, description="正文目标字数")


class NovelWorkflowStageGenerateOut(BaseModel):
    text: str
