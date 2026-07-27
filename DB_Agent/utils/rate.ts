const buckets = new Map<string, { tokens: number; last: number }>();
const MAX_TOKENS = 30;
const REFILL_PER_SEC = 12;
const BAN_THRESHOLD = -20;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function keyFrom(event: any): string {
  try {
    const ip =
      (event?.node?.req?.headers?.["x-forwarded-for"] as any)?.split?.(",")?.[0]?.trim?.() ||
      (event?.node?.req?.socket?.remoteAddress as any) ||
      "local";
    return String(ip || "local");
  } catch {
    return "local";
  }
}

export function ensureRateLimit(event: any, opts?: { max?: number; refillPerSec?: number }) {
  const k = keyFrom(event);
  const now = nowSec();
  const max = typeof opts?.max === "number" && opts.max > 0 ? Math.floor(opts.max) : MAX_TOKENS;
  const refill = typeof opts?.refillPerSec === "number" && opts.refillPerSec > 0 ? Math.floor(opts.refillPerSec) : REFILL_PER_SEC;
  let b = buckets.get(k);
  if (!b) b = { tokens: max, last: now };
  const elapsed = Math.max(0, now - b.last);
  if (elapsed > 0) {
    b.tokens = Math.min(max, b.tokens + elapsed * refill);
    b.last = now;
  }
  b.tokens -= 1;
  buckets.set(k, b);
  if (b.tokens < BAN_THRESHOLD) {
    const err: any = new Error("请求过于频繁，请稍后再试");
    err.statusCode = 429;
    err.statusMessage = "Too Many Requests";
    throw err;
  }
}
