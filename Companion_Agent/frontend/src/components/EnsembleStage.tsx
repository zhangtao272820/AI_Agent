import SpriteAvatar from "./SpriteAvatar";
import type { AvatarState } from "../types";
import type { SpriteStyle } from "../spriteUrl";

export type EnsembleCastMember = {
  character_id: string;
  name: string;
  theme_color?: string;
  sprite_outfit?: string;
};

type Props = {
  cast: EnsembleCastMember[];
  speakingId: string;
  /** focus 角色的 avatar；guest 用中性/旁观态 */
  focusAvatar: AvatarState | null;
  focusId: string;
  spriteStyle: SpriteStyle;
  className?: string;
};

/** 双人舞台：说话者亮/大，旁观暗/小。第三人+不进本层。 */
export default function EnsembleStage({
  cast,
  speakingId,
  focusAvatar,
  focusId: _focusId,
  spriteStyle,
  className,
}: Props) {
  void _focusId;
  const duo = cast.slice(0, 2);
  if (duo.length < 2) return null;

  return (
    <div className={`gal-ensemble-stage${className ? ` ${className}` : ""}`} aria-label="同场角色">
      {duo.map((m, i) => {
        const speaking = m.character_id === speakingId;
        const avatar: AvatarState | null = speaking
          ? focusAvatar
          : { emotion: "neutral", expression: "neutral", motion: "idle" };
        return (
          <div
            key={m.character_id}
            className={`gal-ensemble-slot gal-ensemble-slot--${i === 0 ? "left" : "right"}${
              speaking ? " gal-ensemble-slot--speak" : " gal-ensemble-slot--listen"
            }`}
          >
            <SpriteAvatar
              characterId={m.character_id}
              avatar={avatar}
              speaking={speaking}
              dimmed={!speaking}
              themeColor={m.theme_color}
              outfit={m.sprite_outfit || ""}
              style={spriteStyle}
            />
            <span className="gal-ensemble-name">{m.name}</span>
          </div>
        );
      })}
    </div>
  );
}
