# TODO

## 🔴 高优先

- **长文档上下文**：自动构建故事纲要（压缩摘要 + 人物关系 + 伏笔追踪），注入每次 LLM 调用
- **一致性校验**：生成后检查人物/时间线/伏笔是否矛盾，不一致时主动提醒
- **AI 中断机制**：停止按钮 → SDK interrupt()，用户无需等待生成完成（参考 ArcReel）
- **SSE 重连 + 快照**：断线自动重连，snapshot/patch/delta 三层增量恢复（参考 ArcReel）
- **流式 Markdown 增量渲染**：替换 react-markdown 全量重渲染，用 streamdown 等方案增量更新 DOM
- **Sepia 主题**：配置已写好，补全 CSS 变量映射和切换入口
- **EPUB / DOCX 导出**：当前仅支持 TXT / Markdown / PDF

## 🟡 中优先

- **ContentBlock 内联渲染**：工具调用结果内联到消息流，而非与正文分离（参考 ArcReel ContentBlock 分发器）
- **多会话管理**：多创作方向并行对话，会话列表 + 切换 + 历史（参考 ArcReel SessionSelector）
- **斜杠命令**：`/续写` `/改写` `/生成大纲` `/质量检查` 快捷触发（参考 ArcReel SlashCommandMenu）
- **多步问答向导**：一次 AskUserQuestion 传入多个问题，前端分步展示（参考 ArcReel PendingQuestionWizard）
- **实时续写建议**（Copilot 模式）：输入停顿后淡入灰色建议，Tab 接受 / Esc 忽略
- **主动卡文检测**：检测长时间未输入或反复删除，主动提供方向建议
- **风格模仿**：上传参考文本，AI 学习后按该风格生成

## 🟢 低优先

- **思考过程展示**：展示 Claude thinking 内容，增加透明度（参考 ArcReel ThinkingBlock）
- **写入权限分层**：save_chapter 前校验内容、delete_chapter 需用户确认（参考 ArcReel 五层权限链）
- **工作流状态持久化**：写作阶段存 DB，支持断点续作（参考 ArcReel 状态机）
- **质量评估闭环**：生成后自动打分，低于阈值重试或提示
- **敏感词检测**：生成后/发布前自动扫描
- **章节大纲管理**：思维导图式大纲，拖拽排序
- **拼写检查**：错别字检查、标点规范化
- **协作编辑**：多用户协作 + 权限管理

## ⚙️ 工程

- **PostgreSQL**：替代 SQLite，解决并发写入锁表
- **Redis 缓存**：相同概要结果缓存，避免重复消耗 token
- **数据库优化**：索引、预加载、分页、连接池
- **前端性能**：代码分割、虚拟滚动、渲染优化
- **测试**：单元测试、集成测试、E2E 测试
- **安全**：密码强度验证、Token 刷新、OAuth 登录、CSRF 防护、速率限制、HTTPS
- **Agent 可观测性**：决策过程可视化、上下文压缩与遗忘
- **数据备份**：定期备份 + 恢复验证
