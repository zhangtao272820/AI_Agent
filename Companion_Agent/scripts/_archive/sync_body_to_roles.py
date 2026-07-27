"""One-shot: inject body_id + body_summary into model_roles from body_catalog."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from body_catalog_lib import body_summary_soft, get_body_row, load_body_catalog  # noqa: E402


def main() -> None:
    catalog = load_body_catalog()
    roles_path = ROOT / "data" / "model_roles.json"
    roles = json.loads(roles_path.read_text(encoding="utf-8"))
    n = 0
    for base in roles.get("bases") or []:
        for row in base.get("characters") or []:
            cid = str(row.get("id") or "")
            prof = row.setdefault("profile", {})
            body = get_body_row(catalog, cid)
            if not body:
                continue
            prof["body_id"] = cid
            prof["body_summary"] = body_summary_soft(body)
            n += 1
    roles_path.write_text(json.dumps(roles, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated body_summary for {n} characters → {roles_path}")


if __name__ == "__main__":
    main()
