# InkMind 前端 UI 优化计划

> 分析日期：2026-05-10
> 范围：页面布局、导航系统、主题系统、组件一致性、交互模式、无障碍性、性能

---

## 一、高优先级问题

### 1. NovelWrite.tsx 巨型组件拆分

**现状**：[NovelWrite.tsx](file:///../frontend/src/pages/NovelWrite.tsx) 是 2590 行单文件，包含约 40 个 state、20 个 useEffect、15 个 async 函数。任何 state 变化（包括 AI 流式生成时每个 token）都会触发整个组件 re-render。

**问题**：
- 可维护性极差，修改任何功能都需要理解整个文件
- 性能隐患：`content` state 在 AI 流式生成时每个 token 都更新，导致整个组件 re-render
- `useEffect` 依赖数组中包含 `chapters` 数组，每次章节列表更新都会重新计算自动保存 effect
- 已有 [ChapterSidebar.tsx](file:///../frontend/src/components/ChapterSidebar.tsx) 组件但未被使用，NovelWrite 中又内联了一份几乎相同的侧栏代码（第 1665-1711 行）

**建议拆分**：

| 子组件/Hook | 职责 |
|-------------|------|
| `WriteEditor` | 编辑器核心（textarea + 自动保存） |
| `ChapterSidebar` | 章节侧栏（复用已有组件） |
| `AIPanel` | 右侧 AI 抽屉 |
| `SelectionToolbar` | 选区浮动工具栏 |
| `VersionPanel` | 版本管理面板 |
| `EditorSettings` | 字号/行高/行宽设置 |
| `useAutoSave` hook | 自动保存逻辑 |
| `useAIOperations` hook | AI 生成/改写/续写逻辑 |

---

### 2. Header/导航系统统一

**现状**：5 个页面各自重写完整的 Header（品牌标识 + 语言切换 + 主题切换 + 用户菜单），严重违反 DRY：

| 页面 | Header 行数 | 文件 |
|------|------------|------|
| Dashboard | ~60 行 | Dashboard.tsx:117-175 |
| NovelLayout | ~60 行 | NovelLayout.tsx:71-128 |
| UsageDashboard | ~55 行 | UsageDashboard.tsx:147-202 |
| AiSettings | ~55 行 | AiSettings.tsx:141-196 |
| BackgroundTasks | ~55 行 | BackgroundTasks.tsx:189-244 |

**问题**：
- 用户菜单（languageMenuItems、userMenuItems）在 5 个文件中各有一份几乎相同的定义
- 已有 [UserMenu.tsx](file:///../frontend/src/components/UserMenu.tsx) 但功能不完整，只包含 LLM 选择和登出
- Header 高度不统一：Dashboard 72px，NovelLayout 64px
- 返回按钮逻辑不一致：NovelLayout 硬编码 `nav("/")`，其他页面用 `goBackSmart()`

**建议**：提取共享 `AppHeader` 组件，包含品牌标识、返回按钮、语言/主题切换、用户菜单。

---

### 3. Sepia 主题是死代码

**现状**：
- [ThemeContext.tsx](file:///../frontend/src/context/ThemeContext.tsx) 只支持 `light | dark`
- CSS 中有完整的 `.theme--sepia` 定义（global.css:98-129）
- [theme.ts](file:///../frontend/src/styles/theme.ts) 定义了 `inkMindSepiaTheme`（第 280-364 行）
- `getThemeConfig()` 函数（第 504-512 行）没有处理 sepia 分支

**建议**：补全 ThemeContext 的 sepia 支持，或在 DESIGN.md 中明确移除 sepia。

---

### 4. Login/Register 不支持深色模式

**现状**：[Login.tsx:125-126](file:///../frontend/src/pages/Login.tsx#L125-L126) 硬编码浅色值（`color: "#141413"`、`background: "#faf9f5"`），深色系统偏好下不可用。

**建议**：将硬编码颜色替换为 CSS 变量或 Ant Design token。

---

## 二、中优先级问题

### 5. 两套布局/组件体系并存

| 维度 | Ant Design 体系 | 自定义 CSS 体系 |
|------|----------------|----------------|
| **使用页面** | Dashboard、Usage、AiSettings 等 | NovelWrite 写作页 |
| **布局** | `<Layout><Header><Content>` | `.write-shell` / `.write-workspace` |
| **按钮** | Ant Design Button | `.btn` 系列 |
| **卡片** | `<Card>` borderRadius:16 | `.card` borderRadius:12 |
| **输入框** | `<Input>` | `.input` / `.textarea` |
| **主题变量** | `--bg`、`--card` | `--theme-bg`、`--theme-card` |

**问题**：页面间切换时视觉跳变明显（Header 高度、padding、背景色过渡不一致）。

**建议**：统一主题变量命名，写作页的 `--theme-*` 变量映射到全局 `--*` 变量。

---

### 6. 卡片圆角不一致

| 组件 | 当前圆角 | DESIGN.md 规定 |
|------|---------|---------------|
| Ant Design Card | 16px | 12px（`rounded.lg`） |
| 自定义 `.card` | 12px | ✅ 正确 |
| 导出弹窗 | 12px | ✅ 正确 |

**建议**：统一 Ant Design Card 的 `borderRadius` 为 12px，16px 只用于 hero 容器。

---

### 7. 颜色使用不规范

| 位置 | 当前值 | 应改为 |
|------|--------|--------|
| Login.tsx:263 链接 | `#c2410c` | `#cc785c` (primary) |
| NovelPeople.tsx:107 Tag | `color="blue"` | `#cc785c` (accent) |
| BackgroundTasks.tsx:607 运行状态 | `#1677ff` | `#5db8a6` (accent-teal) |

**建议**：全局搜索非规范颜色值，替换为 DESIGN_COLORS 中定义的变量。

---

### 8. 断点体系不一致

| 来源 | 断点 |
|------|------|
| DESIGN.md | 768 / 1024 / 1440px |
| 实际 CSS | 480 / 760 / 800 / 820 / 900 / 1280px |
| Ant Design | xs/sm/md/lg/xl（5 档） |

**建议**：统一为 DESIGN.md 规定的 3 档断点，自定义 CSS 中使用 CSS 自定义属性定义断点值。

---

### 9. 内容区最大宽度不统一

| 页面 | maxWidth | DESIGN.md 规定 |
|------|----------|---------------|
| Dashboard | 1200px | ~1200px ✅ |
| NovelLayout | 1200px | ✅ |
| NovelSettings | 900px | 偏窄 |
| AiSettings | 900px | 偏窄 |
| UsageDashboard | 1280px | 偏宽 |
| BackgroundTasks | 1400px | 偏宽 |

**建议**：统一为 `max-width: 1200px`，设置类页面可用 `960px`。

---

### 10. 加载/空状态不统一

| 页面 | 加载状态 | 空状态 |
|------|---------|--------|
| Dashboard | Ant Design `<Spin>` | `<Empty>` 组件 |
| NovelPeople/Memos | `<Spin>` | `<Empty>` 组件 |
| NovelWrite | 一行文字"加载章节中..." | `<p className="muted">` |
| Usage | `<Spin>` | `<Text type="secondary">` |

**建议**：NovelWrite 初始加载改用 Spin 或骨架屏；空状态统一使用 `<Empty>` 组件。

---

### 11. global.css 过大

**现状**：[global.css](file:///../frontend/src/styles/global.css) 超过 7200 行，包含所有页面的样式。

**建议拆分**：

| 文件 | 职责 |
|------|------|
| `base.css` | 重置、CSS 变量、通用工具类 |
| `write.css` | 写作页专用样式 |
| `ai-assistant.css` | AI 助手面板样式 |
| `auth.css` | 登录/注册页样式 |
| `dashboard.css` | Dashboard 页样式 |
| `components.css` | 共享组件样式（卡片、按钮、输入框等） |

---

## 三、低优先级问题

### 12. 过渡动画缺失

- 页面路由切换无过渡动画
- 侧栏展开/收起无滑动动画（只有 display 切换）
- AI 抽屉面板无滑入/滑出动画

**建议**：添加 `transition: transform 0.3s ease, opacity 0.3s ease` 给侧栏和抽屉面板。

---

### 13. 无障碍性改进

| 问题 | 位置 | 建议 |
|------|------|------|
| 选区工具栏无法键盘访问 | NovelWrite.tsx:2528 | 添加 tabIndex 和键盘打开方式 |
| 缺少 skip-to-content | 全局 | 添加跳过导航链接 |
| `--muted-soft` 对比度不足 | global.css | #8e8b82 在 #faf9f5 上对比度 3.2:1，需 ≥ 4.5:1 |
| 侧栏收起后焦点未转移 | NovelWrite.tsx | 收起后 focus 到编辑器 |
| Header 按钮缺少 aria-label | 多处 | 语言切换、用户菜单触发器 |

---

### 14. 返回按钮逻辑统一

| 页面 | 当前实现 | 建议 |
|------|---------|------|
| NovelLayout | 硬编码 `nav("/")` | 改用 `goBackSmart()` |
| UsageDashboard | `goBackSmart()` | ✅ |
| AiSettings | `goBackSmart()` | ✅ |
| BackgroundTasks | `goBackSmart()` | ✅ |

---

### 15. BackgroundTasks 轮询优化

**现状**：每 3 秒轮询一次任务列表，运行中任务还额外请求进度接口。多任务时请求数爆炸。

**建议**：
- 短期：增加轮询间隔到 5 秒，无运行中任务时停止轮询
- 长期：改为 WebSocket 推送或 SSE 增量查询

---

### 16. dangerouslySetInnerHTML XSS 风险

**位置**：NovelWrite.tsx:2482

**现状**：使用 `dangerouslySetInnerHTML` 渲染版本 diff HTML。

**建议**：确认服务端是否对 diff_html 做了消毒处理；如未做，改用 React 组件渲染 diff。

---

## 四、优化优先级排序

| 优先级 | 优化项 | 影响 | 复杂度 | 建议顺序 |
|--------|--------|------|--------|---------|
| 🔴 | NovelWrite 拆分 | 高 | 高 | 1 |
| 🔴 | Header 提取为共享组件 | 高 | 中 | 2 |
| 🔴 | Sepia 主题补全或移除 | 中 | 低 | 3 |
| 🔴 | Login/Register 深色模式 | 中 | 低 | 4 |
| 🟡 | 卡片圆角统一为 12px | 中 | 低 | 5 |
| 🟡 | 非规范颜色替换 | 中 | 低 | 6 |
| 🟡 | 加载/空状态统一 | 中 | 低 | 7 |
| 🟡 | 断点体系统一 | 中 | 中 | 8 |
| 🟡 | 内容区 maxWidth 统一 | 低 | 低 | 9 |
| 🟡 | global.css 拆分 | 中 | 中 | 10 |
| 🟡 | 两套主题变量统一 | 中 | 中 | 11 |
| 🟢 | 过渡动画 | 低 | 中 | 12 |
| 🟢 | 无障碍性 | 低 | 中 | 13 |
| 🟢 | 返回按钮统一 | 低 | 低 | 14 |
| 🟢 | 轮询优化 | 低 | 中 | 15 |
| 🟢 | XSS 风险确认 | 低 | 低 | 16 |
