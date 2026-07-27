/**
 * P3 · validate 诊断解析 smoke
 */
import {
  parseTypecheckDiagnostics,
  buildValidateRecoverHint,
} from '../server/utils/validateDiagnostics'
import { formatEditPlanBlock } from '../server/utils/codeArchitectShared'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const sample = `server/utils/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.`
const diags = parseTypecheckDiagnostics(sample)
assert(diags.length === 1, 'parse tsc line')
assert(diags[0]?.file === 'server/utils/foo.ts', 'file')
assert(diags[0]?.line === 12, 'line')

const hint = buildValidateRecoverHint({
  ok: false,
  results: [{ script: 'typecheck', ok: false, output: sample }],
})
assert(hint.includes('TS2322'), 'recover hint has code')

const block = formatEditPlanBlock({
  summary: '改 foo',
  steps: ['读文件', 'patch', 'validate'],
  target_files: ['server/utils/foo.ts'],
})
assert(block.includes('Architect'), 'plan block')

console.log('smoke-validate-diagnostics: PASS')
