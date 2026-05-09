"""声明式技能注册表。

从 JSON 配置文件加载技能定义，动态构建工具列表。
每个技能定义包含：名称、描述、参数 schema、适用场景、执行逻辑。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from app.agent.base import BaseTool

log = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).parent / "skills"


@dataclass
class SkillParameter:
    name: str
    type: str = "string"
    description: str = ""
    required: bool = False
    default: Any = None
    enum: list[str] | None = None


@dataclass
class SkillDefinition:
    name: str
    display_name: str
    description: str
    category: str = "general"
    parameters: list[SkillParameter] = field(default_factory=list)
    applicable_phases: list[str] = field(default_factory=list)
    user_callable: bool = True
    requires_chapter: bool = False
    requires_stream: bool = False
    examples: list[str] = field(default_factory=list)

    @property
    def json_schema(self) -> dict[str, Any]:
        props: dict[str, Any] = {}
        required: list[str] = []
        for p in self.parameters:
            prop: dict[str, Any] = {"type": p.type, "description": p.description}
            if p.enum:
                prop["enum"] = p.enum
            if p.default is not None:
                prop["default"] = p.default
            props[p.name] = prop
            if p.required:
                required.append(p.name)
        schema: dict[str, Any] = {"type": "object", "properties": props}
        if required:
            schema["required"] = required
        return schema

    def to_tool_description(self) -> str:
        params_str = json.dumps(self.json_schema, ensure_ascii=False, indent=2)
        lines = [
            f"- **{self.name}**",
            f"  描述：{self.description}",
            f"  参数：{params_str}",
        ]
        if self.applicable_phases:
            lines.append(f"  适用阶段：{', '.join(self.applicable_phases)}")
        return "\n".join(lines)


class DeclarativeTool(BaseTool):
    """基于 SkillDefinition 动态创建的工具。"""

    def __init__(
        self,
        definition: SkillDefinition,
        executor: Callable[..., str] | None = None,
        stream_executor: Callable[..., Any] | None = None,
    ) -> None:
        self.definition = definition
        self.name = definition.name
        self.description = definition.description
        self.parameters = definition.json_schema
        self._executor = executor
        self._stream_executor = stream_executor

    def run(self, **kwargs) -> str:
        if self._executor is None:
            return f"工具 {self.name} 尚未绑定执行器"
        return self._executor(**kwargs)

    def run_stream(self, **kwargs):
        if self._stream_executor is None:
            return iter([f"工具 {self.name} 尚未绑定流式执行器"])
        return self._stream_executor(**kwargs)


class SkillRegistry:
    """技能注册表。

    从 JSON 配置文件加载技能定义，支持动态注册和查询。
    """

    def __init__(self) -> None:
        self._skills: dict[str, SkillDefinition] = {}
        self._executors: dict[str, Callable[..., str]] = {}
        self._stream_executors: dict[str, Callable[..., Any]] = {}

    def load_builtin_skills(self) -> None:
        if not SKILLS_DIR.exists():
            log.warning("技能定义目录不存在: %s", SKILLS_DIR)
            return
        for path in sorted(SKILLS_DIR.glob("*.json")):
            try:
                self._load_skill_file(path)
            except Exception:
                log.exception("加载技能定义失败: %s", path)

    def _load_skill_file(self, path: Path) -> None:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        params = [
            SkillParameter(
                name=p["name"],
                type=p.get("type", "string"),
                description=p.get("description", ""),
                required=p.get("required", False),
                default=p.get("default"),
                enum=p.get("enum"),
            )
            for p in data.get("parameters", [])
        ]
        skill = SkillDefinition(
            name=data["name"],
            display_name=data.get("display_name", data["name"]),
            description=data["description"],
            category=data.get("category", "general"),
            parameters=params,
            applicable_phases=data.get("applicable_phases", []),
            user_callable=data.get("user_callable", True),
            requires_chapter=data.get("requires_chapter", False),
            requires_stream=data.get("requires_stream", False),
            examples=data.get("examples", []),
        )
        self._skills[skill.name] = skill
        log.info("已加载技能: %s (%s)", skill.name, skill.display_name)

    def register_executor(
        self,
        skill_name: str,
        executor: Callable[..., str],
        stream_executor: Callable[..., Any] | None = None,
    ) -> None:
        self._executors[skill_name] = executor
        if stream_executor:
            self._stream_executors[skill_name] = stream_executor

    def get_skill(self, name: str) -> SkillDefinition | None:
        return self._skills.get(name)

    def list_skills(
        self,
        *,
        category: str | None = None,
        user_callable: bool | None = None,
        phase: str | None = None,
    ) -> list[SkillDefinition]:
        skills = list(self._skills.values())
        if category is not None:
            skills = [s for s in skills if s.category == category]
        if user_callable is not None:
            skills = [s for s in skills if s.user_callable == user_callable]
        if phase is not None:
            skills = [s for s in skills if not s.applicable_phases or phase in s.applicable_phases]
        return skills

    def build_tools(self) -> list[DeclarativeTool]:
        tools: list[DeclarativeTool] = []
        for skill in self._skills.values():
            executor = self._executors.get(skill.name)
            stream_executor = self._stream_executors.get(skill.name)
            tool = DeclarativeTool(skill, executor, stream_executor)
            tools.append(tool)
        return tools

    def build_tool_descriptions(self) -> str:
        return "\n\n".join(s.to_tool_description() for s in self._skills.values())


_registry: SkillRegistry | None = None


def get_skill_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
        _registry.load_builtin_skills()
    return _registry
