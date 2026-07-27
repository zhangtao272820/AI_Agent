import type { CSSProperties } from "react";
import FaceChip from "./FaceChip";

type Props = {
  name: string;
  text: string;
  pending?: boolean;
  themeColor?: string;
  showHint?: boolean;
  /** 已发出、尚未出现首字时的等待态 */
  waitingFirstToken?: boolean;
  characterId?: string;
  /** 当前台词情绪 → 切换 Q 头 */
  emotion?: string;
};

export default function DialogueBox({
  name,
  text,
  pending,
  themeColor,
  showHint,
  waitingFirstToken,
  characterId,
  emotion,
}: Props) {
  const accent = themeColor || "#c4a574";
  const body = text.trim()
    ? text
    : waitingFirstToken || pending
      ? "她在想怎么说……"
      : "（等待她的下一句话）";

  return (
    <div className="gal-dialogue-box gal-dialogue-box--virtues" style={{ "--gal-accent": accent } as CSSProperties}>
      {characterId ? (
        <FaceChip
          characterId={characterId}
          name={name}
          themeColor={accent}
          size="lg"
          className="gal-dialogue-face"
          title={name}
          emotion={emotion}
        />
      ) : null}
      <div className="gal-dialogue-frame">
        <div className="gal-nameplate">
          <span className="gal-nameplate-name">{name}</span>
          {pending ? <span className="gal-nameplate-status">思考中</span> : null}
        </div>
        <div
          className={`gal-dialogue-text${pending ? " gal-dialogue-text--pending" : ""}${
            waitingFirstToken && !text.trim() ? " gal-dialogue-text--waiting" : ""
          }`}
        >
          {body}
          {pending && <span className="gal-cursor">▌</span>}
        </div>
        {showHint && !pending ? (
          <p className="gal-dialogue-hint">自由聊天为主；上方选项只是顺口一提</p>
        ) : null}
      </div>
    </div>
  );
}
