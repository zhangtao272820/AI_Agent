/**
 * 单次查询 LLM 调用计数（观测 P0 目标 ≤2 次）。
 */
let callsThisRun = 0;

export function resetLlmCallCount() {
  callsThisRun = 0;
}

export function incrementLlmCallCount(n = 1) {
  callsThisRun += Math.max(0, n);
}

export function getLlmCallCount() {
  return callsThisRun;
}
