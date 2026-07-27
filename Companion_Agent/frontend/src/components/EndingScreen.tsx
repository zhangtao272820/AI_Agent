import { useEffect, useMemo, useState } from "react";
import type { EndingInfo } from "../types";
import { spriteUrl } from "../hooks/useBgm";

type Props = {
  ending: EndingInfo;
  characterName: string;
  characterId?: string;
  onRestart: () => void;
  onMenu: () => void;
  onPlayBgm?: (trackId: string) => void;
};

function resolveSprite(ending: EndingInfo, characterId?: string) {
  const present = ending.presentation;
  const sp = present?.sprite;
  const cid = sp?.character_id || characterId || ending.character_ids?.[0] || "";
  const emotion = sp?.emotion || (ending.type === "bad" ? "sad" : ending.type === "secret" ? "love" : "happy");
  const outfit = sp?.outfit || "";
  return { cid, emotion, outfit };
}

function narrationPages(ending: EndingInfo): string[] {
  const pages = (ending.presentation?.pages || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (pages.length) return pages;
  const bits = [ending.description, ending.cg_hint].map((x) => String(x || "").trim()).filter(Boolean);
  return bits.length ? bits : [ending.description || "……"];
}

export default function EndingScreen({
  ending,
  characterName,
  characterId,
  onRestart,
  onMenu,
  onPlayBgm,
}: Props) {
  const type = ending.type || "good";
  const typeClass =
    type === "bad" ? "ending-screen--bad" : type === "normal" ? "ending-screen--normal" : type === "secret" ? "ending-screen--secret" : "ending-screen--good";
  const typeLabel =
    type === "secret" ? "真结局" : type === "good" ? "好结局" : type === "normal" ? "软结局" : type === "bad" ? "坏结局" : "结局";

  const bg = ending.presentation?.bg || (type === "bad" ? "rain.png" : type === "secret" ? "starry.png" : "cafe.png");
  const { cid, emotion, outfit } = resolveSprite(ending, characterId);
  const pages = useMemo(() => narrationPages(ending), [ending]);
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    setPageIdx(0);
  }, [ending.id, ending.title]);

  useEffect(() => {
    const track = ending.presentation?.bgm;
    if (track && onPlayBgm) onPlayBgm(track);
  }, [ending.presentation?.bgm, onPlayBgm]);

  const atLast = pageIdx >= pages.length - 1;
  const body = pages[Math.min(pageIdx, pages.length - 1)] || "";

  return (
    <div className={`ending-screen ending-screen--cinema ${typeClass}`}>
      <div className="ending-screen-bg" style={{ backgroundImage: `url(/api/bgs/${bg})` }} />
      <div className="ending-screen-shade" />

      {cid && (
        <div className="ending-screen-sprite">
          <img
            src={spriteUrl(cid, emotion, outfit)}
            alt=""
            onError={(e) => {
              const img = e.currentTarget;
              if (outfit) {
                img.src = spriteUrl(cid, emotion);
              } else {
                img.src = spriteUrl(cid, "neutral");
              }
            }}
          />
        </div>
      )}

      <div className="ending-screen-inner">
        <p className="ending-type-badge">{typeLabel}</p>
        <p className="ending-eyebrow">{characterName}</p>
        <h2>{ending.title}</h2>
        {ending.subtitle && <p className="ending-subtitle">{ending.subtitle}</p>}
        <p className="ending-desc ending-desc--page">{body}</p>
        {pages.length > 1 ? (
          <p className="ending-page-meta muted">
            {pageIdx + 1} / {pages.length}
          </p>
        ) : null}
        <div className="ending-actions">
          {!atLast ? (
            <button type="button" className="btn-primary" onClick={() => setPageIdx((i) => i + 1)}>
              下一页
            </button>
          ) : (
            <>
              <button type="button" className="btn-primary" onClick={onRestart}>
                再开一局
              </button>
              <button type="button" className="btn-ghost" onClick={onMenu}>
                回主菜单
              </button>
            </>
          )}
          {pages.length > 1 && pageIdx > 0 ? (
            <button type="button" className="btn-ghost" onClick={() => setPageIdx((i) => Math.max(0, i - 1))}>
              上一页
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
