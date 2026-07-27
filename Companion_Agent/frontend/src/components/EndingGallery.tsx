import { useMemo, useState } from "react";
import type { EndingCatalogEntry, EndingInfo } from "../types";
import { spriteUrl } from "../hooks/useBgm";
import EndingScreen from "./EndingScreen";

type Props = {
  catalog: EndingCatalogEntry[];
  unlockedIds: string[];
  loading?: boolean;
  onBack: () => void;
  onPlayBgm?: (trackId: string) => void;
};

export default function EndingGallery({ catalog, unlockedIds, loading, onBack, onPlayBgm }: Props) {
  const unlocked = useMemo(() => new Set(unlockedIds), [unlockedIds]);
  const [replay, setReplay] = useState<EndingInfo | null>(null);

  const romanceFirst = useMemo(() => {
    const list = [...catalog];
    list.sort((a, b) => {
      const au = unlocked.has(a.id) ? 0 : 1;
      const bu = unlocked.has(b.id) ? 0 : 1;
      if (au !== bu) return au - bu;
      return a.title.localeCompare(b.title, "zh");
    });
    return list;
  }, [catalog, unlocked]);

  return (
    <div className="gal-gallery">
      <header className="gal-gallery-head">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返回
        </button>
        <h2>已窥见的结局</h2>
        <span className="muted">
          {unlockedIds.length}/{catalog.length}
        </span>
      </header>
      <p className="gal-gallery-blurb">未解锁的终章保持沉默。点开已解锁的卡片，可以再看一次演出。</p>
      {loading && <p className="muted">加载中…</p>}
      <div className="gal-gallery-grid">
        {romanceFirst.map((entry) => {
          const isOpen = unlocked.has(entry.id);
          const cid = entry.character_ids?.[0] || entry.presentation?.sprite?.character_id || "";
          const emotion = entry.presentation?.sprite?.emotion || "neutral";
          const outfit = entry.presentation?.sprite?.outfit || "";
          return (
            <article
              key={entry.id}
              className={`gal-ending-card gal-ending-card--${isOpen ? entry.type || "normal" : "locked"}${isOpen ? "" : " gal-ending-card--locked"}`}
            >
              <button
                type="button"
                className="gal-ending-card-cg"
                disabled={!isOpen}
                onClick={() => {
                  if (!isOpen) return;
                  setReplay({
                    id: entry.id,
                    type: entry.type,
                    title: entry.title,
                    subtitle: entry.subtitle,
                    description: entry.description,
                    cg_hint: entry.cg_hint,
                    character_ids: entry.character_ids,
                    presentation: entry.presentation,
                  });
                }}
              >
                {isOpen && cid ? (
                  <img
                    src={spriteUrl(cid, emotion, outfit)}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.src = spriteUrl(cid, "neutral");
                    }}
                  />
                ) : isOpen ? (
                  <span className="gal-ending-cg-hint">{entry.cg_hint || "CG"}</span>
                ) : (
                  <span className="gal-ending-lock">?</span>
                )}
              </button>
              <div className="gal-ending-card-body">
                <span className="gal-ending-type">{isOpen ? entry.type || "End" : "？？"}</span>
                <h3>{isOpen ? entry.title : "？？？"}</h3>
                <p>{isOpen ? entry.description : "雾还太浓。继续聊天、触发隐藏事件，才会揭开这一页。"}</p>
                {isOpen && entry.cg_hint && <em className="gal-ending-cg-line">{entry.cg_hint}</em>}
              </div>
            </article>
          );
        })}
      </div>

      {replay && (
        <EndingScreen
          ending={replay}
          characterName={replay.character_ids?.[0] || "她"}
          characterId={replay.character_ids?.[0]}
          onRestart={() => setReplay(null)}
          onMenu={() => setReplay(null)}
          onPlayBgm={onPlayBgm}
        />
      )}
    </div>
  );
}
