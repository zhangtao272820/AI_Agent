/** WebSocket 思考过程推送：跨 setImmediate 逐条发送，避免 Nitro/crossws 在 async handler 内缓冲出站帧。 */
export function createWsThinkingSender(peer: { send: (data: string) => void }) {
  let last = "";
  let draining = false;
  const queue: string[] = [];

  const drain = () => {
    if (draining) return;
    draining = true;
    const tick = () => {
      const text = queue.shift();
      if (!text) {
        draining = false;
        return;
      }
      try {
        peer.send(JSON.stringify({ event: "thinking", data: text }));
      } catch {
        /* peer may already be closed */
      }
      setImmediate(tick);
    };
    setImmediate(tick);
  };

  return (text: string) => {
    const t = String(text ?? "").trim();
    if (!t || t === last) return;
    last = t;
    queue.push(t);
    drain();
  };
}
