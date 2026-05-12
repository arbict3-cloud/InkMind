# ArcReel vs InkMind AI 助手对比分析与优化计划

> 参考项目：https://github.com/ArcReel/ArcReel
> 分析日期：2026-05-10

---

## 一、架构对比总览

| 维度 | ArcReel | InkMind | 差距 |
|------|---------|---------|------|
| **会话管理** | SessionManager + SessionActor（Actor 模型） | 全局字典 `_active_sessions` | ⚠️ 大 |
| **SSE 流** | snapshot/patch/delta 三层增量 | 仅 delta 级流式 | ⚠️ 大 |
| **中断机制** | SDK `interrupt()` + 前端停止按钮 | 无中断能力 | 🔴 关键缺失 |
| **SSE 重连** | 自动重连 + 快照恢复 | 无重连，断线即丢失 | ⚠️ 大 |
| **AskUserQuestion** | asyncio.Future + PendingQuestionWizard | asyncio.Event + 简单选项 | ⚠️ 中 |
| **对话持久化** | SDK 自动持久化 + Transcript 读取 | 无持久化 | ⚠️ 中 |
| **并发安全** | 每会话独立 Actor | 全局变量 `_novel_id` | 🔴 关键问题 |
| **会话清理** | 定时巡检 + LRU 淘汰 | 无清理机制 | ⚠️ 中 |
| **错误恢复** | 服务重启自动标记 stale 会话 | 会话全部丢失 | ⚠️ 中 |
| **前端状态** | Zustand + 乐观更新 | React state + 无持久化 | ⚠️ 中 |

---

## 二、ArcReel 核心设计模式

### 2.1 Actor 模型

每会话一个 `SessionActor`（asyncio task），独占一个 `ClaudeSDKClient`，命令通过队列传递：

```
AssistantService
  └── SessionManager
        └── ManagedSession (per session)
              ├── SessionActor (owns ClaudeSDKClient)
              ├── message_buffer (广播缓冲)
              ├── subscribers (SSE 队列集合)
              ├── pending_questions (AskUserQuestion 等待器)
              └── _inbox (异步后处理队列)
```

命令类型：`query` / `interrupt` / `disconnect`，通过 `asyncio.wait` 实现非阻塞多路复用。

### 2.2 三层增量 SSE

| 层级 | 事件类型 | 触发条件 | 数据量 |
|------|---------|---------|--------|
| **Snapshot** | `snapshot` | 初始连接/重连 | 完整 turns + draft_turn + pending_questions |
| **Patch** | `patch` | groupable 消息到达 | 增量 turn 操作（append/replace_last/reset） |
| **Delta** | `delta` | StreamEvent 到达 | 单个文本块/工具输入块 |

Patch 算法：
- `append`：追加新 turn
- `replace_last`：替换最后一个 turn
- `reset`：全量重置

### 2.3 中断机制

```python
# SessionActor._drive_query
if next_cmd.type == "interrupt":
    await client.interrupt()  # SDK 原生 interrupt
```

中断后状态结算：将 result 映射为 `"interrupted"`，广播合成 echo 消息。

### 2.4 AskUserQuestion

使用 `asyncio.Future` 实现异步等待用户输入：

```python
pending = managed.add_pending_question(payload)
answers = await pending.answer_future  # 阻塞直到用户回答
return PermissionResultAllow(updated_input=merged_input)
```

前端 `PendingQuestionWizard`：多步骤向导、自动"其他"选项、步骤导航。

### 2.5 会话生命周期

- 服务重启时自动标记 stale 会话为 `interrupted`
- 定时巡检（5 分钟）清理超时会话
- 最大并发会话数限制（默认 5），LRU 淘汰
- SSE 心跳（20 秒），队列溢出时注入 overflow 信号触发重连

### 2.6 乐观更新

发送消息时立即在 UI 显示用户消息（optimistic turn），UUID 以 `optimistic-` 前缀标记，后端确认后替换。

---

## 三、InkMind 当前问题详解

### 🔴 P0-1：用户中断机制缺失

**现状**：用户发送消息后只能等待完成或 90 秒超时。`connectSse()` 返回的 `close()` 方法未被保存使用。

**ArcReel 做法**：
- 后端：`SessionActor` 支持 `interrupt` 命令，调用 `client.interrupt()`
- 前端：运行时显示停止按钮，调用中断 API
- 中断后广播 echo 消息，状态结算为 `interrupted`

**优化方案**：
- 后端：在 `ClaudeOrchestrator` 中添加 `interrupt_session()` 方法
- API：添加 `POST /novels/{id}/agent/sessions/{sid}/interrupt` 端点
- 前端：AI 助手面板添加停止按钮

### 🔴 P0-2：并发安全问题

**现状**：`agent_tools.py` 使用模块级全局变量：

```python
_db_session_factory: Any = None
_novel_id: int = 0
_session_id: str = ""
```

并发请求时 `init_tool_context()` 会被覆盖，导致工具读取错误的小说数据。

**ArcReel 做法**：每会话独立 Actor，上下文通过参数传递。

**优化方案**：使用 `contextvars` 替代全局变量：

```python
import contextvars

_current_novel_id: contextvars.ContextVar[int] = contextvars.ContextVar("novel_id")
_current_session_id: contextvars.ContextVar[str] = contextvars.ContextVar("session_id")
```

### 🔴 P0-3：SSE 断线重连

**现状**：SSE 断线后没有重连机制，前端丢失所有流式数据。

**ArcReel 做法**：三层增量模型，断线后重连时发送完整快照恢复状态。

**优化方案**：
- 后端：SSE 连接建立时发送 `snapshot` 事件（包含当前所有消息）
- 前端：SSE `onerror` 时自动重连，收到 `snapshot` 后恢复状态

---

### 🟡 P1-1：会话清理和过期机制

**现状**：`_active_sessions` 无过期清理，长时间运行后内存泄漏。

**ArcReel 做法**：定时巡检（5 分钟），清理超时会话，最大并发会话数限制（默认 5），LRU 淘汰。

**优化方案**：
- 添加会话 TTL（如 30 分钟无活动自动关闭）
- 定时巡检清理过期会话
- 最大并发会话数限制

### 🟡 P1-2：Actor 模式重构会话管理

**现状**：`chat()` 方法每次调用都直接操作 SDK client，没有命令队列，无法在查询执行中插入中断命令。

**ArcReel 做法**：`SessionActor` 封装所有 SDK 操作，命令通过队列传递，支持 query/interrupt/disconnect。

**优化方案**：将 `OrchestratorSession` 升级为类似 `SessionActor` 的设计，命令队列驱动，支持中断。

### 🟡 P1-3：对话历史持久化

**现状**：对话历史仅在前端 React state 中，刷新即丢失。

**ArcReel 做法**：SDK 自动将对话写入 JSONL 文件，通过 `SdkTranscriptAdapter` 读取历史。

**优化方案**：
- 利用 SDK 的 `get_session_messages()` 读取历史
- 前端切换回已有会话时加载历史消息
- 或简单方案：将消息存入 SQLite

### 🟡 P1-4：乐观更新

**现状**：发送消息后等待 SSE 事件才显示，用户感觉有延迟。

**ArcReel 做法**：发送时立即显示 optimistic turn，后端确认后替换。

**优化方案**：前端发送消息时立即添加用户消息到列表，SSE 确认后替换。

### 🟡 P1-5：AskUserQuestion 增强

**现状**：简单的选项按钮 + 文本输入，无步骤导航。

**ArcReel 做法**：`PendingQuestionWizard` 支持多步骤向导、自动"其他"选项、步骤导航。

**优化方案**：增强 `AskUserQuestion` 组件，支持多步骤和自由输入。

---

### 🟢 P2-1：心跳机制

**现状**：无心跳，SSE 连接可能静默断开而不被发现。

**ArcReel 做法**：SSE 流每 20 秒发送心跳，检测连接存活。

### 🟢 P2-2：消息去重

**现状**：无去重机制，SSE 重放可能导致重复消息。

**ArcReel 做法**：UUID 去重 + 内容指纹去重 + local echo 去重。

### 🟢 P2-3：斜杠命令

**现状**：无快捷命令。

**ArcReel 做法**：`/` 触发技能菜单（如 `/summarize`、`/outline`）。

### 🟢 P2-4：上下文横幅

**现状**：无上下文指示。

**ArcReel 做法**：`ContextBanner` 显示当前会话的上下文信息。

### 🟢 P2-5：文件访问控制 Hook

**现状**：无文件访问控制（但 InkMind 工具只操作数据库，风险较低）。

**ArcReel 做法**：PreToolUse Hook 拦截文件读写，确保只能访问项目目录。

---

## 四、优化优先级排序

| 优先级 | 优化项 | 影响 | 复杂度 | 建议顺序 |
|--------|--------|------|--------|---------|
| 🔴 P0 | 并发安全（contextvars） | 高 | 低 | 1 |
| 🔴 P0 | 用户中断机制 | 高 | 中 | 2 |
| 🔴 P0 | SSE 断线重连 | 高 | 高 | 3 |
| 🟡 P1 | 会话清理/过期 | 中 | 低 | 4 |
| 🟡 P1 | 乐观更新 | 中 | 低 | 5 |
| 🟡 P1 | 对话历史持久化 | 中 | 中 | 6 |
| 🟡 P1 | AskUserQuestion 增强 | 中 | 中 | 7 |
| 🟡 P1 | Actor 模式重构 | 中 | 高 | 8 |
| 🟢 P2 | 心跳机制 | 低 | 低 | 9 |
| 🟢 P2 | 消息去重 | 低 | 低 | 10 |
| 🟢 P2 | 斜杠命令 | 低 | 中 | 11 |
| 🟢 P2 | 上下文横幅 | 低 | 低 | 12 |

---

## 五、InkMind 其他已知问题

| 问题 | 位置 | 说明 |
|------|------|------|
| `_question_event_queue` 全局单例 | `claude_orchestrator.py:170` | 多会话问题事件可能交叉，`chat()` 主循环不做 session 过滤 |
| `answer_question` 重复逻辑 | `agent.py` vs `claude_orchestrator.py` | 路由直接调用 `_resolve_user_input()`，orchestrator 方法未被使用 |
| SDK Client 无重连 | `claude_orchestrator.py` | 网络中断后没有重建 client 的逻辑 |
| TaskQueue 启动不确定 | `task_queue.py` | `start()` 调用点不在 agent 模块中 |
| 旧版代码残留 | `ask_user.py`, `react.py`, `flexible_agent.py` | 未被使用的旧版 Agent 架构代码 |
| 前端 AgentSession 类型不匹配 | `client.ts` vs `agent.py` | `orchestrator/provider` vs `backend` 字段名不一致 |
