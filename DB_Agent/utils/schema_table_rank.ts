/**
 * Schema 检索辅助：仅做机械分词（便于 LIKE 检索），不做业务语义路由。
 */
export function expandSearchTokens(raw: string): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  const stop = new Set([
    "查询",
    "统计",
    "信息",
    "情况",
    "有哪些",
    "是什么",
    "多少",
    "几条",
    "条数",
    "数据",
    "详情",
    "列表",
    "请问",
    "帮我",
    "看看",
    "一下",
    "个人",
    "什么",
  ]);

  const base = text
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[，,。.;；:："'“”‘’（）()\[\]{}<>《》【】!?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const out = new Set<string>();
  const push = (t: string) => {
    const s = String(t ?? "").trim();
    if (s.length >= 2 && !stop.has(s)) out.add(s);
  };

  const chunks = base.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [];
  for (const chunk of chunks) {
    push(chunk);
    if (/^[\u4e00-\u9fa5]+$/.test(chunk) && chunk.length > 4) {
      for (const len of [2, 3, 4]) {
        for (let i = 0; i <= chunk.length - len; i++) {
          push(chunk.slice(i, i + len));
        }
      }
    }
  }

  return Array.from(out).slice(0, 28);
}

/** 去掉查询计划中已识别的姓名，减少姓名片段干扰表检索（姓名来自 NLU 模型，非正则路由）。 */
export function stripPersonNamesFromSearchText(question: string, names: string[]): string {
  let q = String(question ?? "");
  for (const n of names) {
    const name = String(n ?? "").trim();
    if (name.length >= 2) q = q.split(name).join(" ");
  }
  return q.replace(/\s+/g, " ").trim();
}
