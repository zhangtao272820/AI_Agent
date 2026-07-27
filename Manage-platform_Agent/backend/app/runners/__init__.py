"""Agent lifecycle runners (local / compose / kubernetes)."""

from .factory import get_agent_runner

__all__ = ["get_agent_runner"]
