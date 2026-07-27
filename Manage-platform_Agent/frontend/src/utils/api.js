export async function fetchJsonSafe(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = String(response.headers.get("content-type") || "");
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    const hint = text.trim().startsWith("<")
      ? "后端返回 HTML（多为 clawhive_backend 未就绪或 Nginx 502）"
      : text.slice(0, 120) || `HTTP ${response.status}`;
    return { ok: false, status: response.status, error: hint, data: null };
  }
  try {
    const data = text ? JSON.parse(text) : null;
    return { ok: response.ok, status: response.status, error: null, data };
  } catch (err) {
    return { ok: false, status: response.status, error: err?.message || "JSON 解析失败", data: null };
  }
}
