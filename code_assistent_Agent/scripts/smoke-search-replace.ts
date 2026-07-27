/**
 * P2-B2：SEARCH/REPLACE smoke
 */
import { applySearchReplaceOrThrow, parseSearchReplaceDocument } from '../server/utils/applySearchReplace'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const blocks = `<<<<<<< SEARCH
const x = 1
=======
const x = 2
>>>>>>> REPLACE`

const out = applySearchReplaceOrThrow('const x = 1\n', blocks, 'demo.ts')
assert(out === 'const x = 2\n', 'single replace')

const multi = parseSearchReplaceDocument(`src/a.ts
<<<<<<< SEARCH
foo()
=======
bar()
>>>>>>> REPLACE`)
assert(multi.length === 1 && multi[0]!.path === 'src/a.ts', 'path prefix parse')

try {
  applySearchReplaceOrThrow('other', blocks, 'demo.ts')
  throw new Error('should fail on mismatch')
} catch (e: unknown) {
  assert(String((e as Error).message).includes('not found'), 'mismatch throws')
}

console.log('smoke-search-replace: PASS')
