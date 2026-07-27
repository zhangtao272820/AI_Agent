<template>
  <div ref="el" class="mono"></div>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

const props = defineProps<{ modelValue: string; path?: string; readOnly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const el = ref<HTMLElement>()
let editor: any
let monaco: any
let applyingFromProps = false

function getOrCreateModel(path: string, value: string) {
  const uri = monaco.Uri.parse(`file:///${path.replace(/\\/g, '/')}`)
  let model = monaco.editor.getModel(uri)
  if (model) {
    if (model.getValue() !== value) {
      model.setValue(value)
    }
    return model
  }
  model = monaco.editor.createModel(value, toLang(path), uri)
  return model
}

function toLang(p?: string) {
  if (!p) return 'plaintext'
  const m = p.toLowerCase()
  if (m.endsWith('.ts')) return 'typescript'
  if (m.endsWith('.tsx')) return 'typescript'
  if (m.endsWith('.js')) return 'javascript'
  if (m.endsWith('.jsx')) return 'javascript'
  if (m.endsWith('.vue')) return 'html'
  if (m.endsWith('.json')) return 'json'
  if (m.endsWith('.css')) return 'css'
  if (m.endsWith('.scss')) return 'scss'
  if (m.endsWith('.less')) return 'less'
  if (m.endsWith('.html')) return 'html'
  if (m.endsWith('.md')) return 'markdown'
  if (m.endsWith('.py')) return 'python'
  if (m.endsWith('.go')) return 'go'
  if (m.endsWith('.rs')) return 'rust'
  if (m.endsWith('.sh')) return 'shell'
  if (m.endsWith('.yaml') || m.endsWith('.yml')) return 'yaml'
  if (m.endsWith('.sql')) return 'sql'
  return 'plaintext'
}
onMounted(async () => {
  // 手动配置 Monaco 环境，在 import 之前设置，避免依赖不稳定的 Vite 插件
  // 使用 Vite 的 ?worker 导入是目前在 Nuxt 3 中加载 Monaco Worker 最可靠的方式
  window.MonacoEnvironment = {
    getWorker(_: any, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    }
  }

  monaco = await import('monaco-editor')

  if (monaco?.languages?.typescript?.typescriptDefaults) {
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true)
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false
    })
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      typeRoots: ['node_modules/@types'],
      jsx: monaco.languages.typescript.JsxEmit.React,
      allowJs: true,
      checkJs: true,
      lib: ['esnext', 'dom']
    })
  }

  monaco.editor.defineTheme('transparent-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#00000000',
      'editor.lineHighlightBackground': '#ffffff10',
      'editorGutter.background': '#00000000',
      'editor.selectionBackground': '#444cf740',
      'editor.inactiveSelectionBackground': '#444cf720'
    }
  })

  const initialModel = getOrCreateModel(props.path || 'temp.txt', props.modelValue ?? '')

  editor = monaco.editor.create(el.value!, {
    model: initialModel,
    readOnly: props.readOnly ?? false,
    theme: 'transparent-dark',
    minimap: { enabled: true, side: 'right', scale: 1 },
    automaticLayout: true,
    wordWrap: 'on',
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: 20,
    letterSpacing: 0.2,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    tabSize: 2,
    insertSpaces: true,
    suggest: {
      showMethods: true,
      showFunctions: true,
      showConstructors: true,
      showFields: true,
      showVariables: true,
      showClasses: true,
      showStructs: true,
      showInterfaces: true,
      showModules: true,
      showProperties: true,
      showEvents: true,
      showOperators: true,
      showUnits: true,
      showValues: true,
      showConstants: true,
      showEnums: true,
      showEnumMembers: true,
      showKeywords: true,
      showWords: true,
      showColors: true,
      showFiles: true,
      showReferences: true,
      showFolders: true,
      showTypeParameters: true,
      showSnippets: true,
    },
    parameterHints: { enabled: true },
    folding: true,
    links: true,
    codeLens: true,
    colorDecorators: true,
    contextmenu: true,
    quickSuggestions: { other: true, comments: true, strings: true },
    acceptSuggestionOnEnter: 'on'
  })

  editor.onDidChangeModelContent(() => {
    if (applyingFromProps) return
    emit('update:modelValue', editor.getValue())
  })
})
watch(
  () => [props.modelValue, props.path, props.readOnly],
  () => {
    if (editor) {
      const next = props.modelValue ?? ''
      const cur = editor.getValue()
      const path = props.path || 'temp.txt'
      const model = getOrCreateModel(path, next)
      
      if (editor.getModel() !== model) {
        editor.setModel(model)
      } else if (next !== cur) {
        applyingFromProps = true
        model.setValue(next)
        applyingFromProps = false
      }

      editor.updateOptions({ readOnly: props.readOnly ?? false })
    }
  }
)
onBeforeUnmount(() => {
  if (editor) editor.dispose()
})
</script>
<style scoped>
.mono {
  width: 100%;
  height: 100%;
}
</style>
