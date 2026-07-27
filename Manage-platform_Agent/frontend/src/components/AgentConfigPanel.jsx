import { useEffect, useMemo, useState } from "react";
import { fetchJsonSafe } from "../utils/api";
import CapabilityModelsPanel from "./CapabilityModelsPanel";

const emptyForm = {
  port: "",
  endpoint: "",
};

export default function AgentConfigPanel({ apiBase, token, role, onMessage }) {
  const [agents, setAgents] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const canEdit = role === "operator" || role === "admin";

  const syncByAgent = useMemo(() => {
    const map = {};
    for (const a of syncStatus?.agents || []) {
      map[a.agent_name] = a;
    }
    return map;
  }, [syncStatus]);

  const load = async () => {
    setLoading(true);
    const [cfgRes, syncRes] = await Promise.all([
      fetchJsonSafe(`${apiBase}/api/agents/config`, { headers: { Authorization: `Bearer ${token}` } }),
      fetchJsonSafe(`${apiBase}/api/agents/config/sync-status`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    setLoading(false);
    if (!cfgRes.ok) {
      onMessage?.(cfgRes.error || "加载 Agent 配置失败");
      return;
    }
    const rows = Array.isArray(cfgRes.data?.agents) ? cfgRes.data.agents : [];
    setAgents(rows);
    if (syncRes.ok) setSyncStatus(syncRes.data);
    if (!selected && rows.length) {
      setSelected(rows[0].agent_name || rows[0].name);
    }
  };

  useEffect(() => {
    if (token) void load();
  }, [token]);

  useEffect(() => {
    const row = agents.find((a) => (a.agent_name || a.name) === selected);
    if (!row) {
      setForm(emptyForm);
      return;
    }
    setForm({
      port: row.port || "",
      endpoint: row.endpoint || "",
    });
  }, [selected, agents]);

  const restartAgent = async (forceRecreate = false) => {
    if (!canEdit || !selected) return;
    setRestarting(true);
    const q = forceRecreate ? "?force_recreate=true" : "";
    const { ok, error } = await fetchJsonSafe(
      `${apiBase}/api/agents/${encodeURIComponent(selected)}/restart${q}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    );
    setRestarting(false);
    if (!ok) {
      onMessage?.(error || "Docker 重启失败");
      return;
    }
    onMessage?.(`已重启 Docker 服务：${selected}`);
  };

  const restartManagerStack = async () => {
    if (!canEdit) return;
    setRestarting(true);
    const { ok, error } = await fetchJsonSafe(`${apiBase}/api/agents/actions/restart-manager-stack`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setRestarting(false);
    if (!ok) {
      onMessage?.(error || "Manager 全家桶重启失败");
      return;
    }
    onMessage?.("已重启 Manager 协作链");
  };

  const save = async () => {
    if (!canEdit || !selected) return;
    setSaving(true);
    const { ok, data, error } = await fetchJsonSafe(`${apiBase}/api/agents/config/${encodeURIComponent(selected)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        port: form.port,
        endpoint: form.endpoint,
      }),
    });
    setSaving(false);
    if (!ok) {
      onMessage?.(error || "保存失败");
      return;
    }
    const agent = data?.agent;
    onMessage?.(
      agent?.requires_restart
        ? `已保存 ${selected}；端口/端点变更请重启容器`
        : `已保存 ${selected}`
    );
    await load();
  };

  const current = agents.find((a) => (a.agent_name || a.name) === selected);
  const currentSync = syncByAgent[selected];
  const summary = syncStatus?.summary;

  return (
    <div className="page-stack page-stack--fill config-page">
      <CapabilityModelsPanel apiBase={apiBase} token={token} role={role} onMessage={onMessage} />

      <div className="config-strip animate-in">
        {summary ? (
          <div className="config-stats config-stats--inline">
            <div className="config-stat">
              <span className="config-stat__label">Agent</span>
              <span className="config-stat__value">{summary.total}</span>
            </div>
            <div className="config-stat">
              <span className="config-stat__label">Sync</span>
              <span className="config-stat__value">{summary.runtime_sync_count}</span>
            </div>
            <div className={`config-stat ${summary.drift_count ? "config-stat--warn" : ""}`}>
              <span className="config-stat__label">漂移</span>
              <span className="config-stat__value">{summary.drift_count}</span>
            </div>
          </div>
        ) : null}

        <div className="config-strip__group config-strip__group--end">
          <button type="button" className="btn-secondary btn-sm" disabled={loading} onClick={load}>
            {loading ? "加载中…" : "刷新"}
          </button>
          {canEdit ? (
            <>
              <button type="button" className="btn-secondary btn-sm" disabled={restarting || !selected} onClick={() => restartAgent(false)}>
                {restarting ? "重启中…" : "重启 Agent"}
              </button>
              <button type="button" className="btn-secondary btn-sm" disabled={restarting || !selected} onClick={() => restartAgent(true)}>
                强制重建
              </button>
              <button type="button" className="btn-secondary btn-sm" disabled={restarting} onClick={restartManagerStack}>
                重启 Manager
              </button>
            </>
          ) : null}
        </div>
      </div>

      <details className="config-hierarchy-fold">
        <summary>配置层级说明 · SSOT 与 .env 职责</summary>
        <p className="config-hierarchy-fold__lead">
          模型由上方<strong>能力层 SSOT</strong>统一映射到各 Agent；密钥在 <code>.env.agents-lan</code>，各 Agent 专有项在各自{" "}
          <code>.env</code>。
        </p>
        <ol>
          <li>
            <strong>能力层模型</strong> — 全集群 T0–T6 / E0 物理模型（控制台唯一入口）
          </li>
          <li>
            <strong>.env.agents-lan</strong> — 集群密钥、Compose 端口、CLAWHIVE_INTERNAL_TOKEN
          </li>
          <li>
            <strong>agent_configs</strong> — 端口 / Endpoint（运行时 SSOT）
          </li>
          <li>
            <strong>各 Agent/.env</strong> — 仅 Agent 特有项；模型由能力层自动同步
          </li>
        </ol>
      </details>

      <div className="config-layout animate-in animate-in--delay">
        <div className="config-list">
          {agents.map((a) => {
            const name = a.agent_name || a.name;
            const st = syncByAgent[name];
            return (
              <button
                key={name}
                type="button"
                className={`config-list__item ${selected === name ? "config-list__item--active" : ""}`}
                onClick={() => setSelected(name)}
              >
                <strong>{name}</strong>
                <span>{a.category}</span>
                <small>
                  {a.port ? `:${a.port}` : "—"} · {a.endpoint || "—"}
                </small>
                <div className="config-list__badges">
                  {st?.runtime_sync ? <span className="config-badge config-badge--sync">SYNC</span> : null}
                  {st?.drift ? <span className="config-badge config-badge--drift">DRIFT</span> : null}
                  {!st?.runtime_sync ? <span className="config-badge config-badge--env">ENV</span> : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="config-editor">
          {!selected ? (
            <p className="muted">请选择左侧 Agent</p>
          ) : (
            <>
              <div className="config-editor__head">
                <div>
                  <h3>{selected}</h3>
                  <p className="config-editor__meta">
                    {current?.docker_service ? (
                      <>
                        Docker <code>{current.docker_service}</code>
                        {" · "}
                      </>
                    ) : null}
                    {currentSync?.env_file ? (
                      <>
                        Env <code>{currentSync.env_file}</code>
                        {current?.updated_at ? ` · 更新 ${current.updated_at.slice(0, 19)}` : ""}
                      </>
                    ) : null}
                  </p>
                </div>
                {currentSync?.runtime_sync ? (
                  <span className="config-badge config-badge--sync">Runtime Sync 已接入</span>
                ) : (
                  <span className="config-badge config-badge--env">仅 .env / 需重启</span>
                )}
              </div>

              <p className="config-drift-box config-drift-box--ok">
                模型由上方能力层统一配置；修改后点「保存并下发」，runtime sync 约 60s 内生效。
                {currentSync?.drift ? " 检测到 .env 模型与平台不一致，请在能力层面板重新下发。" : null}
              </p>

              <div className="config-form-grid">
                <label>
                  端口
                  <input value={form.port} disabled={!canEdit} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                </label>
                <label className="label--full">
                  Endpoint
                  <input
                    value={form.endpoint}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                  />
                </label>
              </div>

              <div className="config-editor__actions">
                {canEdit ? (
                  <button type="button" className="btn-primary" disabled={saving} onClick={save}>
                    {saving ? "保存中…" : "保存端口/端点"}
                  </button>
                ) : (
                  <p className="muted">当前角色只读；需 operator / admin</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
