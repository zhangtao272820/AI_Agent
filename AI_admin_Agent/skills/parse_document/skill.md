---
name: parse_document
description: PDF/PPT 文档解析 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户要解析 PDF/PPT、提取目录摘要时：
1. 工作区文件：`parse_document(file_path=文件名)`（文件须在 workspace）。
2. 远程 URL：`parse_document(url=…)`（需 MinerU 配置）。
3. MinerU 未配置时，仅 .txt/.md 可本地读取；PDF 提示见 doc/MCP趣味八件套-分阶段接入.md。
4. **MCP/MinerU 侧车**：`MINERU_API_URL=http://mineru_api:8080`（fun-mcp profile）。

## Reply

给出目录结构感 + 摘要段落；说明解析来源（MinerU / 本地）。
