"""One-off: split app/tools/skills.py into domain modules."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src_path = ROOT / "app/tools/skills.py"
lines = src_path.read_text(encoding="utf-8").splitlines(keepends=True)
base = ROOT / "app/tools"

sections = {
    "common.py": (1, 77),
    "time_parse.py": (79, 251),
    "pending.py": (254, 480),
    "weather.py": (731, 876),
    "contacts.py": (878, 980),
    "tasks.py": (981, 1129),
    "calendar.py": (1130, 1306),
    "notes.py": (1307, 1364),
    "email.py": (1365, 1604),
    "search.py": (1605, 1611),
    "files.py": (1612, 1717),
    "reminders.py": (1718, 1809),
    "memory_tools.py": (1810, 1826),
}

for fname, (start, end) in sections.items():
    chunk = "".join(lines[start - 1 : end])
    (base / fname).write_text(chunk, encoding="utf-8")
    print(f"wrote {fname} ({end - start + 1} lines)")

# time helpers between pending and weather (481-730)
chunk = "".join(lines[480:730])
(base / "time_parse_extra.py").write_text(chunk, encoding="utf-8")
print("wrote time_parse_extra.py")
