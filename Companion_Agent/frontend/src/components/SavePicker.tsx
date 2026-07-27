import type { SaveSummary } from "../types";
import { affinityImpression, stageImpression } from "../impression";

type Props = {
  saves: SaveSummary[];
  loading?: boolean;
  onPick: (saveId: string) => void;
  onDelete?: (saveId: string) => void;
  onBack: () => void;
};

export default function SavePicker({ saves, loading, onPick, onDelete, onBack }: Props) {
  return (
    <div className="gal-save-picker">
      <header className="gal-gallery-head">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返回
        </button>
        <h2>你的存档</h2>
        <span className="muted">仅本人可见</span>
      </header>
      {loading && <p className="muted">加载存档…</p>}
      {!loading && saves.length === 0 && <p className="muted">暂无存档，请开始新的邂逅。</p>}
      <div className="gal-save-list">
        {saves.map((s) => {
          const bond = affinityImpression(s.affinity);
          const stage = stageImpression("", s.stage_label);
          return (
            <div key={s.save_id} className="gal-save-row">
              <button type="button" className="gal-save-slot" onClick={() => onPick(s.save_id)}>
                <div>
                  <strong>{s.character_name || "无名的她"}</strong>
                  <span className="muted">
                    {" "}
                    · {stage} · {bond}
                  </span>
                </div>
                <span className="gal-save-date">{s.updated_at?.slice(0, 16).replace("T", " ") || ""}</span>
              </button>
              {onDelete && (
                <button
                  type="button"
                  className="gal-save-delete"
                  title="删除存档"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`确定删除「${s.character_name}」的存档？`)) {
                      onDelete(s.save_id);
                    }
                  }}
                >
                  删
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
