import { useEffect, useState, type CSSProperties } from "react";
import { avatarCandidates, preloadSprites } from "../spriteUrl";

type Props = {
  characterId: string;
  name?: string;
  size?: "sm" | "md" | "lg";
  themeColor?: string;
  className?: string;
  title?: string;
  /** 对话情绪：优先 avatar_{emotion}.png，缺则回退 avatar.png */
  emotion?: string;
};

/**
 * 圆形 Q 版头像：avatar.png / avatar_{emotion}.png（透明底）。
 * 地图 / 地点 / 对话名牌一律不裁切全身立绘。
 */
export default function FaceChip({
  characterId,
  name,
  size = "md",
  themeColor,
  className,
  title,
  emotion,
}: Props) {
  const candidates = avatarCandidates(characterId, emotion);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIdx(0);
    setFailed(false);
    preloadSprites(candidates);
  }, [characterId, emotion, candidates.join("|")]);

  const src = candidates[Math.min(idx, candidates.length - 1)] || candidates[0];
  const style = themeColor
    ? ({ ["--face-ring" as string]: themeColor } as CSSProperties)
    : undefined;

  const initial = (name || characterId || "?").trim().slice(0, 1);

  return (
    <span
      className={`gal-face-chip gal-face-chip--${size} gal-face-chip--q${
        failed ? " gal-face-chip--fallback" : ""
      }${className ? ` ${className}` : ""}`}
      title={title || name || characterId}
      style={style}
    >
      {failed ? (
        <span className="gal-face-chip-initial" aria-hidden>
          {initial}
        </span>
      ) : (
        <img
          key={src}
          src={src}
          alt={name || ""}
          draggable={false}
          onError={() => {
            if (idx + 1 < candidates.length) {
              setIdx((i) => i + 1);
            } else {
              setFailed(true);
            }
          }}
        />
      )}
    </span>
  );
}
