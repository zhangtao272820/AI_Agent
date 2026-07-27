"""通讯录导入：vCard / CSV 解析（无额外依赖）。"""
from __future__ import annotations

import csv
import io
import re
from typing import Any

_EMAIL_COLS = frozenset({"email", "e-mail", "mail", "邮箱", "电子邮件"})
_NAME_COLS = frozenset({"name", "fn", "full name", "fullname", "姓名", "名字", "联系人"})


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", str(h or "").strip().lower())


def _pick_col(fieldnames: list[str] | None, candidates: frozenset[str]) -> str | None:
    if not fieldnames:
        return None
    for raw in fieldnames:
        if _norm_header(raw) in candidates:
            return raw
    return None


def parse_vcard_text(text: str) -> list[dict[str, str]]:
    contacts: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        upper = line.upper()
        if upper == "BEGIN:VCARD":
            current = {}
            continue
        if upper == "END:VCARD":
            name = (current.get("name") or "").strip()
            email = (current.get("email") or "").strip()
            if name and email:
                contacts.append(
                    {
                        "name": name,
                        "email": email,
                        "description": (current.get("description") or "").strip(),
                    }
                )
            current = {}
            continue
        if upper.startswith("FN:"):
            current["name"] = line.split(":", 1)[1].strip()
        elif upper.startswith("N:") and not current.get("name"):
            parts = line.split(":", 1)[1].split(";")
            family = (parts[0] or "").strip()
            given = (parts[1] if len(parts) > 1 else "").strip()
            current["name"] = f"{given} {family}".strip() or family
        elif upper.startswith("EMAIL"):
            current["email"] = line.split(":", 1)[1].strip()
        elif upper.startswith("NOTE:"):
            current["description"] = line.split(":", 1)[1].strip()
    return contacts


def parse_csv_text(text: str) -> list[dict[str, str]]:
    sample = str(text or "").lstrip("\ufeff")
    if not sample.strip():
        return []
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample[:4096], delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    reader = csv.DictReader(io.StringIO(sample), delimiter=delimiter)
    name_col = _pick_col(reader.fieldnames, _NAME_COLS)
    email_col = _pick_col(reader.fieldnames, _EMAIL_COLS)
    if not name_col or not email_col:
        raise ValueError("CSV 需包含姓名与邮箱列（如 name,email 或 姓名,邮箱）")
    out: list[dict[str, str]] = []
    for row in reader:
        name = str(row.get(name_col) or "").strip()
        email = str(row.get(email_col) or "").strip()
        if not name or not email:
            continue
        desc = ""
        for k, v in row.items():
            if k in (name_col, email_col):
                continue
            val = str(v or "").strip()
            if val:
                desc = f"{k}: {val}"
                break
        out.append({"name": name, "email": email, "description": desc})
    return out


def parse_contacts_file(text: str, fmt: str = "auto") -> list[dict[str, str]]:
    kind = str(fmt or "auto").strip().lower()
    body = str(text or "")
    if kind == "auto":
        head = body.lstrip()[:32].upper()
        if head.startswith("BEGIN:VCARD") or "BEGIN:VCARD" in body[:256].upper():
            kind = "vcard"
        else:
            kind = "csv"
    if kind in ("vcard", "vcf"):
        return parse_vcard_text(body)
    if kind == "csv":
        return parse_csv_text(body)
    raise ValueError(f"不支持的通讯录格式: {fmt}")


def summarize_import(rows: list[dict[str, Any]]) -> dict[str, int]:
    created = updated = skipped = failed = 0
    for row in rows:
        status = str(row.get("status") or "")
        if status == "created":
            created += 1
        elif status == "updated":
            updated += 1
        elif status == "skipped":
            skipped += 1
        else:
            failed += 1
    return {"created": created, "updated": updated, "skipped": skipped, "failed": failed}
