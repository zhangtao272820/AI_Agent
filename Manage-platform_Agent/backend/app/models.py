from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class AgentRegistration(BaseModel):
    agent_id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    category: str = "general"
    endpoint: str
    status: Literal["online", "offline", "degraded"] = "online"
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TaskRequest(BaseModel):
    task: str
    target_agent_id: str | None = None
    priority: Literal["low", "normal", "high", "critical"] = "normal"
    context: dict[str, Any] = Field(default_factory=dict)


class TaskResult(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid4()))
    status: Literal["queued", "running", "success", "failed", "dead"]
    summary: str
    planner_output: str | None = None
    execution_output: str | None = None
    cost_estimate_tokens: int = 0
    raw: dict[str, Any] = Field(default_factory=dict)


class PlatformEvent(BaseModel):
    event_type: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    payload: dict[str, Any] = Field(default_factory=dict)
