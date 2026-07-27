#!/usr/bin/env python3
"""将收敛 MODE 从 SSOT 同步到各 Agent .env 与 .env.agents-lan。"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR.parent
REPO_ROOT = PLATFORM_DIR.parent
SSOT_FILE = PLATFORM_DIR / ".env.convergence-modes"
SSOT_EXAMPLE = PLATFORM_DIR / ".env.convergence-modes.example"
AGENTS_LAN_ENV = PLATFORM_DIR / ".env.agents-lan"

AGENT_MODE_BINDINGS: dict[str, dict[str, list[str]]] = {
    "Manager_Agent": {
        "env_file": "Manager_Agent/.env",
        "keys": [
            "EVO_MODE",
            "ARTIFACT_FEEDBACK_MODE",
            "MANAGER_ROUTE_MODE",
            "MANAGER_PRO_MODE",
            "MANAGER_EVOLUTION_MODE",
            "MANAGER_WEB_SEARCH_MODE",
            "MANAGER_PLATFORM_MODE",
            "MANAGER_AUTH_MODE",
            "MANAGER_RUNTIME",
            "QWEN_ENABLE_THINKING",
            "MANAGER_INTENT_RAG_TOP_K",
        ],
    },
    "DB_Agent": {
        "env_file": "DB_Agent/.env",
        "keys": [
            "EVO_MODE",
            "ARTIFACT_FEEDBACK_MODE",
            "DB_AGENT_DOMAIN",
            "DB_AGENT_PROFILE",
            "DB_ROUTE_MODE",
            "DB_LEGACY_SHORTCUTS",
            "DB_NLU_MODE",
        ],
    },
    "RAG_Agent": {
        "env_file": "RAG_Agent/.env",
        "keys": ["EVO_MODE", "ARTIFACT_FEEDBACK_MODE", "RAG_CORPUS_TIER", "RAG_NLU_MODE"],
    },
    "code_assistent_Agent": {
        "env_file": "code_assistent_Agent/.env",
        "keys": ["EVO_MODE", "CODE_LEARNING_MODE"],
    },
    "Extractor_Agent": {
        "env_file": "Extractor_Agent/.env",
        "keys": ["EVO_MODE", "EXTRACTOR_MODE", "EXTRACTOR_LEARNING_MODE"],
    },
    "AI_admin_Agent": {
        "env_file": "AI_admin_Agent/backend/.env",
        "keys": [
            "EVO_MODE",
            "ARTIFACT_FEEDBACK_MODE",
            "ADMIN_EVOLUTION_MODE",
            "ADMIN_NLU_MODE",
            "ADMIN_MEMORY_MODE",
        ],
    },
}

AGENTS_LAN_MODE_KEYS = [
    "EVO_MODE",
    "ARTIFACT_FEEDBACK_MODE",
    "MANAGER_ROUTE_MODE",
    "MANAGER_PRO_MODE",
    "MANAGER_EVOLUTION_MODE",
    "MANAGER_WEB_SEARCH_MODE",
    "MANAGER_PLATFORM_MODE",
    "MANAGER_AUTH_MODE",
    "MANAGER_RUNTIME",
    "QWEN_ENABLE_THINKING",
    "DB_AGENT_PROFILE",
    "DB_ROUTE_MODE",
    "DB_LEGACY_SHORTCUTS",
    "DB_NLU_MODE",
    "RAG_CORPUS_TIER",
    "RAG_NLU_MODE",
    "EXTRACTOR_MODE",
    "EXTRACTOR_LEARNING_MODE",
    "CODE_LEARNING_MODE",
    "ADMIN_EVOLUTION_MODE",
    "ADMIN_NLU_MODE",
    "ADMIN_MEMORY_MODE",
]


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            out[key] = val
    return out


def _write_env_keys(path: Path, updates: dict[str, str], *, agent_name: str, dry_run: bool) -> dict[str, tuple[str, str]]:
    pending = dict(updates)
    lines: list[str] = []
    changed: dict[str, tuple[str, str]] = {}

    if path.is_file():
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = raw.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                lines.append(raw)
                continue
            key_part = stripped.split("=", 1)[0].strip().lstrip("export ").strip()
            if key_part in pending:
                old_val = stripped.split("=", 1)[1].strip().strip('"').strip("'")
                new_val = pending.pop(key_part)
                if old_val != new_val:
                    changed[key_part] = (old_val, new_val)
                lines.append(f"{key_part}={new_val}")
            else:
                lines.append(raw)
    else:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        lines.append(f"# synced convergence modes — {agent_name} ({ts})")

    for key, val in pending.items():
        changed[key] = ("", val)
        lines.append(f"{key}={val}")

    if not dry_run and (changed or not path.is_file()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return changed


def _norm(v: str) -> str:
    return re.sub(r"\s+", "", str(v or "").strip().lower())


def main() -> int:
    parser = argparse.ArgumentParser(description="同步收敛 MODE 到各 Agent .env")
    parser.add_argument("--workspace", default=str(REPO_ROOT))
    parser.add_argument("--ssot", default=str(SSOT_FILE))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--skip-agents-lan", action="store_true")
    parser.add_argument("--agents", default="", help="逗号分隔 Agent 名")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    ssot_path = Path(args.ssot).resolve()
    if not ssot_path.is_file():
        if SSOT_EXAMPLE.is_file():
            print(f"[warn] SSOT 不存在：{ssot_path}，使用 {SSOT_EXAMPLE}")
            ssot_path = SSOT_EXAMPLE
        else:
            print("[error] 找不到 SSOT", file=sys.stderr)
            return 1

    ssot = _parse_env_file(ssot_path)
    if not ssot:
        print("[error] SSOT 为空", file=sys.stderr)
        return 1

    agent_filter: set[str] | None = None
    if args.agents.strip():
        agent_filter = {a.strip() for a in args.agents.split(",") if a.strip()}

    print("── 收敛 MODE SSOT ──")
    for k in sorted(ssot.keys()):
        print(f"  {k}={ssot[k]}")
    print()

    if args.check:
        drift_count = 0
        for agent_name, spec in sorted(AGENT_MODE_BINDINGS.items()):
            if agent_filter and agent_name not in agent_filter:
                continue
            rel = spec["env_file"]
            path = workspace / rel
            env = _parse_env_file(path)
            drift: list[str] = []
            for key in spec["keys"]:
                exp = str(ssot.get(key) or "").strip()
                if not exp:
                    continue
                cur = str(env.get(key) or "").strip()
                if not cur or _norm(cur) != _norm(exp):
                    drift.append(f"{key}: {cur or '(missing)'} → {exp}")
            if drift:
                drift_count += 1
                print(f"[drift] {agent_name} ({rel})")
                for d in drift:
                    print(f"        {d}")
            elif path.is_file():
                print(f"[ok] {agent_name} ({rel})")
            else:
                print(f"[missing] {agent_name} ({rel})")
        print(f"\n检查完成：{drift_count} 个 Agent 存在 MODE 漂移")
        return 1 if drift_count else 0

    mode_label = "dry-run" if args.dry_run else "sync"
    print(f"模式：{mode_label}  |  workspace：{workspace}\n")
    total = 0

    for agent_name, spec in sorted(AGENT_MODE_BINDINGS.items()):
        if agent_filter and agent_name not in agent_filter:
            continue
        rel = spec["env_file"]
        path = workspace / rel
        updates = {k: ssot[k] for k in spec["keys"] if k in ssot and str(ssot[k]).strip()}
        if not updates:
            print(f"[skip] {agent_name}: 无键可写")
            continue
        changed = _write_env_keys(path, updates, agent_name=agent_name, dry_run=args.dry_run)
        if not changed and path.is_file():
            print(f"[ok] {agent_name} ({rel})")
        else:
            print(f"[{'new' if not path.is_file() else 'update'}] {agent_name} ({rel})")
            for key, (old, new) in sorted(changed.items()):
                print(f"         {key}: {old or '(新增)'} → {new}")
        total += len(changed)

    if not args.skip_agents_lan:
        lan_updates = {k: ssot[k] for k in AGENTS_LAN_MODE_KEYS if k in ssot and str(ssot[k]).strip()}
        if AGENTS_LAN_ENV.is_file() and lan_updates:
            changed = _write_env_keys(AGENTS_LAN_ENV, lan_updates, agent_name="agents-lan", dry_run=args.dry_run)
            if changed:
                print("\n[update] .env.agents-lan")
                for key, (old, new) in sorted(changed.items()):
                    print(f"         {key}: {old or '(新增)'} → {new}")
                total += len(changed)
            else:
                print("\n[ok] .env.agents-lan")
        elif not AGENTS_LAN_ENV.is_file():
            print("\n[skip] .env.agents-lan — 文件不存在")

    print(f"\n完成：{total} 处 MODE 键{'将被' if args.dry_run else '已'}更新")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
