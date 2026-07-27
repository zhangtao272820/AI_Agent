#!/usr/bin/env python3
"""Copy agent learning guides from docs/agents to each Agent folder."""
from __future__ import annotations

import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENTS_DIR = os.path.join(ROOT, "docs", "agents")
DEST_NAME = "\u5b66\u4e60\u6307\u5357.md"  # 学习指南.md

MAP = {
    "Manager_Agent.md": "Manager_Agent",
    "RAG_Agent.md": "RAG_Agent",
    "DB_Agent.md": "DB_Agent",
    "code_assistent_Agent.md": "code_assistent_Agent",
    "Extractor_Agent.md": "Extractor_Agent",
    "Lobster_Agent.md": "Lobster_Agent",
    "AI_admin_Agent.md": "AI_admin_Agent",
    "Multimodal_Agent.md": "Multimodal_Agent",
    "Music_Agent.md": "Music_Agent",
    "Video_Agent.md": "Video_Agent",
    "AI_Agent.md": "AI_Agent",
    "Companion_Agent.md": "Companion_Agent",
    "Tavern_Agent.md": "Tavern_Agent",
    "Manage-platform_Agent.md": "Manage-platform_Agent",
}

HEADER = (
    "> [← 项目 README](README.md) · "
    "[入门总览](../docs/Agent学习指南-入门版.md) · "
    "[进阶总览](../docs/Agent学习指南-进阶版.md) · "
    "[总索引](../docs/Agent学习指南.md) · "
    "[Star ⭐](https://gitee.com/assssshuhuhuh/agent/stargazers)\n"
)


def transform(content: str) -> str:
    parts = content.split("\n---\n", 1)
    if len(parts) != 2:
        raise ValueError("Expected --- separator after header")
    title_block, body = parts
    title_match = re.match(r"^(# .+\n\n)", title_block)
    if not title_match:
        raise ValueError("Expected markdown title")
    content = title_match.group(1) + HEADER + "\n---\n" + body

    content = re.sub(r"\]\(\.\./\.\./[^/]+/README\.md\)", "](README.md)", content)
    content = re.sub(
        r"\]\(\.\./\.\./AI_Agent/services/lipsync/README\.md\)",
        "](services/lipsync/README.md)",
        content,
    )
    content = re.sub(
        r"\]\(\.\./Agent升级评估与优先级\.md\)",
        "](../docs/Agent升级评估与优先级.md)",
        content,
    )
    content = re.sub(
        r"\]\(\.\./企业级能力层模型方案\.md\)",
        "](../docs/企业级能力层模型方案.md)",
        content,
    )
    return content


def main() -> None:
    if not os.path.isdir(AGENTS_DIR):
        raise SystemExit(f"Missing source directory: {AGENTS_DIR}")

    for src, folder in MAP.items():
        src_path = os.path.join(AGENTS_DIR, src)
        with open(src_path, encoding="utf-8") as f:
            content = transform(f.read())
        dest = os.path.join(ROOT, folder, DEST_NAME)
        with open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        print(f"Wrote {dest}")

    shutil.rmtree(AGENTS_DIR, ignore_errors=False)
    print(f"Removed {AGENTS_DIR}")


if __name__ == "__main__":
    main()
