# 内部免费技能市场

> **Registry ID**：`internal_market`  
> **费用**：免费（`license: free`），仅供本集群 / 内网 ClawHive 使用。  
> **无需**配置 `SKILL_REGISTRY_URLS`，平台启动后自动注册。

## 内容来源

| 来源 | 路径 | 类型 |
|------|------|------|
| 各 Agent Playbook | `*/skills/*/skill.md` | playbook |
| 平台 Starter | `Manage-platform_Agent/skills-starter/*` | executable |

当前约 **18 个 Playbook + 3 个 Starter**（随 Skill 化计划增长）。

## 控制台使用

1. 登录 ClawHive → **技能中心 → 公共市场**
2. **Registry 源** 选择 **「内部免费市场（全集群）」**
3. 按 Agent / 类型筛选 → 选择 **赋能目标 Agent** → **赋能到 Agent**

## 更新目录（新增 skill.md 后）

在 `Manage-platform_Agent` 目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-internal-market.ps1
```

或：

```bash
python scripts/sync-internal-market.py
```

可选打 zip 包（离线分发）：

```bash
python scripts/sync-internal-market.py --zip
```

然后 **重建并重启** `clawhive_backend`（或等待 Registry 缓存 TTL 过期，默认 5 分钟）。

## 文件结构

```text
skills-catalog/internal-market/
├── README.md           # 本说明
├── index.json          # Registry 目录（由脚本生成）
└── packages/           # --zip 时生成的 package.zip
```

## 与「内置市场」区别

| 市场 | registry_id | 说明 |
|------|-------------|------|
| 内置市场 | `builtin` | 手工精选的 8 条种子 |
| **内部免费市场** | `internal_market` | **自动扫描全集群**，推荐日常使用 |
| 远程演示 | `remote_demo` | zip 包下载演示 |

## 对外共享（可选）

若需给其他 ClawHive 实例使用同一市场：

1. 将本目录 push 到内网 Git
2. 对方配置：`SKILL_REGISTRY_URLS=https://git.../raw/main/skills-catalog/internal-market/index.json`

仍免费；平台只做 index 拉取与 sha256 校验，无支付环节。
