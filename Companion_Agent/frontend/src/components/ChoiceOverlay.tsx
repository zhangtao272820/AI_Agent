export type ChoiceKind = "soft" | "branch";

type Props = {
  choices: string[];
  kind?: ChoiceKind;
  disabled?: boolean;
  onChoice: (text: string, index: number, kind: ChoiceKind) => void;
};

/** soft：可选回复（主操作）；branch：事件分支，会影响态度。 */
export default function ChoiceOverlay({ choices, kind = "soft", disabled, onChoice }: Props) {
  if (!choices.length) return null;
  const isBranch = kind === "branch";
  return (
    <div
      className={`gal-choice-overlay gal-choice-overlay--primary gal-choice-overlay--virtues${
        isBranch ? " gal-choice-overlay--branch" : ""
      }`}
      role="group"
      aria-label={isBranch ? "重要选择" : "选择你想说的"}
    >
      <p className="gal-choice-hint">
        {isBranch ? "这一选择会影响她的态度" : "选择你想说的"}
      </p>
      <div className="gal-choice-list">
        {choices.map((label, index) => (
          <button
            key={`${label}-${index}`}
            type="button"
            className={`gal-choice-btn${isBranch ? " gal-choice-btn--branch" : ""}`}
            disabled={disabled}
            onClick={() => onChoice(label, index, kind)}
            style={{ animationDelay: `${index * 55}ms` }}
          >
            <span className="gal-choice-index">{String.fromCharCode(65 + index)}</span>
            <span className="gal-choice-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
