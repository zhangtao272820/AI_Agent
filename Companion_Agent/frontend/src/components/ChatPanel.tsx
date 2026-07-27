import type { ChatMessage } from "../types";

type Props = {
  messages: ChatMessage[];
  input: string;
  pending: boolean;
  connected: boolean;
  choices: string[];
  onInput: (v: string) => void;
  onSend: () => void;
  onReset: () => void;
  onChoice: (text: string, index: number) => void;
};

export default function ChatPanel({
  messages,
  input,
  pending,
  connected,
  choices,
  onInput,
  onSend,
  onReset,
  onChoice,
}: Props) {
  const showChoices = choices.length > 0 && !pending;

  return (
    <section className="panel chat-panel">
      <header className="panel-head chat-head">
        <div>
          <h2>对话</h2>
          <p className={connected ? "ok" : "warn"}>{connected ? "WebSocket 已连接" : "连接中…"}</p>
        </div>
        <button type="button" className="btn-ghost" disabled={pending} onClick={onReset}>
          重新开始
        </button>
      </header>

      <div className="chat-body">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>配置角色后点击「开始陪伴」。</p>
            <p className="muted">模型会在括号里写动作，前端会同步切换表情。</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role} ${m.pending ? "pending" : ""}`}>
            <span className="bubble-role">{m.role === "user" ? "你" : "她"}</span>
            <div>{m.text}</div>
            {m.avatar?.actions?.length ? (
              <div className="bubble-action">{m.avatar.actions.map((a) => `（${a}）`).join(" ")}</div>
            ) : null}
          </div>
        ))}
      </div>

      {showChoices && (
        <div className="choice-row">
          <span className="choice-label">选项</span>
          {choices.map((label, index) => (
            <button
              key={`${label}-${index}`}
              type="button"
              className="choice-btn"
              disabled={!connected}
              onClick={() => onChoice(label, index)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input">
        <textarea
          rows={3}
          value={input}
          placeholder={showChoices ? "也可自由输入…" : "说点什么…"}
          disabled={!connected || pending}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <button type="button" className="btn-primary" disabled={!connected || pending} onClick={onSend}>
          {pending ? "思考中…" : "发送"}
        </button>
      </div>
    </section>
  );
}
