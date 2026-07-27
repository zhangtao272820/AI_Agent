---
name: arxiv
description: arXiv 论文检索 Playbook
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

当用户问论文、预印本、某方向最新研究时：
1. 调用 `search_arxiv(query=…)`，英文关键词通常效果更好。
2. 需要某篇全文时再 `fetch_url_content` 读 arXiv abstract 页。
3. 不要编造论文；无结果时如实说明。
4. **MCP fallback**：侧车 `mcp_arxiv__*` 可提供更丰富元数据。

## Reply

每篇：标题、作者、日期、一句话贡献；附 arXiv 链接。
