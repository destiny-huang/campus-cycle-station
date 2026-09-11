# 校园循环站 / Campus Cycle Station

本仓库已完成 M5：在既有闭环上加入 OpenRouter 识物、系统模板估分、审核后异步卡通化和只读“循环小助手”。未配置 AI 或 AI 请求失败时，原有业务仍可正常使用。

## 当前状态（2026-09-11）
- 技术栈：React + TypeScript + Vite；Node 内置 HTTP API；独立 SQLite 文件。
- 页面入口：`/student`、`/teacher`、`/locker-wall`。
- 网站根路径 `/` 为正式欢迎与学生登录入口；首次登录会自动进入不改变积分和业务数据的新手教程。
- 学生使用已导入名单中的姓名＋学号登录；教师可导入 CSV、搜索学生和发放劳动奖励。
- 学生可提交单件真实照片物品并自动分柜；教师核实后上架。其他学生可确认价格、余额和柜位后直接领取，无需教师审批。
- 健康接口：`/api/health`；AI Key 未配置时自动禁用，核心业务仍可正常运行。
- 生产环境已使用独立服务、数据和端口部署；未对服务器其他项目执行操作。
- 前端支持 PWA，可从浏览器安装到手机或电脑桌面；离线状态仅显示安全提示，不缓存账号、积分、物品或上传图片。

## 生产访问

- 正式首页：`https://cycle.bdfzscc.com/`
- 健康接口：`https://cycle.bdfzscc.com/api/health`
- 短期回退：`http://81.70.105.32:9350/`
- systemd 服务：`campus-cycle-station.service`
- 应用与数据均使用校园循环站独立目录；生产环境不会自动加载 demo seed。

详细运维、备份和回退方法见 `docs/deployment.md`。

## 本地启动

带 OpenRouter AI 的最简单演示启动方式（口令和 Key 仅保留在当前 PowerShell 进程，不写文件）：

```powershell
.\scripts\start-ai-demo.ps1
```

没有 `OPENROUTER_API_KEY` 时也可继续使用原有登录、捐赠、审核、领取、柜墙和教程，AI 区域会显示“AI服务暂未启用”。

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

体验捐赠：学生登录后可直接调用手机后置相机，或从相册选择照片；过大的相机照片会在浏览器内优化为 3MB 以内的 JPEG。系统按所选区域 FIFO 分配柜位；AI 尝试识别物品与照片可见成色，系统按类别模板计算建议分，最终仍由教师核实实物后确认。识别失败时继续使用原有规则估分。

安装 PWA：Android 或桌面浏览器可点击页面顶部“安装应用”；iPhone / iPad 请在 Safari 中点击“分享”→“添加到主屏幕”。安装后仍需联网完成登录、积分、捐赠、领取和 AI 操作，Service Worker 不缓存业务接口或个人数据。

体验领取：学生保持登录并进入“柜位展示”，打开标为“可领取”的真实物品，核对物品、所需积分、当前余额和柜位后确认。成功会立即扣分、核销物品并释放柜位，同时提示前往领取时柜位取物；历史记录保留当时的照片和柜位。柜内物品异常可在学生领取记录中反馈，由教师端人工标记处理，不会自动退款或调分。

首次登录教程完成或跳过后不会再次自动出现；学生可在学生端点击“使用帮助 / 新手教程”重看。教师搜索并选中学生后可重置教程状态，此操作不影响积分、流水、捐赠、领取或柜位。

常用检查：

```powershell
npm run db:check
npm run m2:check
npm run m3:check
npm run m4:check
npm run m45:check
npm run m5:check
npm run pwa:check
npm run typecheck
npm run build
```

`m5:check` 完全使用 Mock，不产生真实费用。只有明确配置 `OPENROUTER_API_KEY` 后才可手动执行 `npm run m5:live-check`；该检查至多执行一次视觉、一次助手和一次图片请求。
默认 Vision 与 Agent 模型为 `qwen/qwen3.5-9b`，Image 模型为 `google/gemini-3.1-flash-lite-image`；三者均可通过服务端环境变量覆盖。

数据库按环境隔离写入 `data/production/campus-cycle-station.sqlite` 或 `data/demo/campus-cycle-station.sqlite`，原图写入 `uploads/`，卡通图写入 `generated/cartoon/`，均不进入 Git。可用 `CYCLE_DB_PATH`、`CYCLE_UPLOAD_DIR`、`CYCLE_GENERATED_DIR` 指定其他路径。Node 22 的内置 SQLite API 仍会显示实验性警告，相关读写已实际验证。

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
