import type {
  CharacterProfile,
  EndingInfo,
  EventLogEntry,
  GameEventInfo,
  MemoryFact,
  RelationshipState,
} from "../types";

type Props = {
  profile: CharacterProfile;
  relationshipState: RelationshipState | null;
  memories: MemoryFact[];
  stageNotice: string;
  eventLog: EventLogEntry[];
  activeEvent: GameEventInfo | null;
  onBackToMenu: () => void;
};

function stageCapLabel(state: RelationshipState | null): string {
  if (!state?.max_stage_id) return "";
  const map: Record<string, string> = {
    dating: "最高：女朋友",
    married: "最高：妻子",
    close_friend: "最高：知己",
  };
  return map[state.max_stage_id] || `封顶：${state.max_stage_id}`;
}

export default function GameHud({
  profile,
  relationshipState,
  memories,
  stageNotice,
  eventLog,
  activeEvent,
  onBackToMenu,
}: Props) {
  const rs = relationshipState;
  return (
    <div className="session-bar game-hud">
      <div className="session-bar-main">
        <div className="game-hud-head">
          <div>
            <strong>{profile.name}</strong>
            <span className="muted">
              {" "}
              · {rs?.route_label || profile.relationship}
              {rs?.stage_label ? ` · ${rs.stage_label}` : ""}
              {rs?.user_title ? ` · 称呼「${rs.user_title}」` : ""}
            </span>
          </div>
          {rs && (
            <span className="game-hud-cap tag">{stageCapLabel(rs)}</span>
          )}
        </div>
        {rs && (
          <div className="stat-bars">
            <div className="affinity-row">
              <span className="affinity-label">好感 {rs.affinity}/100</span>
              <div className="affinity-bar">
                <div className="affinity-fill affinity-fill--pink" style={{ width: `${rs.affinity}%` }} />
              </div>
            </div>
            <div className="affinity-row">
              <span className="affinity-label">信任 {rs.trust ?? 70}/100</span>
              <div className="affinity-bar">
                <div className="affinity-fill affinity-fill--blue" style={{ width: `${rs.trust ?? 70}%` }} />
              </div>
            </div>
          </div>
        )}
        {stageNotice && <p className="stage-notice">{stageNotice}</p>}
        {activeEvent && (
          <p className="active-event-hint">
            进行中：<strong>{activeEvent.label}</strong>
          </p>
        )}
        {eventLog.length > 0 && (
          <div className="event-log-strip">
            <span className="memory-label">事件</span>
            {eventLog.slice(-4).map((e) => (
              <span key={`${e.event_id}-${e.turn}`} className="memory-chip event-chip">
                {e.label}
              </span>
            ))}
          </div>
        )}
        {memories.length > 0 && (
          <div className="memory-strip">
            <span className="memory-label">记忆</span>
            {memories.slice(-4).map((m) => (
              <span key={m.text} className="memory-chip">
                {m.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="btn-ghost" onClick={onBackToMenu}>
        重新设定
      </button>
    </div>
  );
}

export type { EndingInfo };
