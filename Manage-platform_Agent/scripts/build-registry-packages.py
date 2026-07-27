#!/usr/bin/env python3
"""将 skills-starter 打成 remote-demo Registry 可用的 zip 包，并回写 index.json 的 sha256。"""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIR = SCRIPT_DIR.parent
STARTER = PLATFORM_DIR / "skills-starter"
REMOTE_DIR = PLATFORM_DIR / "skills-catalog" / "remote-demo"
PACKAGES_DIR = REMOTE_DIR / "packages"
INDEX_FILE = REMOTE_DIR / "index.json"

SKILLS = [
    ("text.word_count", "文本词数统计", "统计文本的词数、字符数、行数等基础指标"),
    ("text.case_transform", "文本大小写转换", "对文本进行大小写转换"),
    ("data.pick_fields", "字段选取", "从对象中按路径选取字段"),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def zip_skill(skill_id: str) -> Path:
    src = STARTER / skill_id
    if not src.is_dir():
        raise FileNotFoundError(src)
    out_dir = PACKAGES_DIR / skill_id / "1.0.0"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_zip = out_dir / "package.zip"
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in src.rglob("*"):
            if file.is_file():
                zf.write(file, file.relative_to(src).as_posix())
    return out_zip


def main() -> None:
    REMOTE_DIR.mkdir(parents=True, exist_ok=True)
    entries = []
    for skill_id, name, desc in SKILLS:
        z = zip_skill(skill_id)
        digest = sha256_file(z)
        rel = z.relative_to(PLATFORM_DIR).as_posix()
        entries.append(
            {
                "skill_id": skill_id,
                "name": name,
                "kind": "executable",
                "latest": "1.0.0",
                "versions": ["1.0.0"],
                "tags": ["starter", "remote-demo"],
                "compatible_agents": ["*"],
                "description": desc,
                "package_url": rel.replace("\\", "/"),
                "sha256": digest,
                "publisher": "platform",
                "status": "published",
            }
        )
        print(f"{skill_id}: {digest} -> {rel}")

    index = {
        "apiVersion": "clawhive/registry/v1",
        "registry_id": "remote_demo",
        "name": "远程演示技能市场（本地 zip 包）",
        "updated_at": "2026-06-12T00:00:00Z",
        "skills": entries,
    }
    INDEX_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {INDEX_FILE}")


if __name__ == "__main__":
    main()
