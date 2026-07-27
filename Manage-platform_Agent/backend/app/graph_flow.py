from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from .config import get_settings
from .qwen_client import QwenClient

settings = get_settings()

class TaskState(TypedDict, total=False):
    task: str
    priority: str
    target_agent_id: str
    context: dict[str, Any]
    planner_output: str
    execution_output: str
    summary: str
    failed: bool


def build_graph(qwen: QwenClient):
    graph = StateGraph(TaskState)

    def planner_node(state: TaskState) -> TaskState:
        prompt = (
            "你是 ClawHive 平台调度规划器。"
            "请基于任务描述输出分步执行计划（最多 5 步）。"
        )
        planner_output = qwen.chat(prompt, state["task"], model=settings.qwen_planner_model)
        return {"planner_output": planner_output}

    def executor_node(state: TaskState) -> TaskState:
        target = state.get("target_agent_id", "auto")
        exec_prompt = (
            "你是多 Agent 执行协调器。"
            f"目标Agent: {target}。"
            "请根据规划结果给出执行建议和预期输出。"
        )
        execution_output = qwen.chat(
            exec_prompt,
            state.get("planner_output", state["task"]),
            model=settings.qwen_executor_model,
        )
        return {"execution_output": execution_output}

    def summarize_node(state: TaskState) -> TaskState:
        summary = "任务已由 ClawHive 管理平面完成规划与执行建议生成。"
        return {"summary": summary, "failed": False}

    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_node("summarize", summarize_node)

    graph.add_edge(START, "planner")
    graph.add_edge("planner", "executor")
    graph.add_edge("executor", "summarize")
    graph.add_edge("summarize", END)
    return graph.compile()
