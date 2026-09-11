# 生产部署说明

## 运行信息

- SSH Host Alias：`2026txy`
- 应用：`/opt/campus-cycle-station/current`
- 版本目录：`/opt/campus-cycle-station/releases/<commit>`
- 数据：`/var/lib/campus-cycle-station`
- 数据库：`/var/lib/campus-cycle-station/data/campus-cycle-station.sqlite`
- 原图：`/var/lib/campus-cycle-station/uploads`
- 卡通图：`/var/lib/campus-cycle-station/generated`
- 配置：`/etc/campus-cycle-station/campus-cycle-station.env`（敏感内容不进入 Git）
- 服务：`campus-cycle-station.service`
- 端口：`9350`
- 健康接口：`http://127.0.0.1:9350/api/health`
- 公网入口：`http://81.70.105.32:9350/`

## 运维命令

```bash
systemctl status campus-cycle-station.service
journalctl -u campus-cycle-station.service --since today --no-pager
systemctl restart campus-cycle-station.service
systemctl stop campus-cycle-station.service
```

EnvironmentFile 配置 `CYCLE_MODE=production`、独立数据路径、监听地址、每日 AI 预算及 Vision/Agent/Image 模型。API Key 与教师口令仅保存在该受限文件中。

## 备份与恢复

手动备份：

```bash
/opt/campus-cycle-station/current/scripts/backup-production.sh
```

脚本使用 Node SQLite 在线备份 API 生成一致数据库副本，并归档原图与卡通图。恢复时先停止校园循环站服务，将目标备份恢复到新的临时目录并做 `PRAGMA integrity_check`；正式恢复应先保留当前数据目录，再将已验证副本放入原独立路径。不得只复制 WAL 模式主数据库文件。

2026-09-11 已实际执行一次备份，SHA-256 校验通过；副本恢复至独立临时目录后 SQLite `integrity_check=ok`，170 个柜位可读。

## 验收与隔离

服务器上使用同一生产构建和独立临时数据运行 M2–M5 检查，覆盖登录、教程、导入、积分、捐赠、FIFO 分柜、审核、卡通任务、领取、异常反馈与助手；三类 AI 另做真实受控调用。验收数据已删除，正式生产库保持空白。

## 回退

1. 保留 `/var/lib/campus-cycle-station` 与 `/etc/campus-cycle-station`，不得删除数据库和上传。
2. 将 `/opt/campus-cycle-station/current` 原子切换到上一版本目录。
3. 仅重启 `campus-cycle-station.service`，检查健康接口和 journal。
4. 不修改或重启服务器上的其他服务。
