/**
 * 路由后处理：仅将需后置的 Agent 移到队尾，保留路由模型给出的相对顺序。
 * （禁止按 Bandit/RL 分数重排，否则会打乱 rag→crawler→code 等流水线）
 */
export function applyDeprioritizePreserveOrder(
  agents: string[],
  shouldDeprioritize: (agent: string) => boolean
): string[] {
  if (!agents.length) return agents
  const ok: string[] = []
  const bad: string[] = []
  for (const a of agents) {
    if (shouldDeprioritize(a)) bad.push(a)
    else ok.push(a)
  }
  return [...ok, ...bad]
}
