import { isSemanticConsolidationEnabled } from '../shared/semanticConsolidationJob'
import { sanitizeUserId } from '../shared/userSessionMapStore'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(typeof sanitizeUserId('user_1') === 'string', 'sanitizeUserId')
assert(isSemanticConsolidationEnabled(), 'semantic consolidation enabled by default')
console.log('smoke: phase6 ok')
