/**
 * P2-1：Excel 解析入库结构回归（不调用向量库 / LLM）
 */
import * as XLSX from 'xlsx'
import { parseSpreadsheetBuffer, spreadsheetKind } from '../server/utils/spreadsheet_parse'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(spreadsheetKind('report.xlsx') === 'xlsx', 'xlsx extension')
assert(spreadsheetKind('legacy.xls') === 'xls', 'xls extension')
assert(spreadsheetKind('notes.pdf') === null, 'non-spreadsheet')

const wb = XLSX.utils.book_new()
const sheet = XLSX.utils.aoa_to_sheet([
  ['区域', '销售额'],
  ['华东', 120],
  ['华南', 80]
])
XLSX.utils.book_append_sheet(wb, sheet, '销售')
const xbuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
const parsed = parseSpreadsheetBuffer(xbuf, 'report.xlsx')
assert(parsed.includes('华东') && parsed.includes('120'), 'spreadsheet text parse')
assert(parsed.includes('## Sheet: 销售'), 'sheet heading')

console.log('smoke: spreadsheet ok')
