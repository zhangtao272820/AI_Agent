import { FaceChip } from "./FaceChip";
import type { LocationInfo } from "../types";

/** 校园平面布局：百分比坐标（左上为原点） */
const MAP_LAYOUT: Record<string, { x: number; y: number; zone?: string }> = {
  rooftop: { x: 48, y: 8, zone: "sky" },
  library: { x: 14, y: 22, zone: "study" },
  classroom: { x: 48, y: 28, zone: "core" },
  hallway: { x: 72, y: 26, zone: "core" },
  club_room: { x: 86, y: 38, zone: "side" },
  playground: { x: 18, y: 48, zone: "out" },
  cafeteria: { x: 62, y: 52, zone: "life" },
  shop: { x: 82, y: 58, zone: "life" },
  dorm_gate: { x: 48, y: 68, zone: "dorm" },
  dorm_m1: { x: 18, y: 82, zone: "dorm" },
  dorm_m2: { x: 32, y: 86, zone: "dorm" },
  dorm_f1: { x: 52, y: 82, zone: "dorm" },
  dorm_f2: { x: 66, y: 86, zone: "dorm" },
  dorm_f3: { x: 78, y: 82, zone: "dorm" },
  dorm_f4: { x: 90, y: 86, zone: "dorm" },
};

const PREVIEW_SHOW = 5;

interface Props {
  locations: LocationInfo[];
  currentId: string;
  busy: boolean;
  weatherId?: string;
  onEnter: (locationId: string) => void;
  /** Click a person chip → travel + focus that student */
  onSelectPerson?: (locationId: string, studentId: string) => void;
}

export function CampusMapView({
  locations,
  currentId,
  busy,
  weatherId,
  onEnter,
  onSelectPerson,
}: Props) {
  const weatherClass = `campus-map weather-${weatherId || "cloudy"}`;

  return (
    <div className={weatherClass}>
      <div className="campus-map-sky" aria-hidden />
      <div className="campus-map-ground" aria-hidden />
      <div className="campus-map-path campus-map-path-h" aria-hidden />
      <div className="campus-map-path campus-map-path-v" aria-hidden />
      <div className="campus-map-quad teaching" aria-hidden>
        <span>教学区</span>
      </div>
      <div className="campus-map-quad living" aria-hidden>
        <span>生活区</span>
      </div>
      <div className="campus-map-quad dorm" aria-hidden>
        <span>宿舍区</span>
      </div>

      {locations.map((loc) => {
        const pos = MAP_LAYOUT[loc.id] || { x: 50, y: 50 };
        const here = loc.id === currentId;
        const count = loc.present_count ?? 0;
        const preview = (loc.present_preview ?? []).filter((p) => !p.is_pc);
        const shown = preview.slice(0, PREVIEW_SHOW);
        const overflow = Math.max(0, count - shown.length - (loc.present_preview?.some((p) => p.is_pc) ? 1 : 0));

        return (
          <div
            key={loc.id}
            className={`map-pin zone-${pos.zone || "side"}${here ? " is-here" : ""}${
              count > 0 ? " has-people" : ""
            }`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <button
              type="button"
              className="map-pin-hit"
              disabled={busy}
              onClick={() => onEnter(loc.id)}
              title={loc.blurb}
            >
              <span className="map-pin-dot" />
              <span className="map-pin-card">
                <strong>{loc.name}</strong>
                <em>{here ? "你在这里" : count > 0 ? `${count} 人` : "空"}</em>
              </span>
            </button>
            {shown.length > 0 && (
              <span className="map-pin-faces" role="group" aria-label={`${loc.name}在场`}>
                {shown.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="map-face-btn"
                    disabled={busy || !onSelectPerson}
                    title={`查看 ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPerson?.(loc.id, p.id);
                    }}
                  >
                    <FaceChip
                      src={p.q_sprite?.path || p.sprite?.path}
                      name={p.name}
                      className="mini q-chip"
                    />
                  </button>
                ))}
                {overflow > 0 && <span className="map-pin-more">+{overflow}</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
