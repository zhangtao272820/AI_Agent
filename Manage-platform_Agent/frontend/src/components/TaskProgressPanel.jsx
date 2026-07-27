const TASK_STEPS = [
  { id: "queued", label: "排队" },
  { id: "running", label: "执行中" },
  { id: "done", label: "完成" },
];

function stepIndex(status) {
  if (status === "queued") return 0;
  if (status === "running") return 1;
  if (status === "success" || status === "failed" || status === "dead") return 2;
  return 0;
}

function statusLabel(status) {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "dead") return "死信";
  if (status === "running") return "执行中";
  return "排队中";
}

function formatMs(ms) {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function phaseLabel(item) {
  if (!item) return "—";
  return String(item.agent || item.phase || "unknown");
}

export default function TaskProgressPanel({
  taskId,
  status,
  startedAt,
  events,
  summary,
  error,
  phaseTimeline,
  tokenSummary,
  wallClockMs,
}) {
  if (!taskId) return null;

  const idx = stepIndex(status);
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const pct = status === "success" || status === "failed" || status === "dead" ? 100 : idx === 1 ? 55 : 12;
  const isFail = status === "failed" || status === "dead";

  const taskEvents = (events || []).filter(
    (e) =>
      e?.payload?.task_id === taskId ||
      e?.event_type?.startsWith("task.")
  );

  const finishedEvt = taskEvents.find((e) => e.event_type === "task.finished");
  const timeline =
    phaseTimeline?.length > 0
      ? phaseTimeline
      : finishedEvt?.payload?.phase_timeline || [];
  const tokens = tokenSummary || finishedEvt?.payload?.token_summary || null;
  const wallMs =
    wallClockMs ||
    finishedEvt?.payload?.wall_clock_ms ||
    timeline.reduce((sum, item) => sum + (Number(item?.ms) || 0), 0);
  const maxPhaseMs = Math.max(1, ...timeline.map((x) => Number(x?.ms) || 0));
  const tokenByAgent = tokens?.byAgent || tokens?.by_agent || {};
  const tokenEntries = Object.entries(tokenByAgent).sort((a, b) => b[1] - a[1]);

  return (
    <div className="task-progress">
      <div className="task-progress__head">
        <strong>任务进度</strong>
        <span className="muted">ID: {taskId.slice(0, 8)}…</span>
        <span className={`status ${isFail ? "offline" : status === "success" ? "online" : ""}`}>
          {statusLabel(status)}
        </span>
        <span className="muted">耗时 {formatMs(elapsed)}</span>
      </div>

      <div className="task-progress__bar" aria-hidden>
        <div
          className={`task-progress__fill ${isFail ? "task-progress__fill--fail" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="task-progress__steps">
        {TASK_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={`task-progress__step ${i < idx ? "task-progress__step--done" : ""} ${i === idx ? "task-progress__step--active" : ""} ${i === 2 && isFail ? "task-progress__step--fail" : ""}`}
          >
            <span className="task-progress__dot" />
            {s.label}
          </li>
        ))}
      </ol>

      {timeline.length > 0 ? (
        <div className="task-progress__phases">
          <div className="task-progress__phases-head">
            <strong>编排 Phase 耗时</strong>
            {wallMs ? <span className="muted">合计 {formatMs(wallMs)}</span> : null}
          </div>
          <ul className="task-progress__phase-list">
            {timeline.map((item, i) => (
              <li key={`${phaseLabel(item)}-${i}`} className="task-progress__phase-row">
                <div className="task-progress__phase-meta">
                  <span>{phaseLabel(item)}</span>
                  <span>{formatMs(Number(item?.ms) || 0)}</span>
                </div>
                <div className="task-progress__phase-bar">
                  <div
                    className="task-progress__phase-fill"
                    style={{
                      width: `${Math.max(4, Math.round(((Number(item?.ms) || 0) / maxPhaseMs) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tokenEntries.length > 0 ? (
        <div className="task-progress__tokens">
          <div className="task-progress__phases-head">
            <strong>Token 分桶</strong>
            {tokens?.totalTokens ? <span className="muted">共 {tokens.totalTokens}</span> : null}
          </div>
          <ul className="task-progress__token-list">
            {tokenEntries.map(([agent, count]) => (
              <li key={agent}>
                <span>{agent}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary ? <p className="task-progress__summary">{summary}</p> : null}
      {error ? <p className="task-progress__error">{error}</p> : null}

      {taskEvents.length > 0 ? (
        <details className="task-progress__log">
          <summary>事件流水 ({taskEvents.length})</summary>
          <ul>
            {taskEvents.slice(0, 12).map((e, i) => (
              <li key={`${e.event_type}-${i}`}>
                <code>{e.event_type}</code>
                {e.payload?.status ? ` → ${e.payload.status}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
