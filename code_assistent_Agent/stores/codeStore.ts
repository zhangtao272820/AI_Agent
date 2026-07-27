import { defineStore } from 'pinia'

export const useCodeStore = defineStore('code', () => {
  const rootPath = ref<string>('')
  const currentPath = ref<string | undefined>()
  const currentCode = ref<string>('')
  const currentMeta = ref<{ sha256: string; bytes: number } | null>(null)
  const loading = ref(false)
  const lastError = ref<string>('')

  function setRoot(path: string) {
    rootPath.value = path
  }

  async function loadFile(p: string | undefined) {
    currentPath.value = p
    currentCode.value = ''
    currentMeta.value = null
    lastError.value = ''
    if (!p) return
    loading.value = true
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('agentJwt') || '' : ''
      const res = await $fetch<{ content: string; meta?: { sha256: string; bytes: number } | null }>('/api/files', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        query: { path: p, maxChars: 200000, root: rootPath.value || undefined }
      })
      currentCode.value = res.content
      currentMeta.value = res.meta ?? null
    } catch (err: any) {
      lastError.value = err?.data?.statusMessage || err?.message || String(err)
    } finally {
      loading.value = false
    }
  }

  return {
    rootPath,
    currentPath,
    currentCode,
    currentMeta,
    loading,
    lastError,
    setRoot,
    loadFile
  }
})
