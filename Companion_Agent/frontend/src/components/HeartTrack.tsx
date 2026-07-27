import { stageImpression } from "../impression";

const STAGES = [
  { id: "stranger", label: "初见" },
  { id: "acquaintance", label: "认识" },
  { id: "friend", label: "朋友" },
  { id: "crush", label: "心动" },
  { id: "dating", label: "靠近" },
  { id: "lover", label: "恋人" },
  { id: "married", label: "相守" },
] as const;

type Props = {
  stageId?: string;
  stageLabel?: string;
  /** 0–100，仅驱动心形填充，不向玩家展示数字 */
  affinity?: number;
  compact?: boolean;
};

function stageIndex(stageId?: string): number {
  const id = (stageId || "stranger").toLowerCase();
  const i = STAGES.findIndex((s) => s.id === id);
  return i >= 0 ? i : 0;
}

/** 美德式关系心形轨：印象文案 + 阶段点，不泄裸数值。 */
export default function HeartTrack({ stageId, stageLabel, affinity = 0, compact }: Props) {
  const idx = stageIndex(stageId);
  const fill = Math.max(0, Math.min(100, affinity));
  const impression = stageImpression(stageId || "stranger", stageLabel);

  return (
    <div
      className={`gal-heart-track${compact ? " gal-heart-track--compact" : ""}`}
      role="img"
      aria-label={`关系：${impression}`}
      title={impression}
    >
      <div className="gal-heart-track-bar" aria-hidden>
        <span className="gal-heart-track-fill" style={{ width: `${fill}%` }} />
        <span className="gal-heart-track-icon">♥</span>
      </div>
      <ol className="gal-heart-track-steps">
        {STAGES.map((s, i) => (
          <li
            key={s.id}
            className={`gal-heart-track-step${i <= idx ? " is-on" : ""}${i === idx ? " is-now" : ""}`}
          >
            <i />
            {!compact ? <em>{s.label}</em> : null}
          </li>
        ))}
      </ol>
      {!compact ? <p className="gal-heart-track-label">{impression}</p> : null}
    </div>
  );
}
