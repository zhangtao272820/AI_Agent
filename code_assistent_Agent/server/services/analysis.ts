import path from 'node:path'
import { createRequire } from 'node:module'
import { readText } from '../utils/files'
import { parse } from '@typescript-eslint/typescript-estree'

export function extractScriptFromVue(text: string) {
  const m = text.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
  if (m && m[1]) return m[1]
  return text
}

type ExplainInfo = {
  exports: string[]
  hasDefault: boolean
  imports: string[]
}

async function loadTs() {
  const require = createRequire(import.meta.url)
  const mod = require('typescript')
  return (mod as any)?.default ?? mod
}

function uniqueSorted(items: string[]) {
  return Array.from(new Set(items.filter((s) => typeof s === 'string' && s.trim()))).sort((a, b) => a.localeCompare(b))
}

function toScriptKind(ts: any, fileName?: string) {
  const name = String(fileName || '').toLowerCase()
  if (name.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (name.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

export async function explainWithTsAst(params: { text: string; fileName?: string }): Promise<ExplainInfo> {
  const ts = await loadTs()
  const src = extractScriptFromVue(params.text)
  const fileName = params.fileName || 'input.ts'
  const sourceFile = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, toScriptKind(ts, fileName))

  const imports: string[] = []
  const exports: string[] = []
  let hasDefault = false

  const addExportName = (name: unknown) => {
    if (typeof name === 'string' && name.trim()) exports.push(name)
  }

  const addModuleImport = (spec: unknown) => {
    if (typeof spec === 'string' && spec.trim()) imports.push(spec)
  }

  const collectBindingNames = (binding: any) => {
    if (!binding) return
    if (ts.isIdentifier(binding)) {
      addExportName(binding.text)
      return
    }
    if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
      for (const el of binding.elements ?? []) {
        if (el && ts.isBindingElement(el) && el.name) collectBindingNames(el.name)
      }
    }
  }

  const visit = (node: any) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addModuleImport(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addModuleImport(node.moduleSpecifier.text)
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const e of node.exportClause.elements) {
          addExportName((e.name && e.name.text) || '')
        }
      }
    }
    if (ts.isExportAssignment(node)) {
      hasDefault = true
    }
    if (ts.isExportSpecifier(node)) {
      addExportName(node.name?.text)
    }
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (Array.isArray(node.modifiers) && node.modifiers.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (Array.isArray(node.modifiers) && node.modifiers.some((m: any) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
          hasDefault = true
        }
        if (node.name?.text) addExportName(node.name.text)
      }
    }
    if (ts.isVariableStatement(node)) {
      const isExported =
        Array.isArray(node.modifiers) && node.modifiers.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (isExported) {
        for (const decl of node.declarationList.declarations ?? []) {
          collectBindingNames(decl.name)
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const arg0 = node.arguments?.[0]
        if (arg0 && ts.isStringLiteral(arg0)) addModuleImport(arg0.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return {
    exports: uniqueSorted(exports),
    hasDefault,
    imports: uniqueSorted(imports)
  }
}

export function computeSimpleMetrics(text: string) {
  const src = extractScriptFromVue(text)
  const lines = src.split(/\r?\n/)
  const loc = lines.length
  const functionMatches = src.match(/\bfunction\b|=>/g) ?? []
  const classMatches = src.match(/\bclass\s+\w+/g) ?? []
  const ifLike = src.match(/\b(if|else if|switch|case|for|while|catch)\b/g) ?? []
  const logicalOps = src.match(/(&&)|(\|\|)/g) ?? []
  const importCount = (src.match(/\bimport\s.*?from\b|require\(/g) ?? []).length
  const anyType = (src.match(/:\s*any\b/g) ?? []).length
  const todos = (src.match(/TODO|FIXME/gi) ?? []).length
  return {
    loc,
    functions: functionMatches.length,
    classes: classMatches.length,
    branches: ifLike.length,
    logicalOps: logicalOps.length,
    importCount,
    anyType,
    todos
  }
}

export function detectSmells(text: string) {
  const src = extractScriptFromVue(text)
  const smells: Array<{ kind: string; detail: string; hint: string }> = []
  const longLines = src.split(/\r?\n/).filter((l) => l.length > 120).length
  if (longLines > 10) {
    smells.push({
      kind: 'long-lines',
      detail: `存在 ${longLines} 行超过 120 字符`,
      hint: '考虑折行、提取变量或函数'
    })
  }
  const nestedBlocks = (src.match(/\{[^{}]*\{[^{}]*\{[^{}]*\{/g) ?? []).length
  if (nestedBlocks > 0) {
    smells.push({
      kind: 'deep-nesting',
      detail: '检测到>=4层花括号嵌套的代码块',
      hint: '通过提前返回、拆分函数降低嵌套'
    })
  }
  if (/Vue|<template[\s>]/.test(text) && !/defineProps|defineEmits/.test(src)) {
    smells.push({
      kind: 'vue-setup-missing',
      detail: '可能是 Vue 组件但未发现 defineProps/defineEmits',
      hint: '建议使用 <script setup> + defineProps/defineEmits'
    })
  }
  if (/console\.log\(/.test(src)) {
    smells.push({
      kind: 'console-log',
      detail: '包含 console.log 调试语句',
      hint: '上线前移除或用可控日志'
    })
  }
  return smells
}

export function detectBugs(text: string) {
  const src = extractScriptFromVue(text)
  const issues: Array<{ rule: string; detail: string; severity: 'low' | 'medium' | 'high' }> = []
  if (/==[^=]/.test(src)) {
    issues.push({
      rule: 'eqeqeq',
      detail: '发现非全等比较（== 或 !=）',
      severity: 'low'
    })
  }
  if (/\beval\(/.test(src) || /\bnew Function\(/.test(src)) {
    issues.push({
      rule: 'no-eval',
      detail: '使用 eval/new Function 存在安全风险',
      severity: 'high'
    })
  }
  if (/\brequire\(['"]child_process['"]\)/.test(src)) {
    issues.push({
      rule: 'no-child-process',
      detail: '使用 child_process 需验证输入来源与沙箱',
      severity: 'medium'
    })
  }
  if (/\bvar\b/.test(src)) {
    issues.push({
      rule: 'no-var',
      detail: '检测到 var 声明，建议改为 let/const',
      severity: 'low'
    })
  }
  return issues
}

export function simpleExplain(text: string) {
  const src = extractScriptFromVue(text)
  const exports = Array.from(src.matchAll(/export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g)).map(
    (m) => m[1]
  )
  const hasDefault = /export\s+default/.test(src)
  const imports = Array.from(src.matchAll(/\bimport\s+(?:.+?)\s+from\s+['"](.+?)['"]/g)).map(
    (m) => m[1]
  )
  return {
    exports,
    hasDefault,
    imports
  }
}

export async function explainCode(text: string, fileName?: string) {
  try {
    return await explainWithTsAst({ text, fileName })
  } catch {
    return simpleExplain(text)
  }
}

export function astAnalyze(text: string, fileName?: string) {
  const src = extractScriptFromVue(text)

  try {
    const ast = parse(src, {
      loc: true,
      range: true,
      tokens: false,
      comment: false,
      jsx: fileName?.endsWith('.tsx') || fileName?.endsWith('.jsx') || fileName?.endsWith('.vue')
    })

    const functions: any[] = []
    const classes: any[] = []
    const variables: any[] = []

    const traverse = (node: any) => {
      if (!node || typeof node !== 'object') return

      if (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
        functions.push({
          name: node.id?.name || 'anonymous',
          loc: node.loc,
          type: node.type
        })
      }

      if (node.type === 'ClassDeclaration') {
        classes.push({
          name: node.id?.name || 'anonymous',
          loc: node.loc
        })
      }

      if (node.type === 'VariableDeclarator') {
        if (node.id.type === 'Identifier') {
          variables.push({
            name: node.id.name,
            loc: node.loc
          })
        }
      }

      for (const key in node) {
        const child = node[key]
        if (Array.isArray(child)) {
          child.forEach(traverse)
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child)
        }
      }
    }

    traverse(ast)

    return {
      success: true,
      functions,
      classes,
      variables,
      nodeCount: Object.keys(ast).length // rough estimate
    }
  } catch (e: any) {
    return {
      success: false,
      error: e.message
    }
  }
}

export async function generateTestScaffold(
  pathLike: string,
  maxChars: number,
  pkgJsonText: string,
  rootOverride?: string
) {
  let framework: 'vitest' | 'jest' = 'vitest'
  try {
    const pkg = JSON.parse(pkgJsonText)
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    if (deps.jest) framework = 'jest'
    if (deps.vitest) framework = 'vitest'
  } catch {}
  const _content = await readText(pathLike, maxChars, rootOverride)
  const baseName = path.basename(pathLike)
  const testName = baseName.replace(/\.(ts|js|vue)$/i, '')
  const isVue = /\.vue$/i.test(pathLike)
  const body =
    framework === 'vitest'
      ? `import { describe, it, expect } from 'vitest'
${isVue ? "import { mount } from '@vue/test-utils'\n" : ''}
describe('${testName}', () => {
  it('should work', async () => {
    ${isVue ? "// const wrapper = mount(Component)\n// expect(wrapper.exists()).toBe(true)" : '// TODO: 调用导出的函数，并断言结果'}
    expect(true).toBe(true)
  })
})
`
      : `/* eslint-env jest */
${isVue ? "const { mount } = require('@vue/test-utils')\n" : ''}
describe('${testName}', () => {
  test('should work', async () => {
    ${isVue ? "// const wrapper = mount(Component)\n// expect(wrapper.exists()).toBe(true)" : '// TODO: 调用导出的函数，并断言结果'}
    expect(true).toBe(true)
  })
})
`
  return { framework, content: body }
}
