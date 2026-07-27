export type AgentView = {
  reply: string;
  meta: { k: string; v: string }[];
  isMock: boolean;
  isError: boolean;
  raw: string;
};

function innerResult(data: Record<string, unknown>): Record<string, unknown> {
  const r = data.result;
  if (r && typeof r === "object") return r as Record<string, unknown>;
  const results = data.results;
  if (Array.isArray(results) && results[0] && typeof results[0] === "object") {
    return results[0] as Record<string, unknown>;
  }
  return data;
}

function looksMock(s: string): boolean {
  return /\[mock\]/i.test(s);
}

export function parseAgentView(data: unknown): AgentView {
  const raw = JSON.stringify(data, null, 2);
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;

  if (o.ok === false) {
    return {
      reply: String(o.error || o.message || "请求失败"),
      meta: [],
      isMock: false,
      isError: true,
      raw,
    };
  }

  if (typeof o.agent_reply === "string" && o.agent_reply.trim()) {
    const inner = innerResult(o);
    const meta = buildMeta(inner);
    const isMock = Boolean(o.mock) || looksMock(o.agent_reply);
    const isErr =
      o.ok === false ||
      /失败|演示模式|未识别|ASR/.test(o.agent_reply) ||
      Boolean(inner.error);
    return {
      reply: o.agent_reply.trim(),
      meta: isErr ? [] : meta,
      isMock,
      isError: isErr,
      raw,
    };
  }

  const inner = innerResult(o);
  const analysis =
    inner.analysis && typeof inner.analysis === "object"
      ? (inner.analysis as Record<string, unknown>)
      : inner;

  const reply =
    pickText(inner, "answer") ||
    pickText(inner, "summary") ||
    pickText(analysis, "description") ||
    pickText(inner, "description") ||
    pickText(inner, "transcript") ||
    (o.hint ? String(o.hint) : "");

  const meta = buildMeta({ ...analysis, ...inner });
  const isMock =
    looksMock(reply) ||
    looksMock(pickText(analysis, "description")) ||
    Boolean((analysis.raw as Record<string, unknown>)?.mock);

  if (!reply.trim()) {
    return {
      reply: isMock
        ? "演示模式：未配置 API Key，无法生成真实回复。请检查 .env 后重建容器。"
        : "暂无回复内容，请重试或补充描述问题。",
      meta,
      isMock,
      isError: false,
      raw,
    };
  }

  return { reply: reply.trim(), meta, isMock, isError: false, raw };
}

function pickText(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return v != null ? String(v).trim() : "";
}

function buildMeta(inner: Record<string, unknown>): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  const add = (k: string, label: string) => {
    const v = inner[k];
    if (v != null && String(v).trim() && !looksMock(String(v))) {
      out.push({ k: label, v: String(v) });
    }
  };
  add("ocr_text", "OCR");
  add("transcript", "转写");
  add("summary", "摘要");
  const emo = inner.emotions;
  if (Array.isArray(emo) && emo.length) out.push({ k: "情绪", v: emo.join("、") });
  const conf = inner.confidence;
  if (typeof conf === "number" && conf > 0) {
    out.push({ k: "置信度", v: `${Math.round(conf * 100)}%` });
  }
  return out;
}
