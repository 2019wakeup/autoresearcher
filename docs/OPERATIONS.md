# AutoResearcher 运维手册

> 面向部署在 Ubuntu 远程主机后的日常运维。配合 README「部署」章节使用。

## 1. 日常启动与停止

```bash
# Docker 部署
cd deploy && docker compose up -d --build     # 启动
docker compose logs -f backend                 # 看日志
docker compose down                            # 停止

# systemd 部署
sudo systemctl start|stop|restart autoresearcher
journalctl -u autoresearcher -f                # 看日志
```

## 2. 健康检查

```bash
curl -H "Authorization: Bearer <API_TOKEN>" http://localhost:8000/api/health
# {"ok":true,"dsh":"dsh","version":"0.1.0","dryRun":false}
```

CI/监控可轮询此端点；`dryRun: true` 表示处于测试模式（无 dsh）。

## 3. 审计与数据

```text
data/
├── tasks/        # 每个任务的完整日志（taskId.log）——审计依据
├── logs/         # 实验运行日志（run_experiment 全量落盘）
├── results/      # 结构化结果（double-review、任务 JSON）
├── papers/       # 文献调研下载的 PDF
├── scripts/      # 实验脚本白名单（只能跑这里的脚本）
└── ledger.json   # 资源预算账本（实验数/时长，跨天滚动）
```

**备份**：至少备份 `data/results/` 与 `data/ledger.json`；任务日志按保留策略归档。

## 4. 成本控制

- **token 预算**：`evals/manifest.json` 每个 case 的 `budget.maxInputTokens` 是评测门禁；
- **实验预算**：`plugin/src/resource.ts` 的 `DEFAULT_LIMITS`（实验数/天、时长/天、磁盘、GPU）——修改后需过评测；
- **告警**：冒烟/评测在 CI 中跑，失败即告警；`data/ledger.json` 接近上限时日志会提示。

## 5. 升级流程（防"悄悄变笨"）

```bash
# 1. 拉新代码
git pull
# 2. 本地/CI 全量验证（门禁全绿才继续）
make test && make smoke
# 3. 评测门禁（模型/预设/提示词改动必须跑）
DEEPSEEK_API_KEY=xxx make eval     # 通过率 >= 90%
# 4. 重新构建与发布
make build && cd deploy && docker compose up -d --build
# 5. 灰度：先只让部分任务走新版本，对比检出率后再全量
```

## 6. 排障速查

| 症状 | 排查 |
|---|---|
| 任务一直 running | `data/tasks/<id>.log` 看是否卡在工具调用；检查 dsh 进程是否存活 |
| 评测不过 | 先看是哪个 case；用 `node evals/run-evals.mjs` 单跑并看 `data/results/` |
| 实验被拒 | `data/ledger.json` 是否触顶；脚本是否在白名单目录；GPU/磁盘剩余 |
| 前端白屏 | `frontend/dist` 是否最新（`make build`）；Nginx 反代配置；浏览器控制台 401 |
| API 401 | `API_TOKEN` 是否与前端 `VITE_API_TOKEN` 一致；WebSocket 需 `?token=` |

## 7. 安全清单（每月复查）

- [ ] `.env` 不入库、权限 600；API key 轮换
- [ ] 凭据目录（.ssh/.aws/.env）在 fs 策略中 deny
- [ ] 实验白名单脚本均经过 review（`git log data/scripts/`）
- [ ] 审计日志保留策略生效
- [ ] ledger 预算未被人为清零（防绕过熔断）
