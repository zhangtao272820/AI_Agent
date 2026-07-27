/** 识别总管 / 平台编排请求，用于检索侧跳过用户画像注入等。 */

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const raw = headers[name.toLowerCase()] ?? headers[name];
  return String(Array.isArray(raw) ? raw[0] : raw || "").trim();
}

export function isManagerOrchestratedRequest(event: {
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } };
}): boolean {
  const headers = event?.node?.req?.headers || {};
  if (headerValue(headers, "x-manager-orchestrated") === "1") return true;
  if (headerValue(headers, "x-trace-id") || headerValue(headers, "x-run-id")) return true;
  return false;
}
