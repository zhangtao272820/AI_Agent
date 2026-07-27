<template>
  <div class="tree">
    <div class="toolbar">
      <input class="input" v-model="filter" placeholder="筛选扩展名: ts,vue,js" />
      <button class="btn" @click="load">刷新</button>
    </div>
    <div class="list">
      <div v-if="loading" class="status">加载中…</div>
      <div v-else-if="loadError" class="status err">{{ loadError }}</div>
      <div v-else-if="!visibleNodes.length" class="status">
        <div>无文件</div>
        <div v-if="resolvedRoot" class="statusHint mono">服务端根：{{ resolvedRoot }}</div>
        <div class="statusHint">
          Docker 下请用容器路径（如 /workspace），不要填 Windows 盘符；可清空根目录后点「应用」再用默认根。
        </div>
      </div>
      <div v-else class="nodes">
        <div
          v-for="n in visibleNodes"
          :key="n.key"
          class="item"
          :class="{
            active: n.kind === 'file' && n.path === modelValue,
            dirActive: n.kind === 'dir' && n.path === selectedDir,
          }"
          :style="{ paddingLeft: `${8 + n.depth * 14}px` }"
          @click="onClickNode(n)"
        >
          <span class="twisty" :class="{ hidden: n.kind === 'file' }">
            {{ n.kind === 'dir' ? (isExpanded(n.path) ? '▾' : '▸') : '' }}
          </span>
          <span v-if="n.kind === 'file' && n.git" class="git" :class="gitClass(n.git)">{{ n.git }}</span>
          <span class="label" :class="{ dir: n.kind === 'dir' }">{{ n.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
type VisibleNode = {
  key: string
  kind: 'dir' | 'file'
  name: string
  path: string
  depth: number
  hasChildren?: boolean
  git?: string
}

type TreeNode = {
  kind: 'dir' | 'file'
  name: string
  path: string
  children?: Map<string, TreeNode>
}

const props = defineProps<{
  modelValue?: string
  root?: string
  refreshKey?: number
  selectedDir?: string
}>()
const emit = defineEmits(['update:modelValue', 'open', 'select-dir'])
const files = ref<string[]>([])
const filter = ref('')
const loading = ref(false)
const loadError = ref('')
const resolvedRoot = ref('')
const expanded = ref<Record<string, boolean>>({})
const gitStatuses = ref<Record<string, string>>({})

function storageKey() {
  return `agent:fileTree:expanded:${props.root || ''}:${filter.value || ''}`
}

function loadExpanded() {
  try {
    const raw = localStorage.getItem(storageKey())
    expanded.value = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    expanded.value = {}
  }
}

function saveExpanded() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(expanded.value))
  } catch {}
}

function isExpanded(dirPath: string) {
  return expanded.value[dirPath] ?? false
}

function setExpanded(dirPath: string, value: boolean) {
  expanded.value = { ...expanded.value, [dirPath]: value }
  saveExpanded()
}

function ensureParentsExpanded(filePath: string) {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return
  let cur = ''
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!
    cur = cur ? `${cur}/${seg}` : seg
    expanded.value[cur] = true
  }
  expanded.value = { ...expanded.value }
  saveExpanded()
}

function buildTree(list: string[]) {
  const root: TreeNode = { kind: 'dir', name: '', path: '', children: new Map() }
  for (const p of list) {
    const parts = p.split('/').filter(Boolean)
    let node = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      acc = acc ? `${acc}/${name}` : name
      if (!node.children) node.children = new Map()
      const isLeaf = i === parts.length - 1
      const kind: TreeNode['kind'] = isLeaf ? 'file' : 'dir'
      const existing = node.children.get(name)
      if (existing) {
        node = existing
        continue
      }
      const next: TreeNode = kind === 'dir' ? { kind, name, path: acc, children: new Map() } : { kind, name, path: acc }
      node.children.set(name, next)
      node = next
    }
  }
  return root
}

function sortChildren(children: Iterable<TreeNode>) {
  const arr = Array.from(children)
  arr.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return arr
}

const tree = computed(() => buildTree(files.value))

const visibleNodes = computed<VisibleNode[]>(() => {
  const out: VisibleNode[] = []
  const walk = (node: TreeNode, depth: number) => {
    const kids = node.children ? sortChildren(node.children.values()) : []
    for (const child of kids) {
      if (child.kind === 'dir') {
        const hasChildren = !!child.children && child.children.size > 0
        out.push({
          key: `d:${child.path}`,
          kind: 'dir',
          name: child.name,
          path: child.path,
          depth,
          hasChildren
        })
        if (hasChildren && isExpanded(child.path)) {
          walk(child, depth + 1)
        }
      } else {
        out.push({
          key: `f:${child.path}`,
          kind: 'file',
          name: child.name,
          path: child.path,
          depth,
          git: gitStatuses.value[child.path]
        })
      }
    }
  }
  walk(tree.value, 0)
  return out
})

function gitClass(code: string) {
  const c = String(code || '').trim()
  if (c.includes('?')) return 'new'
  if (c.includes('D')) return 'del'
  if (c.includes('U')) return 'conflict'
  if (c.includes('A')) return 'add'
  if (c.includes('M') || c.includes('R') || c.includes('C')) return 'mod'
  return 'other'
}

function onClickNode(n: VisibleNode) {
  if (n.kind === 'dir') {
    emit('select-dir', n.path)
    if (!n.hasChildren) return
    setExpanded(n.path, !isExpanded(n.path))
    return
  }
  emit('update:modelValue', n.path)
}

async function load() {
  loading.value = true
  loadError.value = ''
  const exts = filter.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',')
  try {
    const token = localStorage.getItem('agentJwt') || ''
    const res = await $fetch<{ files: string[]; root?: string; defaultRoot?: string }>('/api/files', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      query: { list: '1', exts, root: props.root, maxFiles: 1000 }
    })
    files.value = res.files
    resolvedRoot.value = String(res.root || res.defaultRoot || '')
    const git = await $fetch<{ isRepo: boolean; statuses: Record<string, string> }>('/api/git-status', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      query: { root: props.root }
    }).catch(() => ({ isRepo: false, statuses: {} }))
    gitStatuses.value = git?.statuses || {}
  } catch (e: any) {
    files.value = []
    resolvedRoot.value = ''
    loadError.value = e?.data?.statusMessage || e?.message || '加载文件列表失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadExpanded()
  load()
})

watch(
  () => props.root,
  () => {
    loadExpanded()
    load()
  }
)

watch(
  () => props.refreshKey,
  () => {
    load()
  }
)

watch(
  () => filter.value,
  () => {
    loadExpanded()
  }
)

watch(
  () => props.modelValue,
  (p) => {
    if (p) ensureParentsExpanded(p)
  },
  { immediate: true }
)
</script>
<style scoped>
.tree {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}
.toolbar {
  display: flex;
  gap: 8px;
  padding: 10px 10px 8px;
}
.input {
  flex: 1;
  background: rgba(244, 246, 255, 0.06);
  color: rgba(244, 246, 255, 0.94);
  border: 1px solid rgba(244, 246, 255, 0.14);
  border-radius: 12px;
  padding: 8px 10px;
  outline: none;
}
.btn {
  background: rgba(164, 179, 255, 0.12);
  color: rgba(244, 246, 255, 0.94);
  border: 1px solid rgba(164, 179, 255, 0.30);
  border-radius: 12px;
  padding: 8px 10px;
  cursor: pointer;
}
.list {
  overflow: auto;
  padding: 8px 10px 12px;
}
.status {
  font-size: 12px;
  opacity: 0.75;
  padding: 6px 8px;
}
.status.err {
  opacity: 0.95;
  color: #ffb4b4;
  white-space: pre-wrap;
}
.statusHint {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.8;
  line-height: 1.4;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}
.item {
  font-size: 12px;
  padding: 6px 8px 6px 8px;
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.2;
}
.item:hover {
  background: rgba(244, 246, 255, 0.06);
}
.item.active {
  background: rgba(164, 179, 255, 0.12);
  border: 1px solid rgba(164, 179, 255, 0.30);
}
.item.dirActive {
  background: rgba(120, 200, 160, 0.10);
  border: 1px solid rgba(120, 200, 160, 0.28);
}
.twisty {
  width: 14px;
  opacity: 0.85;
  text-align: center;
  flex: 0 0 14px;
}
.twisty.hidden {
  opacity: 0;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label.dir {
  opacity: 0.95;
}
.git {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid rgba(244, 246, 255, 0.18);
  background: rgba(244, 246, 255, 0.06);
  opacity: 0.9;
}
.git.mod {
  border-color: rgba(255, 205, 121, 0.35);
  background: rgba(255, 205, 121, 0.10);
}
.git.add,
.git.new {
  border-color: rgba(106, 255, 190, 0.35);
  background: rgba(106, 255, 190, 0.10);
}
.git.del {
  border-color: rgba(255, 124, 164, 0.35);
  background: rgba(255, 124, 164, 0.10);
}
.git.conflict {
  border-color: rgba(255, 124, 164, 0.45);
  background: rgba(255, 124, 164, 0.14);
}
</style>
