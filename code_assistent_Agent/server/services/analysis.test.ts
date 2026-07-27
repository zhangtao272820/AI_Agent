import { describe, expect, it } from 'vitest'
import { computeSimpleMetrics, detectBugs, simpleExplain, extractScriptFromVue, explainWithTsAst } from './analysis'

describe('analysis', () => {
  it('extractScriptFromVue extracts script content', () => {
    const text = `<template><div /></template>
<script setup lang="ts">
export const x = 1
</script>`
    expect(extractScriptFromVue(text).trim()).toContain('export const x = 1')
  })

  it('computeSimpleMetrics counts basic metrics', () => {
    const text = `<template><div /></template>
<script setup lang="ts">
import a from 'b'
export const x = 1
function f() { return 1 }
const g = () => 2
if (x == 1) { }
for (let i = 0; i < 1; i++) { }
const v: any = 1
// TODO: later
</script>`
    const m = computeSimpleMetrics(text)
    expect(m.importCount).toBe(1)
    expect(m.anyType).toBe(1)
    expect(m.todos).toBe(1)
    expect(m.functions).toBeGreaterThanOrEqual(2)
    expect(m.branches).toBeGreaterThanOrEqual(2)
  })

  it('detectBugs flags risky patterns', () => {
    const src = `
const a = 1
if (a == 1) { }
var x = 1
eval('1')
`
    const issues = detectBugs(src)
    const rules = issues.map((i) => i.rule).sort()
    expect(rules).toEqual(['eqeqeq', 'no-eval', 'no-var'].sort())
    expect(issues.find((i) => i.rule === 'no-eval')?.severity).toBe('high')
  })

  it('simpleExplain extracts imports and exports', () => {
    const src = `
import z from 'k'
export const foo = 1
export function bar() { return foo }
export default function baz() { return 1 }
`
    const ex = simpleExplain(src)
    expect(ex.imports).toEqual(['k'])
    expect(ex.hasDefault).toBe(true)
    expect(ex.exports).toEqual(expect.arrayContaining(['foo', 'bar', 'baz']))
  })

  it('explainWithTsAst handles export lists and re-exports', async () => {
    const src = `
import z from 'k'
import type { T } from 'types'
export { z }
export { a as b } from 'mod'
export const foo = 1
export default 123
const cjs = require('cjs')
`
    const ex = await explainWithTsAst({ text: src, fileName: 'x.ts' })
    expect(ex.imports).toEqual(expect.arrayContaining(['k', 'types', 'mod', 'cjs']))
    expect(ex.hasDefault).toBe(true)
    expect(ex.exports).toEqual(expect.arrayContaining(['z', 'b', 'foo']))
  })
})
