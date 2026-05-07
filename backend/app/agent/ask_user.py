"""AskUserQuestion 机制。

允许 Agent 在执行过程中向用户提出结构化问题，
获取确认、选择或补充信息后再继续执行。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from app.agent.base import BaseTool


@dataclass
class PendingQuestion:
    question_id: str
    question: str
    options: list[str] = field(default_factory=list)
    header: str | None = None
    allow_custom: bool = True
    answer: str | None = None
    selected_option: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "question_id": self.question_id,
            "question": self.question,
            "options": self.options,
            "header": self.header,
            "allow_custom": self.allow_custom,
        }

    def is_answered(self) -> bool:
        return self.answer is not None or self.selected_option is not None


class AskUserTool(BaseTool):
    """向用户提出问题的工具。

    支持选择题和自由文本输入。
    当 Agent 需要用户决策或补充信息时使用。
    """

    name = "ask_user"
    description = (
        "向用户提出问题以获取确认、选择或补充信息。"
        "支持选择题（2-4个选项）和自由文本输入。"
        "当需要用户决策或补充信息时使用此工具。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "要向用户提出的问题",
            },
            "options": {
                "type": "array",
                "description": "选项列表（2-4个），为空则允许自由文本输入",
                "items": {"type": "string"},
            },
            "allow_custom": {
                "type": "boolean",
                "description": "是否允许用户输入自定义答案（默认true）",
                "default": True,
            },
            "header": {
                "type": "string",
                "description": "问题的简短标签（最多12字）",
            },
        },
        "required": ["question"],
    }

    def __init__(self) -> None:
        self._pending: PendingQuestion | None = None

    def run(self, **kwargs) -> str:
        question = kwargs.get("question", "")
        options = kwargs.get("options", [])
        allow_custom = kwargs.get("allow_custom", True)
        header = kwargs.get("header")

        self._pending = PendingQuestion(
            question_id=str(uuid.uuid4()),
            question=question,
            options=options if isinstance(options, list) else [],
            header=header,
            allow_custom=allow_custom,
        )

        if options:
            opts_str = " / ".join(f"{i+1}. {o}" for i, o in enumerate(options))
            return f"已向用户提问：{question}（选项：{opts_str}）"
        return f"已向用户提问：{question}"

    def get_pending_question(self) -> PendingQuestion | None:
        return self._pending

    def clear_pending(self) -> None:
        self._pending = None

    def answer_question(self, answer: str, selected_option: str | None = None) -> None:
        if self._pending:
            self._pending.answer = answer
            self._pending.selected_option = selected_option
