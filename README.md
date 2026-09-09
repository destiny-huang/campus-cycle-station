# 校园循环站 / Campus Cycle Station

本目录是开发启动资料，不是已开发完成的网站。不要用来覆盖已有应用工程。

## 当前事实（2026-09-09只读核查）
- 目标仓库：destiny-huang/campus-cycle-station。
- 已进入GitHub连接的已授权仓库列表；当前可见性为Public。
- 远端内容接口明确返回空仓库。本资料尚未由助手提交到远端。
- 未连接、修改或部署腾讯云服务器，未对SubQuiz执行写入。
- 本机Git/Codex认证与服务器配置尚待现场核查。查询权限不等于已经验证push。

## 第一次使用
1. 在Windows PowerShell中将远端仓库克隆到独立目录，例如 E:\Work-2\campus-cycle-station。
2. 将本压缩包内容放到仓库根目录，AGENTS.md与README.md应直接位于根目录；不要放在SubQuiz目录下。
3. 先阅读AGENTS.md，再在该目录启动Codex，执行 prompts/01-preflight.md 的只读检查。
4. 检查无误后，人工提交这些启动资料并push到main，形成第一个检查点。
5. 执行 prompts/02-bootstrap.md，只做M1骨架；后续按docs/roadmap.md逐阶段推进。

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
