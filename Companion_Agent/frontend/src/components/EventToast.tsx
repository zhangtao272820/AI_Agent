import type { GameEventInfo } from "../types";

type Props = {
  event: GameEventInfo | null;
  onDismiss?: () => void;
};

export default function EventToast({ event, onDismiss }: Props) {
  if (!event?.label) return null;
  return (
    <div className="gal-event-toast" role="status">
      <span className="gal-event-toast-kicker">— 事件 —</span>
      <strong>{event.label}</strong>
      {onDismiss && (
        <button type="button" className="gal-event-toast-close" onClick={onDismiss} aria-label="关闭">
          ×
        </button>
      )}
    </div>
  );
}
