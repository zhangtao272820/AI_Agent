import { useEffect, useId, useState } from 'react';

type AppModalMode = 'alert' | 'confirm' | 'prompt';

type AppModalProps = {
  open: boolean;
  mode?: AppModalMode;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  inputValue?: string;
  inputPlaceholder?: string;
  inputMaxLength?: number;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
};

export function AppModal({
  open,
  mode = 'alert',
  title = '提示',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  inputValue = '',
  inputPlaceholder = '',
  inputMaxLength = 80,
  onConfirm,
  onCancel,
}: AppModalProps) {
  const titleId = useId();
  const [localInput, setLocalInput] = useState('');

  useEffect(() => {
    if (open && mode === 'prompt') setLocalInput(inputValue || '');
  }, [open, mode, inputValue]);

  useEffect(() => {
    if (!open) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mode === 'alert') onConfirm();
      else onCancel();
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [open, mode, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="presentation"
      onClick={() => (mode === 'alert' ? onConfirm() : onCancel())}
    >
      <div
        className="relative mx-4 w-full max-w-sm rounded-xl border border-white/10 bg-[#061422]/96 shadow-2xl backdrop-blur"
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-white/10 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold text-white/95">
            {title}
          </h3>
        </header>
        <div className="px-4 py-3">
          {message ? <p className="whitespace-pre-wrap text-sm text-white/65">{message}</p> : null}
          {mode === 'prompt' ? (
            <input
              type="text"
              value={localInput}
              maxLength={inputMaxLength}
              placeholder={inputPlaceholder}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
              onChange={(e) => setLocalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onConfirm(localInput);
                }
              }}
            />
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
          {mode === 'confirm' || mode === 'prompt' ? (
            <button
              type="button"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg bg-sky-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400"
            onClick={() => onConfirm(mode === 'prompt' ? localInput : undefined)}
          >
            {confirmText}
          </button>
        </footer>
      </div>
    </div>
  );
}
