/**
 * P3-3 partial: HTML ingestion smoke (no LLM / no vector store).
 */
import { stripHtmlToPlainText, looksLikeHtmlDocument } from '../server/utils/html_text'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const sample = `<!DOCTYPE html>
<html><head><title>T</title><style>.x{}</style><script>alert(1)</script></head>
<body><h1>探视制度</h1><p>工作日下午 <strong>14:00-16:00</strong> 开放。</p>
<table><tr><td>华东</td><td>120</td></tr><tr><td>华南</td><td>80</td></tr></table></body></html>`

const plain = stripHtmlToPlainText(sample)
assert(plain.includes('探视制度'), 'heading text preserved')
assert(plain.includes('14:00-16:00'), 'inline text preserved')
assert(!plain.includes('alert'), 'script stripped')
assert(!plain.includes('<p>'), 'tags stripped')

const buf = Buffer.from(sample, 'utf-8')
assert(looksLikeHtmlDocument(buf, 'policy.html'), 'html extension')
assert(looksLikeHtmlDocument(buf, 'unknown.txt'), 'doctype sniff')

console.log('smoke: html ok')
