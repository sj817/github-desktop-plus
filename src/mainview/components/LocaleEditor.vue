<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { electroview } from "../electroview";
import type { LocaleEntry } from "../../shared/types";

const props = defineProps<{
  locale: string;
}>();

type Category = "menu" | "ui";

const activeCategory = ref<Category>("menu");
const entries = ref<LocaleEntry[]>([]);
const loading = ref(false);
const saving = ref(false);
const dirty = ref(false);
const searchQuery = ref("");
const newKey = ref("");
const newValue = ref("");

const categoryLabels: Record<Category, string> = {
  menu: "菜单翻译 (main process)",
  ui: "界面翻译 (renderer)",
};

async function loadEntries() {
  loading.value = true;
  try {
    const result = await electroview.rpc.request.getLocaleEntries({
      locale: props.locale,
      category: activeCategory.value,
    });
    entries.value = result;
    dirty.value = false;
  } catch (e) {
    console.error("Failed to load locale entries:", e);
  } finally {
    loading.value = false;
  }
}

async function saveEntries() {
  saving.value = true;
  try {
    const result = await electroview.rpc.request.saveLocaleEntries({
      locale: props.locale,
      category: activeCategory.value,
      entries: entries.value,
    });
    if (result.ok) {
      dirty.value = false;
    }
  } catch (e) {
    console.error("Failed to save locale entries:", e);
  } finally {
    saving.value = false;
  }
}

function updateEntry(index: number, field: "key" | "value", val: string) {
  entries.value[index] = { ...entries.value[index], [field]: val };
  dirty.value = true;
}

function removeEntry(index: number) {
  entries.value.splice(index, 1);
  dirty.value = true;
}

function addEntry() {
  if (!newKey.value.trim()) return;
  entries.value.push({
    key: newKey.value.trim(),
    value: newValue.value.trim(),
    category: activeCategory.value,
  });
  newKey.value = "";
  newValue.value = "";
  dirty.value = true;
}

const filteredEntries = ref<{ entry: LocaleEntry; index: number }[]>([]);
watch([entries, searchQuery], () => {
  const q = searchQuery.value.toLowerCase();
  filteredEntries.value = entries.value
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (!q) return true;
      return entry.key.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q);
    });
}, { immediate: true });

watch(activeCategory, () => {
  loadEntries();
});

watch(() => props.locale, () => {
  loadEntries();
});

onMounted(() => {
  loadEntries();
});
</script>

<template>
  <div class="locale-editor">
    <!-- Category tabs -->
    <div class="category-tabs">
      <button
        v-for="cat in (['menu', 'ui'] as Category[])"
        :key="cat"
        class="cat-tab"
        :class="{ active: activeCategory === cat }"
        @click="activeCategory = cat"
      >
        {{ categoryLabels[cat] }}
      </button>
    </div>

    <!-- Toolbar -->
    <div class="editor-toolbar">
      <input
        type="text"
        class="search-input"
        placeholder="搜索翻译条目..."
        v-model="searchQuery"
      />
      <span class="entry-count">{{ filteredEntries.length }} / {{ entries.length }} 条</span>
      <button
        v-if="dirty"
        class="btn btn-primary btn-sm"
        :disabled="saving"
        @click="saveEntries"
      >
        {{ saving ? "保存中..." : "💾 保存" }}
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="editor-loading">
      加载中...
    </div>

    <!-- Entries table -->
    <div v-else class="entries-table">
      <div class="table-header">
        <div class="col-key">英文 (Key)</div>
        <div class="col-value">中文 (Value)</div>
        <div class="col-actions"></div>
      </div>
      <div class="table-body">
        <div
          v-for="{ entry, index } in filteredEntries"
          :key="index"
          class="table-row"
        >
          <div class="col-key">
            <input
              type="text"
              class="cell-input"
              :value="entry.key"
              @input="updateEntry(index, 'key', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="col-value">
            <input
              type="text"
              class="cell-input"
              :value="entry.value"
              @input="updateEntry(index, 'value', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="col-actions">
            <button class="btn-icon-delete" @click="removeEntry(index)" title="删除">✕</button>
          </div>
        </div>

        <!-- Add new entry row -->
        <div class="table-row add-row">
          <div class="col-key">
            <input
              type="text"
              class="cell-input"
              placeholder="新英文文本..."
              v-model="newKey"
              @keydown.enter="addEntry"
            />
          </div>
          <div class="col-value">
            <input
              type="text"
              class="cell-input"
              placeholder="对应中文翻译..."
              v-model="newValue"
              @keydown.enter="addEntry"
            />
          </div>
          <div class="col-actions">
            <button class="btn-icon-add" @click="addEntry" :disabled="!newKey.trim()">+</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.locale-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.category-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}

.cat-tab {
  padding: 6px 16px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.cat-tab:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.cat-tab.active {
  background: var(--bg-secondary);
  color: var(--accent);
  border-color: var(--border);
}

.editor-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-input {
  flex: 1;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent);
}

.entry-count {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.editor-loading {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary);
}

.entries-table {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.table-header {
  display: flex;
  background: var(--bg-tertiary);
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table-body {
  max-height: 400px;
  overflow-y: auto;
}

.table-row {
  display: flex;
  border-bottom: 1px solid var(--border);
  align-items: center;
  padding: 2px 12px;
}

.table-row:last-child {
  border-bottom: none;
}

.table-row:hover {
  background: rgba(88, 166, 255, 0.03);
}

.add-row {
  background: rgba(35, 134, 54, 0.05);
}

.col-key {
  flex: 1;
  min-width: 0;
}

.col-value {
  flex: 1;
  min-width: 0;
}

.col-actions {
  width: 36px;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}

.cell-input {
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.cell-input:focus {
  border-color: var(--accent);
  background: var(--bg-secondary);
}

.cell-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.btn-icon-delete {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon-delete:hover {
  background: rgba(248, 81, 73, 0.15);
  color: var(--red);
}

.btn-icon-add {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--green);
  cursor: pointer;
  border-radius: 4px;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon-add:hover:not(:disabled) {
  background: rgba(63, 185, 80, 0.15);
}

.btn-icon-add:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
