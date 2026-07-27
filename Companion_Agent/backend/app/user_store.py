"""本地用户账号：登录 / 注册，存档按 user_id 隔离。"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT, user_db_dir

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\u4e00-\u9fff]{2,24}$")


def _db_path() -> Path:
    return user_db_dir() / "companion_save.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_users_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)"
        )
        conn.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120_000,
    )
    return digest.hex()


def validate_username(username: str) -> str | None:
    name = (username or "").strip()
    if not _USERNAME_RE.match(name):
        return "用户名需 2~24 位（字母、数字、下划线或中文）"
    return None


def validate_password(password: str) -> str | None:
    if not password or len(password) < 4 or len(password) > 64:
        return "密码需 4~64 位"
    return None


def register_user(username: str, password: str, display_name: str = "") -> dict[str, Any]:
    init_users_db()
    err = validate_username(username) or validate_password(password)
    if err:
        raise ValueError(err)
    name = username.strip()
    salt = secrets.token_hex(16)
    pwd_hash = _hash_password(password, salt)
    user_id = secrets.token_hex(8)
    display = (display_name or name).strip()[:32] or name
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO users (user_id, username, password_hash, salt, display_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, name, pwd_hash, salt, display, _now_iso()),
            )
            conn.commit()
    except sqlite3.IntegrityError as exc:
        raise ValueError("用户名已被占用") from exc
    return {"user_id": user_id, "username": name, "display_name": display}


def authenticate_user(username: str, password: str) -> dict[str, Any] | None:
    init_users_db()
    name = (username or "").strip()
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, username, password_hash, salt, display_name FROM users WHERE username = ? COLLATE NOCASE",
            (name,),
        ).fetchone()
    if not row:
        return None
    expected = row["password_hash"]
    actual = _hash_password(password, row["salt"])
    if not hmac.compare_digest(expected, actual):
        return None
    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
    }


def get_user(user_id: str) -> dict[str, Any] | None:
    init_users_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, username, display_name FROM users WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
    }
