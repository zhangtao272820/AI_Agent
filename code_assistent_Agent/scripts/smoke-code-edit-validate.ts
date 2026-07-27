/**
 * C1-4：edit validate 链 smoke（离线）
 */
import { shouldAutoValidateAfterEdit } from '../server/utils/editValidatePolicy'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(
  shouldAutoValidateAfterEdit({
    sawWriteLikeTool: true,
    sawValidateTool: false,
    autoValidateAfterWrite: true,
    taskKind: 'edit',
    editValidateRequired: true,
  }),
  'auto validate when write + autoValidateAfterWrite',
)

assert(
  shouldAutoValidateAfterEdit({
    sawWriteLikeTool: true,
    sawValidateTool: false,
    autoValidateAfterWrite: false,
    taskKind: 'edit',
    editValidateRequired: true,
  }),
  'edit validate required even if autoValidateAfterWrite off',
)

assert(
  !shouldAutoValidateAfterEdit({
    sawWriteLikeTool: false,
    sawValidateTool: false,
    autoValidateAfterWrite: true,
    taskKind: 'edit',
    editValidateRequired: true,
  }),
  'no write -> no auto validate',
)

assert(
  !shouldAutoValidateAfterEdit({
    sawWriteLikeTool: true,
    sawValidateTool: true,
    autoValidateAfterWrite: true,
    taskKind: 'edit',
    editValidateRequired: true,
  }),
  'already validated -> skip',
)

console.log('smoke-code-edit-validate: PASS')
