/**
 * edit 任务自动 validate 策略（C1-4）
 */
export function shouldAutoValidateAfterEdit(input: {
  sawWriteLikeTool: boolean
  sawValidateTool: boolean
  autoValidateAfterWrite: boolean
  taskKind: string
  editValidateRequired: boolean
}): boolean {
  if (!input.sawWriteLikeTool || input.sawValidateTool) return false
  if (input.autoValidateAfterWrite) return true
  return input.taskKind === 'edit' && input.editValidateRequired
}
