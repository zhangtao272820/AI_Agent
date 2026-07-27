/**
 * 拆分模块导出 smoke：捕获 tools/sql/direct 迁移后缺失 import 的回归。
 */
import { extractPersonName } from '../utils/tools/maskPhone.ts'
import { loadTableComments } from '../utils/sql/direct/answerFormat.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(typeof extractPersonName === 'function', 'extractPersonName exported')
assert(extractPersonName('张三的年龄') === '张三' || extractPersonName('张三的年龄') === null, 'extractPersonName runs')
assert(typeof loadTableComments === 'function', 'loadTableComments exported')

console.log('smoke-split-exports: OK')
