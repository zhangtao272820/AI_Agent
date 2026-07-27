<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      role="presentation"
      @click.self="onBackdropClick"
    >
      <div
        class="relative w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur"
        role="dialog"
        :aria-labelledby="titleId"
        aria-modal="true"
      >
        <header class="px-4 py-3 border-b border-white/10">
          <h3 :id="titleId" class="text-sm font-semibold text-slate-100">{{ title }}</h3>
        </header>
        <div class="px-4 py-3">
          <p v-if="message" class="text-sm text-slate-300 whitespace-pre-wrap">{{ message }}</p>
          <input
            v-if="mode === 'prompt'"
            v-model="localInput"
            type="text"
            class="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            :placeholder="inputPlaceholder"
            :maxlength="inputMaxLength"
            @keydown.enter.prevent="onConfirm"
          />
        </div>
        <footer class="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          <button
            v-if="mode === 'confirm' || mode === 'prompt'"
            type="button"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            @click="onCancel"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-sky-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400"
            @click="onConfirm"
          >
            {{ confirmText }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'alert' },
  title: { type: String, default: '提示' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  inputValue: { type: String, default: '' },
  inputPlaceholder: { type: String, default: '' },
  inputMaxLength: { type: Number, default: 80 },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

const localInput = ref('');
const titleId = computed(() => `rag-modal-title-${Math.random().toString(36).slice(2, 8)}`);

watch(
  () => props.modelValue,
  (open) => {
    if (open && props.mode === 'prompt') localInput.value = props.inputValue || '';
  }
);

function close() {
  emit('update:modelValue', false);
}

function onConfirm() {
  emit('confirm', props.mode === 'prompt' ? localInput.value : undefined);
  close();
}

function onCancel() {
  emit('cancel');
  close();
}

function onBackdropClick() {
  if (props.mode === 'alert') onConfirm();
  else onCancel();
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.modelValue) {
    if (props.mode === 'alert') onConfirm();
    else onCancel();
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (typeof window === 'undefined') return;
    if (open) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  }
);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
});
</script>
