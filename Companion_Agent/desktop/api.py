"""pywebview JS bridge for display mode (fullscreen / windowed)."""

from __future__ import annotations

from typing import Any


class DesktopApi:
    """Exposed as window.pywebview.api in the frontend."""

    def __init__(self) -> None:
        self._window: Any = None

    def bind(self, window: Any) -> None:
        self._window = window

    def is_desktop(self) -> bool:
        return True

    def get_fullscreen(self) -> bool:
        w = self._window
        if w is None:
            return False
        return bool(getattr(w, "fullscreen", False))

    def set_fullscreen(self, enabled: bool) -> bool:
        """True = fullscreen, False = windowed (restore normal window)."""
        w = self._window
        if w is None:
            return False
        want = bool(enabled)
        now = bool(getattr(w, "fullscreen", False))
        if want == now:
            return now
        # pywebview: toggle_fullscreen flips current state
        try:
            w.toggle_fullscreen()
        except Exception:
            try:
                w.fullscreen = want
            except Exception:
                return now
        return bool(getattr(w, "fullscreen", want))

    def toggle_fullscreen(self) -> bool:
        return self.set_fullscreen(not self.get_fullscreen())
