/**
 * reconNotes 契约回归
 */
import { buildReconNotesFromProbe, formatReconNotesBlock } from '../../../server/graph/core/probe/reconNotes'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const notes = buildReconNotesFromProbe({
  rag: { hits: 2, topSources: ['制度A', '制度B'] },
  db: { matched: true, routingRelevant: true, businessTables: ['orders'] },
  crawler: { probed: true, ready: true },
  code: { probed: true, healthy: true }
})
assert(notes.includes('知识库：命中 2'), 'rag hits')
assert(notes.includes('orders'), 'db tables')
assert(notes.includes('爬虫：就绪'), 'crawler ready')
assert(formatReconNotesBlock(notes).includes('【侦察摘要'), 'format keeps header')
assert(formatReconNotesBlock('') === '', 'empty stays empty')

console.log('smoke-recon-notes: ok')
