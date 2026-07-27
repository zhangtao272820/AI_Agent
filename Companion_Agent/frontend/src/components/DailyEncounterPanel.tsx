import type { DailyEncounterEntry, DailyState } from "../types";

type Props = {
  dailyState: DailyState | null;
  encounters: DailyEncounterEntry[];
  disabled?: boolean;
  onPick: (encounterId: string) => void;
  onClose: () => void;
};

export default function DailyEncounterPanel({
  dailyState,
  encounters,
  disabled,
  onPick,
  onClose,
}: Props) {
  const ap = dailyState?.action_points ?? 0;
  const apMax = dailyState?.action_points_max ?? 3;
  const done = new Set(dailyState?.encounters_done ?? []);

  return (
    <div className="gal-modal-backdrop" onClick={onClose} role="presentation">
      <div className="gal-modal gal-daily-panel" onClick={(e) => e.stopPropagation()}>
        <header className="gal-modal-head">
          <div>
            <h3>今日的偶遇</h3>
            <p className="gal-daily-ap">
              心力 <strong>{ap}</strong> / {apMax}
            </p>
          </div>
          <button type="button" className="gal-icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="muted gal-daily-hint">选一件想做的事。偶尔，路上会发生意想不到的事。</p>
        <div className="gal-daily-grid">
          {encounters.map((enc) => {
            const noAp = ap < enc.cost;
            return (
              <button
                key={enc.id}
                type="button"
                className={`gal-daily-card${done.has(enc.id) ? " gal-daily-card--done" : ""}`}
                disabled={disabled || noAp}
                onClick={() => onPick(enc.id)}
              >
                <span className="gal-daily-cost">-{enc.cost} AP</span>
                <strong>{enc.label}</strong>
                <span className="gal-daily-desc">{enc.description}</span>
                {done.has(enc.id) && <span className="gal-daily-done-tag">已进行</span>}
              </button>
            );
          })}
        </div>
        {encounters.length === 0 && <p className="muted">当前阶段暂无可用日常活动。</p>}
      </div>
    </div>
  );
}
