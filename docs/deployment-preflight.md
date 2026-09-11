# 生产部署预检

- 检查日期：2026-09-11
- SSH Host Alias：`2026txy`
- 主机名：`VM-8-10-opencloudos`
- 系统：OpenCloudOS 9.4，x86_64，2 vCPU，约 1.9 GiB 内存与 8 GiB Swap
- 磁盘：根分区 50 GiB，部署前剩余约 9.8 GiB（使用率 81%）
- 运行时：Node.js 22.22.0、Git 2.43.7；系统 PATH 无 npm，部署采用本地构建产物，无需服务器 npm
- Web：Nginx 1.29.8 active；首版不修改 Nginx
- 主机防火墙：未发现 firewalld/ufw 前端
- 独立端口：`9350` 已用 `ss` 确认为空闲
- 独立路径：`/opt/campus-cycle-station`、`/var/lib/campus-cycle-station`、`/etc/campus-cycle-station` 均无既有冲突
- 既有服务：`zhiheng.service`（9300）、`basketball-nutrition.service`（9320）、`steam-engine-gate03.service`（9340）均 active；部署不得修改或重启

结论：具备独立目录、端口、数据、服务和回退条件；采用本地构建、版本化 release 与独立 systemd 服务，资源限制仅施加于校园循环站。
