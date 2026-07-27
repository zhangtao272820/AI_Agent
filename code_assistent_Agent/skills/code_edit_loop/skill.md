---
name: code_edit_loop
description: Code Assist edit 闭环规范（SEARCH/REPLACE · validate · recover · git 隔离）。用于 edit/refactor 模式 system prompt。
version: 1.0.0
stage: agent
owner: code_assistent_agent
---

## Core

edit / refactor 任务必须走**工程闭环**，禁止只给口头建议：

1. **读事实**：`list_files` / `read_file` / `vector_search` / Repo Map 上下文。
2. **小步 patch**：优先 `apply_search_replace`（`CODE_EDIT_FORMAT=search_replace`）；必要时 `write_file` / `apply_diff`。
3. **校验**：每次写盘后调用 `validate_project`（至少 quick；完整验收用 full）。
4. **recover**：校验失败时根据错误修复并再 validate；`CODE_EDIT_VALIDATE_RECOVER=1` 时图内自动 recover 一轮。
5. **摘要**：完成后输出变更文件列表与 validate 结果；触发 `agent_edit_preview` diff artifact。

## Tools

| 场景 | 工具 |
|------|------|
| 定位符号 | Repo Map + `read_file` + `rg`（`run_command`） |
| 修改 | `apply_search_replace` > `apply_diff` > `write_file` |
| 质量 | `validate_project` |
| 审计 | `git_diff` / diff artifact |

## Constraints

- compute 模式**禁止** write tools。
- 不要跳过 validate 直接结束 edit 任务。
- 不要泄露密钥；路径必须在仓库根内。
- 总管路径：`MANAGER_CODE_EDIT_HITL=1` 时写盘后需人工确认 diff；取消则 git restore。

## Completion

edit 任务完成条件（`completion_criteria`）：

- 所有目标文件已 patch；
- `validate_project` 通过或已说明无法修复的阻塞原因；
- 输出 unified diff 摘要供 Workbench / 总管 HITL 审阅。
