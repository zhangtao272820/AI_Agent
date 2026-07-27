import FaceChip from "./FaceChip";
import type { HubAppointment, WorldLocation } from "../types";

const LOC_BG: Record<string, string> = {
  home: "home.png",
  cafe: "cafe.png",
  office: "office.png",
  store: "store.png",
  campus: "campus.png",
  school: "campus.png",
  library: "library.png",
  park: "starry.png",
  forest: "forest.png",
  room: "room.png",
  street: "rain.png",
};

type Props = {
  locations: WorldLocation[];
  currentId: string;
  actionPoints: number;
  recommendedIds?: Set<string>;
  gate?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPick: (locationId: string) => void;
  onClose?: () => void;
  /** embedded = Hub 主舞台；overlay = 浮层 */
  variant?: "embedded" | "overlay";
  /** 今日赴约地点气泡 */
  appointments?: HubAppointment[];
};

export default function TownMapPicker({
  locations,
  currentId,
  actionPoints,
  recommendedIds,
  gate,
  busy,
  disabled,
  onPick,
  onClose,
  variant = "embedded",
  appointments = [],
}: Props) {
  const dueLocIds = new Set(
    appointments.filter((a) => a.due_today && a.location_id).map((a) => a.location_id as string),
  );

  const body = (
    <>
      <header className="gal-town-map-head">
        <div>
          <h2>小镇地图</h2>
          <p className="muted">点地点前往 · 立绘头像表示谁在那里</p>
        </div>
        {onClose ? (
          <button type="button" className="gal-nav-btn" onClick={onClose}>
            关闭
          </button>
        ) : null}
      </header>
      <div className="gal-town-map-grid">
        {locations.map((loc) => {
          const here = loc.id === currentId;
          const faces = loc.present || [];
          const count = typeof loc.present_count === "number" ? loc.present_count : faces.length;
          const rec = !!recommendedIds?.has(loc.id);
          const dimmed = !!gate && !!recommendedIds && recommendedIds.size > 0 && !rec && !here;
          const cost = loc.travel_cost ?? 1;
          const tooPoor = !here && cost > actionPoints;
          const bg = LOC_BG[loc.id] || "campus.png";
          const hasDue = dueLocIds.has(loc.id);
          return (
            <button
              key={loc.id}
              type="button"
              className={`gal-map-pin${here ? " gal-map-pin--here" : ""}${
                rec && gate ? " gal-map-pin--rec" : ""
              }${dimmed ? " gal-map-pin--dim" : ""}${hasDue ? " gal-map-pin--event" : ""}`}
              disabled={busy || disabled || tooPoor}
              onClick={() => onPick(loc.id)}
              aria-label={`${loc.label}${here ? "（当前位置）" : ""}${
                faces.length ? `，${faces.map((f) => f.name).join("、")}在这里` : ""
              }${hasDue ? "，今日有约" : ""}`}
            >
              <span
                className="gal-map-pin-art"
                style={{ backgroundImage: `url(/api/bgs/${bg})` }}
              />
              <span className="gal-map-pin-shade" />
              <span className="gal-map-pin-body">
                <strong className="gal-map-pin-label">{loc.label}</strong>
                <span className="gal-map-pin-meta">
                  {here ? "在这里" : `心力 ${cost}`}
                  {count > 0 ? ` · ${count}人` : ""}
                </span>
                <span className="gal-map-pin-faces">
                  {faces.length === 0 ? (
                    <em className="gal-map-pin-empty">暂无熟人</em>
                  ) : (
                    faces.slice(0, 4).map((f) => (
                      <FaceChip
                        key={f.character_id}
                        characterId={f.character_id}
                        name={f.name}
                        themeColor={f.theme_color}
                        size="sm"
                      />
                    ))
                  )}
                  {count > 4 ? <em className="gal-map-pin-more">+{count - 4}</em> : null}
                </span>
              </span>
              {here ? <em className="gal-map-pin-here-badge">此刻</em> : null}
              {rec && gate ? <em className="gal-map-pin-rec-badge">推荐</em> : null}
              {hasDue ? <em className="gal-map-pin-event-badge">有约</em> : null}
              {count > 0 && !hasDue ? (
                <em className="gal-map-pin-presence-bubble" aria-hidden>
                  {count}
                </em>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );

  if (variant === "overlay") {
    return (
      <div className="gal-vn-overlay gal-town-map-overlay" role="dialog" aria-label="小镇地图">
        <div className="gal-vn-overlay-panel gal-town-map-panel" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }

  return <section className="gal-town-map" aria-label="小镇地图">{body}</section>;
}
