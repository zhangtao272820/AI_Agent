"""Allow `python -m desktop` from Companion_Agent when desktop is on sys.path."""

from __future__ import annotations

import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("launcher.py")), run_name="__main__")
