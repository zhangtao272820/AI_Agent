import type { QuestState } from "../types";

type Props = {
  quest: QuestState | null;
  onOpen?: () => void;
};

export default function QuestHud({ quest, onOpen }: Props) {
  if (!quest?.active_step) return null;
  const progress =
    quest.total_steps > 0 ? `${quest.completed_count}/${quest.total_steps}` : "";

  return (
    <button
      type="button"
      className="gal-quest-hud"
      onClick={onOpen}
      title="查看线索板（靠相处推进，不必点选项完成）"
    >
      <span className="gal-quest-label">线索</span>
      <strong>{quest.active_step.label}</strong>
      <span className="gal-quest-desc">{quest.active_step.description}</span>
      <span className="gal-quest-how">多聊聊、赴约、记住她在意的事</span>
      {progress && <span className="gal-quest-progress">{progress}</span>}
    </button>
  );
}
