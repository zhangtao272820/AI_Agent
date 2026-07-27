"""Prepend imports to split tool modules."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "app/tools"

HEADERS = {
    "time_parse.py": '''from __future__ import annotations

import datetime
import re
from typing import Any, Dict

import dateparser
from dateparser.search import search_dates

from app.core.time_nlu import resolve_datetime_with_llm
from app.core.time_utils import local_now_aware, user_tz

''',
    "pending.py": '''from __future__ import annotations

import inspect
import json
from typing import Any

from app.db.database import PendingAction, SessionLocal
from app.core.time_utils import utc_now_naive
from app.tools.common import _audit, _tool_err, _tool_ok
from app.tools.time_parse import prepare_time_sensitive_tool_args

''',
    "contacts.py": '''from __future__ import annotations

from app.db.database import Contact, SessionLocal
from app.tools.common import CONTACT_NOT_FOUND, _EMAIL_RE, _tool_err, _tool_ok

''',
    "tasks.py": '''from __future__ import annotations

from app.core.time_utils import to_utc_naive, utc_naive_to_local_naive, utc_now_naive
from app.db.database import SessionLocal, Task
from app.tools.common import _tool_err, _tool_ok
from app.tools.time_parse import _resolve_stored_event_time

''',
    "calendar.py": '''from __future__ import annotations

from app.core.reminders import reminder_manager
from app.core.time_utils import (
    format_local_display,
    to_utc_naive,
    utc_naive_to_local_naive,
    utc_now_naive,
)
from app.db.database import Event, SessionLocal
from app.tools.common import _tool_err, _tool_ok
from app.tools.time_parse import _resolve_stored_event_time

''',
    "notes.py": '''from __future__ import annotations

from app.db.database import Note, SessionLocal
from app.tools.common import _tool_err, _tool_ok
from app.core.time_utils import utc_naive_to_local_naive

''',
    "email.py": '''from __future__ import annotations

import json
import re
import smtplib
import imaplib
from email import message_from_bytes
from email.header import Header, decode_header
from email.mime.text import MIMEText
from email.utils import parseaddr
from typing import Dict, List

from app.core.config import settings
from app.db.database import Contact, SessionLocal
from app.tools.common import (
    CONTACT_NOT_FOUND,
    _EMAIL_RE,
    _MAIL_CACHE_BY_SESSION,
    _tool_err,
    _tool_ok,
)

''',
    "search.py": '''from __future__ import annotations

''',
    "files.py": '''from __future__ import annotations

import os
import shutil

from app.core.config import settings
from app.tools.common import _tool_err, _tool_ok

''',
    "reminders.py": '''from __future__ import annotations

from app.core.reminders import reminder_manager
from app.core.time_utils import utc_naive_to_local_naive, utc_now_naive
from app.db.database import Event, SessionLocal
from app.tools.common import _tool_err, _tool_ok
from app.tools.time_parse import _naive_local, _resolve_stored_event_time

''',
    "memory_tools.py": '''from __future__ import annotations

from app.db.database import Memory, SessionLocal

''',
    "weather.py": '''from __future__ import annotations

import datetime
from typing import Any, Dict

import httpx

from app.core.config import settings
from app.core.user_preferences import learn_weather_city
from app.core.time_utils import utc_naive_to_local_naive, utc_now_naive
from app.tools.common import _HTTP_TIMEOUT, _WEATHER_CACHE, _WEATHER_LAST_CALL_AT

''',
}

for fname, header in HEADERS.items():
    path = ROOT / fname
    body = path.read_text(encoding="utf-8")
    # strip section comment headers
    body = body.replace("# --- Contact Skills ---\n", "")
    body = body.replace("# --- Task Skills ---\n", "")
    body = body.replace("# --- Calendar Skills ---\n", "")
    body = body.replace("# --- Notes ---\n", "")
    body = body.replace("# --- Mail Skills ---\n", "")
    body = body.replace("# --- Search Skills (Mock) ---\n", "")
    body = body.replace("# --- File Skills ---\n", "")
    body = body.replace("# --- Reminder Skills ---\n", "")
    body = body.replace("# --- Memory Skills ---\n", "")
    if fname == "pending.py":
        body = body.replace("AVAILABLE_TOOLS.get", "_get_available_tools().get")
        body = body.replace("tool_name not in AVAILABLE_TOOLS", "tool_name not in _get_available_tools()")
        body = body.replace(
            "result = AVAILABLE_TOOLS[tool_name]",
            "result = _get_available_tools()[tool_name]",
        )
        body = body + "\n\ndef _get_available_tools():\n    from app.tools.registry import AVAILABLE_TOOLS\n    return AVAILABLE_TOOLS\n"
    path.write_text(header + body, encoding="utf-8")
    print("fixed", fname)
