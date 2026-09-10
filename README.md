# 校园循环站 / Campus Cycle Station

本仓库已完成 M1 可运行工程骨架；登录、积分、捐赠、领取和真实 AI 均待后续开发。

## 当前状态（2026-09-09）
- 技术栈：React + TypeScript + Vite；Node 内置 HTTP API；独立 SQLite 文件。
- 页面入口：`/student`、`/teacher`、`/locker-wall`。
- 健康接口：`/api/health`；AI 明确为 `mock` 模式，不调用真实服务。
- 未连接、修改或部署腾讯云服务器，未对 SubQuiz 执行操作。

## 本地启动

需要 Node.js 22.12.0 或更高版本。新 PowerShell 窗口执行：

```powershell
Set-Location 'E:\Work-2\campus-cycle-station'
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/student`。同一页面顶部可切换教师端和柜墙；按 API 默认监听 `http://127.0.0.1:3001`。按 `Ctrl+C` 同时停止两个开发服务。

常用检查：

```powershell
npm run db:check
npm run typecheck
npm run build
```

默认数据库写入 `data/campus-cycle-station.sqlite`，该路径不进入 Git。Node 22 的内置 SQLite API 仍会显示实验性警告；M1 已验证实际读写可用。

## 文件导航
- AGENTS.md：执行边界与低上下文工作方式。
- docs/requirements.md：业务规则；明确区分已确认与建议默认值。
- docs/progress.md：短进度记录，每次完成任务原地更新。
- docs/roadmap.md：阶段任务与验收标准，按当前阶段读取。
- prompts/：首轮检查、项目骨架、后续任务和网页端评审提示词。
- config/points-template.example.json：试运行积分模板，仅为可修改的初始建议。
- fixtures/demo-students.csv：6名完全虚构的演示学生，适配器需要识别其演示用途。

## 协作方式
Codex是主要代码执行者，网页对话负责需求、效果与异常复核。不要两个执行者同时修改同一阶段代码。
不把整段聊天反复复制给Codex。后续任务报告仅需：改动、测试、已知问题、提交/推送状态。
对外部资料的参考仅为工具用法，不替代本项目已确认规则；命令和依赖以现场版本核查为准。

## 工具用法参考（核查日期2026-09-09）
- Codex CLI：https://developers.openai.com/codex/cli/
- AGENTS.md：https://developers.openai.com/codex/guides/agents-md/
- Windows沙箱：https://developers.openai.com/codex/windows/
- Work与Codex：https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- GitHub本地认证：https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git
