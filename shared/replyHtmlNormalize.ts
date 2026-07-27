/** 解码模型回显的 HTML 实体 */
function decodeHtmlEntities(text: string): string {
  return String(text ?? '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
}

/** 去掉 LLM 误贴的前端同款 HTML（md-badge / md-strong 等），还原为可渲染 Markdown */
export function normalizeModelReplyHtml(text: string): string {
  let s = decodeHtmlEntities(String(text ?? ''))
  s = s.replace(/<\s*span[^>]*class=["'][^"']*\bmd-badge[^"']*["'][^>]*>([\s\S]*?)<\s*\/\s*span\s*>/gi, '$1')
  s = s.replace(/<\s*code[^>]*>([\s\S]*?)<\s*\/\s*code\s*>/gi, '`$1`')
  s = s.replace(/<\s*strong[^>]*>([\s\S]*?)<\s*\/\s*strong\s*>/gi, '**$1**')
  s = s.replace(/<\s*b[^>]*>([\s\S]*?)<\s*\/\s*b\s*>/gi, '**$1**')
  s = s.replace(/<\s*em[^>]*>([\s\S]*?)<\s*\/\s*em\s*>/gi, '*$1*')
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  return s
}
