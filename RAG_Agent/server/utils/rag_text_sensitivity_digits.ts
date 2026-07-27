/** 全角数字 → 半角（独立文件避免循环依赖） */
export function normalizeFullwidthDigits(text: string): string {
  const out: string[] = [];
  for (const ch of String(text || "")) {
    if (ch >= "\uff10" && ch <= "\uff19") {
      out.push(String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}
