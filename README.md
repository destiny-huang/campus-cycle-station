# 校园循环站 / Campus Cycle Station

本仓库已完成 M2：可运行工程骨架、学生/教师登录、学生名单导入和积分账本。捐赠、领取、真实库存和真实 AI 仍待后续开发。

## 当前状态（2026-09-10）
- 技术栈：React + TypeScript + Vite；Node 内置 HTTP API；独立 SQLite 文件。
- 页面入口：`/student`、`/teacher`、`/locker-wall`。
- 学生使用已导入名单中的姓名＋学号登录；教师可导入 CSV、搜索学生和发放劳动奖励。
- 健康接口：`/api/health`；AI 明确为 `mock` 模式，不调用真实服务。
- 未连接、修改或部署腾讯云服务器，未对 SubQuiz 执行操作。

## 本地启动

需要 Node.js 22.12.0 或更高版本。新 PowerShell 窗口执行：

```powershell
Set-Location 'E:\Work-2\campus-cycle-station'
$env:TEACHER_PASSWORD='<请在本机自定口令>'
npm run dev
```

依赖尚未安装时先执行一次 `npm install`。默认使用正式本地数据路径；打开 `http://127.0.0.1:5173/student`，页面顶部可切换教师端和柜墙，API 默认监听 `http://127.0.0.1:3001`。按 `Ctrl+C` 同时停止两个开发服务。

需要使用仓库内 6 名虚构学生演示时，新 PowerShell 窗口执行：

```powershell
Set-Location 'E:\Work-2\campus-cycle-station'
$env:CYCLE_MODE='demo'
$env:TEACHER_PASSWORD='<请在本机自定口令>'
npm run dev
```

演示账号为 `演示同学01` / `DEMO001` 至 `演示同学06` / `DEMO006`，每人首次初始化总额为 200 分。普通 CSV 新学生首次初始化为 20 分；重复导入、登录和重启不会重复发放。教师 CSV 表头为 `name,student_id,class_name`。

常用检查：

```powershell
npm run db:check
npm run m2:check
npm run typecheck
npm run build
```

数据库按环境隔离写入 `data/production/campus-cycle-station.sqlite` 或 `data/demo/campus-cycle-station.sqlite`，均不进入 Git；确有需要时可用本地环境变量 `CYCLE_DB_PATH` 指定其他路径。Node 22 的内置 SQLite API 仍会显示实验性警告，相关读写已实际验证。

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
