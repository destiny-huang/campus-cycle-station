# 第二套视觉交接包：简约卡通校园风

用户已选第二套活泼卡通风，并要求整体简约、少圆角、卡通实木柜有清晰隔板。
本包是给现有 M1 工程的视觉修改资料，不是网站代码，也没有部署任何系统。

## 放置方式
将本包的 design 文件夹复制到 E:\Work-2\campus-cycle-station 根目录。
最终应存在 design/style-2/SPEC.md 与 design/style-2/references/student.png。
本包只新增 design/style-2，不替换项目根目录、AGENTS.md、已有源码或数据库。
若相同目录已经被你修改过，先核对差异，不直接覆盖。

## 文件
- SPEC.md：精简后的三端视觉与交互规范。
- CODEX_TASK.md：本轮 M1.1 UI 修改任务，执行完停止。
- tokens.example.css：建议的颜色/尺寸变量，可合并进已有样式，不需原样整文件导入。
- references/student.png、teacher.png、locker-wall.png：第二套原始参考图，未经重绘。

## 使用
继续现有 Codex 会话，要求读取 CODEX_TASK.md 后实施。
优先读取文字规范，并用当前可用的本地图片查看能力看三张参考图；如无法读取图片就报告，不能假装看过。
不要把参考图整张放进网页冒充实现，不要照抄示意图片中的业务数字和多余栏目。

## 优先级
用户确认的业务规则与 AGENTS.md > SPEC.md 的精简要求 > 原始参考图中的装饰、文案与示例数字。
本轮不进入 M2，不连接服务器，不自动提交推送；由用户体验后再保存代码检查点。
