function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString();
}

function statusClass(status) {
  if (status === "healthy" || status === "online") return "online";
  if (status === "degraded" || status === "unknown") return "degraded";
  return "offline";
}

function summarizeAgentMetrics(data) {
  if (!data || typeof data !== "object") return "—";
  if (Array.isArray(data.counters)) {
    const top = data.counters.slice(0, 3).map((c) => `${c.name || c.key}: ${c.value ?? c.count ?? "?"}`);
    return top.join(" · ") || "counters";
  }
  const keys = Object.keys(data).slice(0, 4);
  if (!keys.length) return "—";
  return keys.map((k) => `${k}`).join(", ");
}

export default function ManagerObservability({ data, loading, onRefresh }) {
  const mgr = data?.manager || {};
  const token = mgr.token_summary || {};
  const phases = Object.entries(mgr.phases || {})
    .sort((a, b) => (b[1]?.avgMs || 0) - (a[1]?.avgMs || 0))
    .slice(0, 12);
  const tokenByPhase = Object.entries(token.byPhase || {}).sort((a, b) => b[1] - a[1]);
  const byAgent = Object.entries(mgr.by_agent_success || {}).sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0));
  const recent = Array.isArray(mgr.recent_metrics) ? mgr.recent_metrics : [];
  const evo = mgr.evolution || {};
  const healthAgents = data?.agents_health || [];
  const metricsAgents = data?.agents_metrics || [];

  return (
    <div className="obs-page">
      <div className="obs-toolbar">
        <p className="card-lead">
          对接 Manager <code>/api/metrics</code> 与 Prometheus；子 Agent 并行拉取 <code>/api/metrics</code>。
          Token 分 phase 汇总（P4 台账，见升级.md §8）。
        </p>
        <button type="button" className="btn-secondary" disabled={loading} onClick={onRefresh}>
          {loading ? "刷新中…" : "立即刷新"}
        </button>
      </div>

      <div className="kpi-grid kpi-grid--6">
        <div className="kpi-tile">
          <span className="kpi-label">平台状态</span>
          <span className={`status ${statusClass(data?.overall_status)}`}>{data?.overall_status || "—"}</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Manager</span>
          <span className={`status ${mgr.reachable ? "online" : "offline"}`}>
            {mgr.reachable ? "可达" : "不可达"}
          </span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">编排 Run 数</span>
          <span className="kpi-value">{fmtNum(mgr.runs)}</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Token（窗口内）</span>
          <span className="kpi-value">{fmtNum(token.totalTokens)}</span>
          <span className="kpi-meta">USD ≈ {token.totalUsd != null ? token.totalUsd : "—"}</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">首遍成功率</span>
          <span className="kpi-value">
            {evo.firstPassSuccessRate != null ? `${(evo.firstPassSuccessRate * 100).toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">经验回放使用率</span>
          <span className="kpi-value">
            {evo.experienceReplayUsageRate != null ? `${(evo.experienceReplayUsageRate * 100).toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>

      <div className="obs-grid">
        <section className="card">
          <h2>总管阶段耗时</h2>
          {!phases.length ? <p className="muted">暂无 phase 数据（需 Manager 产生编排 run）</p> : null}
          <div className="phase-bars">
            {phases.map(([name, v]) => (
              <div className="phase-bar" key={name}>
                <span className="phase-bar__label">{name}</span>
                <div className="phase-bar__track">
                  <div className="phase-bar__fill" style={{ width: `${Math.min(100, (v.avgMs || 0) / 120)}%` }} />
                </div>
                <span className="phase-bar__val">
                  {v.avgMs}ms · {v.count}次
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Token 按阶段</h2>
          {!tokenByPhase.length ? (
            <p className="muted">暂无 token 埋点（LLM 调用会写入 manager-metrics.jsonl）</p>
          ) : (
            <div className="data-table">
              <div className="data-table__head">
                <span>阶段</span>
                <span>Tokens</span>
              </div>
              {tokenByPhase.map(([phase, n]) => (
                <div className="data-table__row" key={phase}>
                  <span>{phase}</span>
                  <span className="mono">{fmtNum(n)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card card--wide">
          <h2>子 Agent 路径成功率（Manager 经验统计）</h2>
          {!byAgent.length ? <p className="muted">暂无 byAgent 统计</p> : null}
          <div className="data-table">
            <div className="data-table__head data-table__head--3">
              <span>Agent / 路径</span>
              <span>样本</span>
              <span>平均成功率</span>
            </div>
            {byAgent.map(([name, v]) => (
              <div className="data-table__row data-table__row--3" key={name}>
                <span>{name}</span>
                <span>{v.count}</span>
                <span>{v.avgSuccess != null ? `${(v.avgSuccess * 100).toFixed(1)}%` : "—"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card card--wide">
          <h2>子 Agent 探活 + 指标快照</h2>
          <div className="agent-metrics-grid">
            {healthAgents.map((h) => {
              const snap = metricsAgents.find((a) => a.name === h.name);
              return (
                <div className={`agent-metric-card ${statusClass(h.status)}`} key={h.name}>
                  <div className="agent-metric-card__head">
                    <strong>{h.name}</strong>
                    <span className={`status ${statusClass(h.status)}`}>{h.status}</span>
                  </div>
                  <p className="muted">{h.latency_ms}ms · {h.probe_path || h.target}</p>
                  {snap?.ok ? (
                    <p className="agent-metric-card__meta">{summarizeAgentMetrics(snap.metrics)}</p>
                  ) : (
                    <p className="agent-metric-card__meta muted">
                      {snap?.error || h.status !== "healthy" ? "指标不可用" : "—"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card card--wide">
          <h2>总管调用流水（最近埋点）</h2>
          <div className="data-table data-table--scroll">
            <div className="data-table__head data-table__head--5">
              <span>时间</span>
              <span>Run</span>
              <span>阶段</span>
              <span>耗时</span>
              <span>Token</span>
            </div>
            {recent.length === 0 ? (
              <p className="muted" style={{ padding: "12px" }}>
                暂无流水；提交任务经 Manager 编排后会出现
              </p>
            ) : (
              recent.slice(0, 40).map((r, i) => (
                <div className="data-table__row data-table__row--5" key={`${r.ts}-${r.phase}-${i}`}>
                  <span className="muted">{r.ts ? new Date(r.ts).toLocaleTimeString() : "—"}</span>
                  <span className="mono truncate">{r.runId ? String(r.runId).slice(0, 8) : "—"}</span>
                  <span>{r.phase}</span>
                  <span>{r.ms != null ? `${r.ms}ms` : "—"}</span>
                  <span>{r.tokens != null ? fmtNum(r.tokens) : "—"}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
