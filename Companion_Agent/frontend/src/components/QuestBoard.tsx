import type { QuestState } from "../types";

type Props = {
  quest: QuestState | null;
  characterName?: string;
  onClose: () => void;
};

export default function QuestBoard({ quest, characterName, onClose }: Props) {
  if (!quest?.active_step && !(quest?.steps && quest.steps.length)) {
    return (
      <div className="gal-panel-scrim" role="dialog" aria-label="线索" onClick={onClose}>
        <div className="gal-panel-sheet" onClick={(e) => e.stopPropagation()}>
          <header className="gal-panel-head">
            <h2>线索</h2>
            <button type="button" className="btn-ghost" onClick={onClose}>
              关闭
            </button>
          </header>
          <p className="muted gal-panel-empty">暂时没有进行中的线索。多聊聊、赴约，故事会自己往前走。</p>
        </div>
      </div>
    );
  }

  const steps =
    quest.steps && quest.steps.length > 0
      ? quest.steps
      : [
          ...(quest.steps_done || []).map((id) => ({
            id,
            label: id,
            description: "",
            status: "done" as const,
          })),
          ...(quest.active_step
            ? [{ ...quest.active_step, status: "active" as const }]
            : []),
        ];

  const progress =
    quest.total_steps > 0 ? `${quest.completed_count}/${quest.total_steps}` : "";

  return (
    <div className="gal-panel-scrim" role="dialog" aria-label="线索板" onClick={onClose}>
      <div className="gal-panel-sheet gal-quest-board" onClick={(e) => e.stopPropagation()}>
        <header className="gal-panel-head">
          <div>
            <p className="gal-panel-eyebrow">{quest.chain_label || "养成线索"}</p>
            <h2>{characterName ? `${characterName}的线索` : "线索板"}</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        {progress ? <p className="gal-quest-board-progress">进度 {progress}</p> : null}
        <p className="gal-quest-board-how">靠相处推进：多聊聊、赴约、记住她在意的事——不必点选项通关。</p>
        <ol className="gal-quest-board-list">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`gal-quest-board-step gal-quest-board-step--${step.status || "locked"}`}
            >
              <span className="gal-quest-board-mark" aria-hidden>
                {step.status === "done" ? "✓" : step.status === "active" ? "●" : "○"}
              </span>
              <div>
                <strong>{step.label}</strong>
                {step.description ? <p>{step.description}</p> : null}
                {step.status === "active" ? <em>进行中</em> : null}
                {step.status === "locked" ? <em>尚未开启</em> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
