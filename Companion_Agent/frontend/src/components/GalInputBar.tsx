import { useEffect, useState } from "react";

type Props = {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onSend: () => void;
  /** 有选项时默认收起；为 true 时始终展开输入 */
  hasChoices?: boolean;
  /** 设置：始终显示输入框（选项仍为主） */
  alwaysShowInput?: boolean;
};

export default function GalInputBar({
  value,
  disabled,
  onChange,
  onSend,
  hasChoices = false,
  alwaysShowInput = false,
}: Props) {
  const [expanded, setExpanded] = useState(!hasChoices || alwaysShowInput);

  useEffect(() => {
    if (alwaysShowInput || !hasChoices) {
      setExpanded(true);
      return;
    }
    setExpanded(false);
  }, [hasChoices, alwaysShowInput]);

  if (hasChoices && !alwaysShowInput && !expanded) {
    return (
      <div className="gal-input-bar gal-input-bar--collapsed">
        <button
          type="button"
          className="gal-input-expand-btn"
          disabled={disabled}
          onClick={() => setExpanded(true)}
        >
          自己说…
        </button>
      </div>
    );
  }

  return (
    <div className={`gal-input-bar${hasChoices ? " gal-input-bar--secondary" : ""}`}>
      {hasChoices && !alwaysShowInput ? (
        <button
          type="button"
          className="gal-input-collapse-btn"
          disabled={disabled}
          onClick={() => setExpanded(false)}
          title="收起输入，只用选项"
        >
          收起
        </button>
      ) : null}
      <input
        type="text"
        value={value}
        placeholder={hasChoices ? "也可以自己说……" : "想对她说些什么…"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <button type="button" className="gal-send-btn" disabled={disabled || !value.trim()} onClick={onSend}>
        发送
      </button>
    </div>
  );
}
