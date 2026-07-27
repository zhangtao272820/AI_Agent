import SpriteAvatar from "./SpriteAvatar";
import type { AvatarState } from "../types";

type Props = {
  characterId: string;
  /** casual / work / home / date / rain … 来自 bond.sprite_outfit */
  outfit?: string;
  emotion?: string;
  themeColor?: string;
  /** stage = 地点大立绘；card = 图鉴卡片；detail = 详情半身 */
  size?: "stage" | "card" | "detail";
  speaking?: boolean;
  className?: string;
  alt?: string;
};

/** 把全身立绘资源接到地点/图鉴等非对话场。 */
export default function SpritePortrait({
  characterId,
  outfit = "",
  emotion = "neutral",
  themeColor,
  size = "stage",
  speaking,
  className,
}: Props) {
  const avatar: AvatarState = {
    emotion,
    expression: emotion,
    motion: "idle",
  };
  return (
    <div className={`gal-sprite-portrait gal-sprite-portrait--${size}${className ? ` ${className}` : ""}`}>
      <SpriteAvatar
        characterId={characterId}
        avatar={avatar}
        speaking={speaking}
        themeColor={themeColor}
        outfit={outfit}
      />
    </div>
  );
}
