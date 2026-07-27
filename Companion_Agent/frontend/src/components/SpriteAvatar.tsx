import { useEffect, useMemo, useState } from "react";
import { preloadSprites, spriteCandidates, type SpriteStyle } from "../spriteUrl";
import type { AvatarState } from "../types";

type Props = {
  characterId: string;
  avatar: AvatarState | null;
  speaking?: boolean;
  themeColor?: string;
  outfit?: string;
  /** anime（默认）| photoreal（menu_*）；名牌 Q 头不走此组件 */
  style?: SpriteStyle;
  className?: string;
  dimmed?: boolean;
};

/** Prefer exact emotion file; only fold rare keys onto closest dedicated art. */
function resolveSpriteEmotion(raw: string | undefined): string {
  const e = (raw || "neutral").toLowerCase();
  if (e === "mock" || e === "contempt") return "sarcastic";
  if (e === "annoyed") return "angry";
  if (e === "smug") return "happy";
  return e;
}

export default function SpriteAvatar({
  characterId,
  avatar,
  speaking,
  themeColor,
  outfit = "",
  style = "anime",
  className,
  dimmed,
}: Props) {
  const emotion = resolveSpriteEmotion(avatar?.emotion || avatar?.expression);
  const outfitId = (outfit || "").trim().toLowerCase();
  const [fbStep, setFbStep] = useState(0);

  useEffect(() => {
    setFbStep(0);
  }, [characterId, emotion, outfitId, style, speaking]);

  const candidates = useMemo(
    () =>
      spriteCandidates(characterId, {
        style,
        outfit: outfitId,
        emotion,
        speaking: speaking === true ? true : speaking === false ? false : undefined,
      }),
    [characterId, emotion, outfitId, style, speaking],
  );

  const targetSrc = candidates[Math.min(fbStep, candidates.length - 1)] || candidates[0];

  /** Keep previous frame until the next URL is ready (cuts dialogue switch lag). */
  const [shownSrc, setShownSrc] = useState(targetSrc);

  useEffect(() => {
    preloadSprites(candidates);
  }, [candidates]);

  useEffect(() => {
    if (targetSrc === shownSrc) return;
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!cancelled) setShownSrc(targetSrc);
    };
    img.onerror = () => {
      if (!cancelled) setFbStep((s) => Math.min(s + 1, Math.max(0, candidates.length - 1)));
    };
    img.src = targetSrc;
    return () => {
      cancelled = true;
    };
  }, [targetSrc, shownSrc, candidates.length]);

  return (
    <div
      className={`gal-sprite-wrap${speaking ? " gal-sprite-wrap--speak" : ""}${
        dimmed ? " gal-sprite-wrap--dim" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <img className="gal-sprite-img" src={shownSrc} alt="" draggable={false} />
      <div className="gal-sprite-shadow" style={{ background: themeColor ? `${themeColor}33` : undefined }} />
    </div>
  );
}
