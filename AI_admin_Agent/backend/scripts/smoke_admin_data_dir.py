"""Smoke: admin persistent data dir."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def test_admin_data_dir():
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "data"
        os.environ["ADMIN_DATA_DIR"] = str(data)

        from app.core.admin_data_dir import admin_data_dir, admin_sqlite_path, migrate_legacy_admin_data

        assert admin_data_dir() == data
        assert admin_sqlite_path() == data / "agent_data.db"

        legacy_db = Path(__file__).resolve().parents[1] / "app" / "db"
        legacy_db.mkdir(parents=True, exist_ok=True)
        old = legacy_db / "agent_data.db"
        old.write_bytes(b"legacy-db-marker")
        try:
            if admin_sqlite_path().exists():
                admin_sqlite_path().unlink()
            migrate_legacy_admin_data()
            assert admin_sqlite_path().read_bytes() == b"legacy-db-marker"
        finally:
            if old.exists():
                old.unlink()


if __name__ == "__main__":
    test_admin_data_dir()
    print("smoke-admin-data-dir: OK")
