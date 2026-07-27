import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonSafe } from "../utils/api";

const CHART_AXIS = "#78716c";
const CHART_LEGEND = "#57534e";

const CHART_IDS = [
  "mgrrun",
  "mgrtok",
  "phase",
  "agenttok",
  "agentup",
  "agentlat",
  "agentsuccess",
  "mgrquality",
  "agentcounter",
  "api",
];

function lastPointValue(result) {
  const values = result?.[0]?.values || [];
  if (!values.length) return null;
  return Number(values[values.length - 1][1]);
}

function toSeries(result, seriesNameFn, extra = {}) {
  return (result || []).map((r) => {
    const name = seriesNameFn(r);
    const values = (r.values || []).map(([ts, v]) => [Number(ts) * 1000, Number(v)]);
    return { name, type: "line", showSymbol: false, smooth: true, data: values, ...extra };
  });
}

function barOption(categories, values, { horizontal = false, color = "#6366f1" } = {}) {
  if (!categories.length) {
    return {
      backgroundColor: "transparent",
      title: { text: "暂无数据", left: "center", top: "middle", textStyle: { color: CHART_AXIS, fontSize: 12 } },
    };
  }
  const base = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    grid: horizontal
      ? { left: 110, right: 20, top: 12, bottom: 20 }
      : { left: 45, right: 14, top: 18, bottom: 48 },
  };
  if (horizontal) {
    return {
      ...base,
      xAxis: { type: "value", axisLabel: { color: CHART_AXIS } },
      yAxis: { type: "category", data: categories, axisLabel: { color: CHART_AXIS, width: 100, overflow: "truncate" } },
      series: [{ type: "bar", data: values, itemStyle: { color }, barMaxWidth: 18 }],
    };
  }
  return {
    ...base,
    xAxis: { type: "category", data: categories, axisLabel: { color: CHART_AXIS, rotate: categories.length > 6 ? 30 : 0 } },
    yAxis: { type: "value", axisLabel: { color: CHART_AXIS } },
    series: [{ type: "bar", data: values, itemStyle: { color }, barMaxWidth: 28 }],
  };
}

function statusColor(status) {
  if (status === "healthy") return "#16a34a";
  if (status === "degraded") return "#ca8a04";
  return "#dc2626";
}

export default function MonitorChartsPanel({
  token,
  apiBase,
  onError,
  onAppendAlert,
  alerts,
  onAckAllAlerts,
  onClearAlerts,
  onAckAlert,
}) {
  const chartsRef = useRef({});
  const echartsRef = useRef(null);
  const [windowMin, setWindowMin] = useState(30);
  const [refreshSec, setRefreshSec] = useState(10);
  const [topN, setTopN] = useState(8);
  const [successThreshold, setSuccessThreshold] = useState(0.95);
  const [fullscreen, setFullscreen] = useState(false);
  const [alertBanner, setAlertBanner] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const promRange = useCallback(
    async (expr, minutes = windowMin, step = refreshSec) => {
      const end = Date.now() / 1000;
      const start = end - minutes * 60;
      const url = `${apiBase}/api/metrics/prom/query_range?expr=${encodeURIComponent(expr)}&start=${start}&end=${end}&step=${Math.max(5, step)}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.detail || "Prometheus 查询失败");
      return data?.data?.data?.result || [];
    },
    [apiBase, token, windowMin, refreshSec],
  );

  const fetchSnapshot = useCallback(async () => {
    const { ok, data, error } = await fetchJsonSafe(`${apiBase}/api/monitor/charts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!ok) throw new Error(error || "监控快照拉取失败");
    setSnapshot(data);
    return data;
  }, [apiBase, token]);

  const refreshCharts = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const snap = await fetchSnapshot();
      const step = Math.max(5, refreshSec);

      const [mgrRuns, mgrTokens, firstPass, avgConfidence, apiRes] = await Promise.all([
        promRange("manager_runs_total", windowMin, step).catch(() => []),
        promRange("manager_tokens_total", windowMin, step).catch(() => []),
        promRange("manager_first_pass_success_rate", windowMin, step).catch(() => []),
        promRange("manager_avg_final_confidence", windowMin, step).catch(() => []),
        promRange("sum(rate(clawhive_api_requests_total[5m]))", windowMin, step).catch(() => []),
      ]);

      chartsRef.current.mgrrun?.setOption({
        backgroundColor: "transparent",
        tooltip: { trigger: "axis" },
        grid: { left: 45, right: 14, top: 18, bottom: 28 },
        xAxis: { type: "time", axisLabel: { color: CHART_AXIS } },
        yAxis: { type: "value", axisLabel: { color: CHART_AXIS } },
        series: toSeries(mgrRuns, () => "编排 Run 数"),
      });

      chartsRef.current.mgrtok?.setOption({
        backgroundColor: "transparent",
        tooltip: { trigger: "axis" },
        grid: { left: 45, right: 14, top: 18, bottom: 28 },
        xAxis: { type: "time", axisLabel: { color: CHART_AXIS } },
        yAxis: { type: "value", axisLabel: { color: CHART_AXIS } },
        series: toSeries(mgrTokens, () => "Token 累计"),
      });

      const phases = Object.entries(snap?.manager?.phases || {})
        .sort((a, b) => (b[1]?.avgMs || 0) - (a[1]?.avgMs || 0))
        .slice(0, topN);
      chartsRef.current.phase?.setOption(
        barOption(
          phases.map(([k]) => k),
          phases.map(([, v]) => v?.avgMs || 0),
          { color: "#8b5cf6" },
        ),
      );

      const tokenByAgent = Object.entries(snap?.manager?.token_by_agent || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
      chartsRef.current.agenttok?.setOption(
        barOption(
          tokenByAgent.map(([k]) => k),
          tokenByAgent.map(([, v]) => v),
          { horizontal: true, color: "#0ea5e9" },
        ),
      );

      const agents = snap?.agents || [];
      chartsRef.current.agentup?.setOption(
        barOption(
          agents.map((a) => a.name),
          agents.map((a) => (a.status === "healthy" ? 1 : 0)),
          { color: "#16a34a" },
        ),
      );

      chartsRef.current.agentlat?.setOption(
        barOption(
          agents.map((a) => a.name),
          agents.map((a) => a.latency_ms || 0),
          { horizontal: true, color: "#f59e0b" },
        ),
      );

      const byAgentSuccess = Object.entries(snap?.manager?.by_agent_success || {})
        .sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0))
        .slice(0, topN);
      chartsRef.current.agentsuccess?.setOption(
        barOption(
          byAgentSuccess.map(([k]) => k),
          byAgentSuccess.map(([, v]) => Math.round((v?.avgSuccess || 0) * 1000) / 10),
          { color: "#10b981" },
        ),
      );

      chartsRef.current.mgrquality?.setOption({
        backgroundColor: "transparent",
        tooltip: { trigger: "axis" },
        legend: { textStyle: { color: CHART_LEGEND } },
        grid: { left: 45, right: 45, top: 26, bottom: 28 },
        xAxis: { type: "time", axisLabel: { color: CHART_AXIS } },
        yAxis: [
          { type: "value", min: 0, max: 1, axisLabel: { color: CHART_AXIS } },
          { type: "value", min: 0, max: 1, axisLabel: { color: CHART_AXIS } },
        ],
        series: [
          ...toSeries(firstPass, () => "首遍成功率", { yAxisIndex: 0 }),
          ...toSeries(avgConfidence, () => "NLU置信度", { yAxisIndex: 1 }),
        ],
      });

      const counterRows = [];
      for (const agent of agents) {
        const counters = agent.counters || {};
        const topCounter = Object.entries(counters).sort((a, b) => b[1] - a[1])[0];
        if (topCounter) counterRows.push({ name: agent.name, label: topCounter[0], value: topCounter[1] });
      }
      counterRows.sort((a, b) => b.value - a.value);
      const topCounters = counterRows.slice(0, topN);
      chartsRef.current.agentcounter?.setOption(
        barOption(
          topCounters.map((r) => `${r.name}:${r.label}`),
          topCounters.map((r) => r.value),
          { horizontal: true, color: "#64748b" },
        ),
      );

      chartsRef.current.api?.setOption({
        backgroundColor: "transparent",
        tooltip: { trigger: "axis" },
        grid: { left: 45, right: 14, top: 18, bottom: 28 },
        xAxis: { type: "time", axisLabel: { color: CHART_AXIS } },
        yAxis: { type: "value", axisLabel: { color: CHART_AXIS } },
        series: toSeries(apiRes, () => "平台 API req/s"),
      });

      const fpsNow = lastPointValue(firstPass);
      const summary = snap?.agents_summary || {};
      const offline = Number(summary.offline || 0);
      if (fpsNow != null && fpsNow < successThreshold) {
        const message = `告警：总管首遍成功率偏低（${(fpsNow * 100).toFixed(1)}%，阈值 ${(successThreshold * 100).toFixed(0)}%）`;
        setAlertBanner(message);
        await onAppendAlert?.({
          severity: "warning",
          source: "manager",
          message,
          fingerprint: "manager-first-pass",
        });
      } else if (offline > 0) {
        const message = `告警：${offline} 个子 Agent 离线或不可达`;
        setAlertBanner(message);
        await onAppendAlert?.({
          severity: "critical",
          source: "agents",
          message,
          fingerprint: `agents-offline-${offline}`,
        });
      } else {
        setAlertBanner("");
      }
    } catch (e) {
      onError?.(`监控刷新失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [
    token,
    windowMin,
    refreshSec,
    topN,
    successThreshold,
    promRange,
    fetchSnapshot,
    onError,
    onAppendAlert,
  ]);

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let timer = null;
    (async () => {
      if (!echartsRef.current) {
        const mod = await import("echarts");
        echartsRef.current = mod;
      }
      if (disposed) return;
      for (const id of CHART_IDS) {
        const el = document.getElementById(`echarts-${id}`);
        if (!el) continue;
        chartsRef.current[id] = echartsRef.current.init(el);
      }
      await refreshCharts();
      requestAnimationFrame(() => CHART_IDS.forEach((id) => chartsRef.current[id]?.resize?.()));
      timer = setInterval(refreshCharts, refreshSec * 1000);
    })();
    const onResize = () => CHART_IDS.forEach((id) => chartsRef.current[id]?.resize?.());
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("resize", onResize);
      CHART_IDS.forEach((id) => chartsRef.current[id]?.dispose?.());
      chartsRef.current = {};
    };
  }, [token, refreshSec, refreshCharts]);

  const summary = snapshot?.agents_summary;
  const evo = snapshot?.manager?.evolution;

  return (
    <div className={`page-stack page-stack--fill monitor-page ${fullscreen ? "monitor-page--fullscreen" : ""}`}>
      <section className="monitor-hub">
        <div className="monitor-hub__header">
          <div>
            <h2 className="monitor-hub__title">监控中心</h2>
            <p className="panel-desc">
              总管 Agent + 子 Agent · Prometheus 时序 + 实时快照
              {summary ? (
                <span className="monitor-hub__meta">
                  {" "}
                  · 子 Agent {summary.healthy}/{summary.total} 在线
                </span>
              ) : null}
            </p>
          </div>
          <div className="monitor-hub__controls">
            <select value={windowMin} onChange={(e) => setWindowMin(Number(e.target.value))}>
              <option value={15}>近 15 分钟</option>
              <option value={30}>近 30 分钟</option>
              <option value={60}>近 1 小时</option>
              <option value={180}>近 3 小时</option>
            </select>
            <select value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))}>
              <option value={5}>每 5 秒</option>
              <option value={10}>每 10 秒</option>
              <option value={30}>每 30 秒</option>
            </select>
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
              <option value={5}>Top 5</option>
              <option value={8}>Top 8</option>
              <option value={12}>Top 12</option>
            </select>
            <select value={successThreshold} onChange={(e) => setSuccessThreshold(Number(e.target.value))}>
              <option value={0.9}>首遍成功率 90%</option>
              <option value={0.95}>首遍成功率 95%</option>
              <option value={0.98}>首遍成功率 98%</option>
            </select>
            <button type="button" className="btn-secondary btn-sm" disabled={loading} onClick={refreshCharts}>
              {loading ? "刷新中…" : "立即刷新"}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setFullscreen((v) => !v)}>
              {fullscreen ? "退出全屏" : "全屏显示"}
            </button>
          </div>
        </div>

        <div className="kpi-grid kpi-grid--6 monitor-kpi-row">
          <div className="kpi-tile">
            <span className="kpi-label">总管 Run</span>
            <span className="kpi-value">{snapshot?.manager?.runs ?? "—"}</span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">总管 Token</span>
            <span className="kpi-value">
              {snapshot?.manager?.total_tokens != null ? Number(snapshot.manager.total_tokens).toLocaleString() : "—"}
            </span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">首遍成功率</span>
            <span className="kpi-value">
              {evo?.firstPassSuccessRate != null ? `${(evo.firstPassSuccessRate * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">NLU 样本</span>
            <span className="kpi-value">{evo?.nluSampleCount ?? "—"}</span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">子 Agent 在线</span>
            <span className="kpi-value">
              {summary ? `${summary.healthy}/${summary.total}` : "—"}
            </span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">平台状态</span>
            <span className={`status ${snapshot?.overall_status === "healthy" ? "online" : "degraded"}`}>
              {snapshot?.overall_status || "—"}
            </span>
          </div>
        </div>

        {alertBanner ? <p className="monitor-alert">{alertBanner}</p> : null}

        <div className="monitor-grid monitor-grid--agent">
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">总管 Run 数（Prometheus）</h3>
            <div id="echarts-mgrrun" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">总管 Token 累计</h3>
            <div id="echarts-mgrtok" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">总管阶段平均耗时（ms）</h3>
            <div id="echarts-phase" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">子 Agent Token 分布</h3>
            <div id="echarts-agenttok" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">子 Agent 在线状态</h3>
            <div id="echarts-agentup" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">子 Agent 探活延迟（ms）</h3>
            <div id="echarts-agentlat" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">子 Agent 路径成功率（%）</h3>
            <div id="echarts-agentsuccess" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">总管质量指标（首遍 / NLU）</h3>
            <div id="echarts-mgrquality" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">子 Agent 指标计数（Top）</h3>
            <div id="echarts-agentcounter" className="chart-host" />
          </div>
          <div className="monitor-panel">
            <h3 className="monitor-panel__title">平台 API 请求速率</h3>
            <div id="echarts-api" className="chart-host" />
          </div>
        </div>

        <div className="monitor-agent-table-wrap">
          <h3 className="monitor-panel__title">子 Agent 实时状态</h3>
          <div className="data-table">
            <div className="data-table__head data-table__head--5">
              <span>Agent</span>
              <span>状态</span>
              <span>延迟</span>
              <span>指标</span>
              <span>计数摘要</span>
            </div>
            {(snapshot?.agents || []).map((a) => (
              <div className="data-table__row data-table__row--5" key={a.name}>
                <span>{a.name}</span>
                <span>
                  <span className="status" style={{ color: statusColor(a.status) }}>
                    {a.status}
                  </span>
                </span>
                <span>{a.latency_ms != null ? `${a.latency_ms}ms` : "—"}</span>
                <span className={a.metrics_ok ? "online" : "muted"}>{a.metrics_ok ? "可用" : "不可用"}</span>
                <span className="muted truncate">
                  {Object.entries(a.counters || {})
                    .slice(0, 3)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ") || "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="monitor-alert-center">
          <div className="monitor-alert-center__head">
            <h3 className="monitor-panel__title">告警中心</h3>
            <div className="monitor-alert-center__actions">
              <button type="button" className="btn-secondary btn-sm" onClick={onAckAllAlerts}>
                全部确认
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={onClearAlerts}>
                清空
              </button>
            </div>
          </div>
          <div className="monitor-alert-list">
            {(alerts || []).length === 0 ? <p className="muted monitor-alert-list__empty">暂无告警</p> : null}
            {(alerts || []).map((a) => (
              <div className="monitor-alert-item" key={a.id}>
                <div>
                  <strong>
                    {a.severity.toUpperCase()} / {a.source}
                  </strong>
                  <p>{a.message}</p>
                  {a.notify_detail || (a.notify_status && a.notify_status !== "none") ? (
                    <p className="muted" title="外部通知">
                      通知：{a.notify_status || "—"}
                      {a.notify_detail ? ` · ${a.notify_detail}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="agent-actions">
                  <span className={`status ${a.acked ? "online" : "degraded"}`}>
                    {a.acked ? "acked" : "new"}
                    {a.notify_status && a.notify_status !== "none" ? ` · ${a.notify_status}` : ""}
                  </span>
                  {!a.acked ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => onAckAlert?.(a.id)}>
                      确认
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
