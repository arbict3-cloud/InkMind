# AI 小说工作台项目说明

## 这是做什么的

本项目基于开源项目 [InkMind](https://github.com/jastfkjg/InkMind) 修改，用来制作一个可视化的 AI 长篇小说创作工具。用户不需要一直在聊天窗口里手工复制内容，而是在程序中管理作品、大纲、人物、章节和正文，并通过 API 调用不同的大模型完成生成、改写、续写和检查。

当前技术结构：

- 前端：React + TypeScript + Vite + Ant Design
- 后端：FastAPI + SQLite
- AI 接口：OpenAI 兼容接口、Anthropic，以及本次新增的原生 Google Gemini 接口
- 本地开发地址：前端 `http://localhost:5173`，后端 `http://localhost:8000`

## 用户提出的核心要求

1. 提供明显的可视化操作界面，而不是只在终端调用 API。
2. 有独立的 API/模型配置页面，可随时切换模型。
3. 创作流程包含：
   - 故事总纲生成
   - 分卷大纲生成
   - 章节大纲生成
   - 章节正文生成
4. 每个创作阶段可以单独选择不同模型，例如大纲用 DeepSeek，正文用千问或 Gemini。
5. 章节按作品、卷、章节层级管理，类似文件夹中的“第一卷 / 第一章 / 第二章”。
6. 需要解决长篇小说上下文问题，包括人物设定、前文摘要、伏笔和连续性检查。
7. 优先考虑中文写作质量、稳定性和性价比。
8. 项目、依赖、下载内容和运行数据尽量放在非系统盘；Windows 当前使用 `G:` 盘。
9. 项目需要保存到用户自己的 GitHub，以便在 MacBook 上继续开发。

## 建议的模型搭配

- 总纲、卷纲、剧情推演：DeepSeek
- 章节大纲、普通正文：通义千问 Qwen Plus
- 大批量低成本任务：千问 Flash
- 重要章节精修：千问 Max 或 Gemini
- ChatGPT Plus 会员不能直接作为 API 额度；OpenAI API 需要另外计费

第一阶段建议只接入一个国内 API，把完整流程跑通后再增加其他模型。

## 当前已经完成

- 将代码和依赖放到 `G:\AI-Novel-Studio`
- 筛选 InkMind 作为主要开源基础项目
- 保留一个界面原型在 `G:\AI-Novel-UI-Prototype`
- 保留 Gemini 小说生成参考项目在 `G:\AI-Novel-References`
- 新增 Google Gemini 原生 SDK provider
- 在 AI 设置页面加入 Gemini provider 选项
- 增加 Gemini 环境变量示例和模型列表
- 新增作品内的“创作流程”页面，包含故事总纲、分卷大纲、章节大纲、正文生成四个阶段
- “创作流程”页面支持每个阶段独立选择 provider 和 model
- 故事总纲、分卷大纲会保存为构思笔记，章节大纲可以批量创建章节草稿
- Gemini provider 已完成本地无网络构造测试
- 前端生产构建已通过
- 后端健康检查已通过，返回 `{"status":"ok"}`

## 仍需继续实现

- 把“创作流程”页面的阶段按钮接入后端生成接口，实现一键生成总纲、卷纲、章纲和正文
- 正式的“卷”数据模型及卷/章节树形目录
- 每个创作阶段独立保存 provider 和 model
- 长篇上下文压缩、人物状态、伏笔与时间线记忆
- 成本预估、Token 统计和单次任务预算限制
- 一键启动脚本和适合普通用户的桌面安装包
- 自动测试与真实 API 联调

## Windows 启动方式

后端 PowerShell：

```powershell
G:
cd G:\AI-Novel-Studio\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

前端 PowerShell：

```powershell
G:
cd G:\AI-Novel-Studio\frontend
npm.cmd run dev
```

浏览器打开 `http://localhost:5173`。

API Key 只放在 `backend/.env`，该文件已被 `.gitignore` 排除，禁止提交到 GitHub。

## MacBook 接续开发

从用户自己的 GitHub 仓库克隆代码后：

```bash
git clone <用户仓库地址>
cd <仓库目录>/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env
```

填写 `backend/.env`，再启动后端：

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

另开终端启动前端：

```bash
cd <仓库目录>/frontend
npm install
npm run dev
```

注意：`.venv`、`node_modules`、本地数据库和 `.env` 不会上传，需要在 MacBook 上重新生成。

## 开源许可

InkMind 使用 GPL-3.0 许可证。个人使用和修改没有问题；如果向他人分发修改后的程序，需要遵守 GPL-3.0 的源码开放要求。
