<script setup lang="ts">
import type { SessionHistoryItem } from '~/composables/managerChatTypes'

defineProps<{
  open: boolean
  backdropVisible: boolean
  sessionId: string
  items: SessionHistoryItem[]
  formatHistoryTime: (iso: string) => string
}>()

const emit = defineEmits<{
  closeBackdrop: []
  newSession: []
  select: [id: string]
  rename: [item: SessionHistoryItem]
  delete: [id: string]
}>()
</script>

<template>
  <div
    v-if="open && backdropVisible"
    class="spring-history-backdrop"
    @click="emit('closeBackdrop')"
  />
  <aside class="spring-history-sidebar" :class="{ collapsed: !open }" aria-label="历史会话">
    <div class="spring-history-head">
      <span class="spring-history-title">历史会话</span>
      <button type="button" class="spring-btn alt spring-btn-xs" @click="emit('newSession')">新会话</button>
    </div>
    <div v-if="!items.length" class="spring-history-empty">暂无历史记录，发送消息后会自动保存。</div>
    <ul v-else class="spring-history-list">
      <li
        v-for="item in items"
        :key="item.id"
        class="spring-history-row"
        :class="{ active: item.id === sessionId }"
      >
        <button type="button" class="spring-history-item" :title="item.title" @click="emit('select', item.id)">
          <span class="spring-history-item-title">{{ item.title }}</span>
          <span class="spring-history-item-meta">{{ formatHistoryTime(item.updatedAt) }} · {{ item.userMessageCount }} 轮</span>
        </button>
        <div class="spring-history-item-actions">
          <button type="button" class="spring-history-action-btn" title="重命名" @click.stop="emit('rename', item)">
            重命名
          </button>
          <button type="button" class="spring-history-action-btn danger" title="删除" @click.stop="emit('delete', item.id)">
            删除
          </button>
        </div>
      </li>
    </ul>
  </aside>
</template>
