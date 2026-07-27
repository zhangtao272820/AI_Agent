#!/usr/bin/env node
/**
 * 通过运维接口重建向量索引（需 Manager 已配置 MANAGER_OPS_TOKEN）。
 * 用法：MANAGER_OPS_TOKEN=xxx node scripts/vector-reindex.mjs [--max=500] [--port=13106]
 */
const maxArg = process.argv.find((a) => a.startsWith('--max='))
const portArg = process.argv.find((a) => a.startsWith('--port='))
const maxEntries = maxArg ? Number(maxArg.split('=')[1]) : 500
const port = portArg ? Number(portArg.split('=')[1]) : Number(process.env.PORT || 13106)
const token = String(process.env.MANAGER_OPS_TOKEN || '').trim()

if (!token) {
  console.error('请设置 MANAGER_OPS_TOKEN（与 .env 中一致）')
  process.exit(1)
}

const url = `http://127.0.0.1:${port}/api/manager/ops`
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-manager-ops-token': token },
  body: JSON.stringify({ action: 'vector_reindex', maxEntries })
})
const text = await res.text()
let body
try {
  body = JSON.parse(text)
} catch {
  body = { raw: text }
}
console.log(JSON.stringify(body, null, 2))
if (!res.ok) process.exit(1)
