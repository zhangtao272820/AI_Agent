import type { EventLogEntry } from "../types";

type Props = {
  eventLog: EventLogEntry[];
  onClose: () => void;
};

export default function EventLogModal({ eventLog, onClose }: Props) {
  return (
    <div className="gal-modal-backdrop" onClick={onClose} role="presentation">
      <div className="gal-modal gal-event-log" onClick={(e) => e.stopPropagation()}>
        <header className="gal-modal-head">
          <h3>事件记录</h3>
          <button type="button" className="gal-icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        {eventLog.length === 0 ? (
          <p className="muted">暂无事件，继续对话推进剧情吧。</p>
        ) : (
          <ul className="gal-event-log-list">
            {[...eventLog].reverse().map((e) => (
              <li key={`${e.event_id}-${e.turn}`}>
                <span className="gal-event-log-turn">#{e.turn}</span>
                <strong>{e.label}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
