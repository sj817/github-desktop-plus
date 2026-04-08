<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import type { LogEntry } from "../../shared/types";

const props = defineProps<{
  logs: LogEntry[];
  compact?: boolean;
  maxLines?: number;
}>();

const filter = ref<string>("all");
const searchQuery = ref("");
const logContainer = ref<HTMLElement | null>(null);

const categories = [
  { id: "all", label: "全部" },
  { id: "system", label: "系统" },
  { id: "update", label: "更新" },
  { id: "telemetry", label: "遥测" },
  { id: "i18n", label: "国际化" },
  { id: "menu", label: "菜单" },
  { id: "navbar", label: "导航栏" },
];

const filteredLogs = computed(() => {
  let result = props.logs;
  if (filter.value !== "all") {
    result = result.filter(l => l.category === filter.value);
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(l => l.message.toLowerCase().includes(q));
  }
  if (props.compact && props.maxLines) {
    result = result.slice(-props.maxLines);
  }
  return result;
});

const levelColors: Record<string, string> = {
  info: "var(--green)",
  warn: "var(--yellow)",
  error: "var(--red)",
  block: "var(--red)",
};

const levelLabels: Record<string, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  block: "BLOCK",
};

const categoryColors: Record<string, string> = {
  system: "var(--text-secondary)",
  update: "var(--red)",
  telemetry: "var(--yellow)",
  i18n: "var(--accent)",
  menu: "var(--green)",
  navbar: "#a371f7",
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return ts;
  }
}

// Auto-scroll to bottom when new logs arrive
watch(() => props.logs.length, async () => {
  await nextTick();
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight;
  }
});
</script>

<template>
  <div class="log-panel" :class="{ compact }">
    <!-- Filters (only in full mode) -->
    <div v-if="!compact" class="log-toolbar">
      <div class="filter-chips">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="chip"
          :class="{ active: filter === cat.id }"
          @click="filter = cat.id"
        >
          {{ cat.label }}
        </button>
      </div>
      <input
        type="text"
        class="search-input"
        placeholder="搜索日志..."
        v-model="searchQuery"
      />
    </div>

    <!-- Log entries -->
    <div ref="logContainer" class="log-entries" :class="{ 'log-entries-compact': compact }">
      <div v-if="filteredLogs.length === 0" class="log-empty">
        暂无日志
      </div>
      <div
        v-for="(entry, i) in filteredLogs"
        :key="i"
        class="log-line"
      >
        <span class="log-time">{{ formatTime(entry.ts) }}</span>
        <span
          class="log-level"
          :style="{ color: levelColors[entry.level] || 'var(--text-secondary)' }"
        >{{ levelLabels[entry.level] || entry.level }}</span>
        <span
          class="log-category"
          :style="{ color: categoryColors[entry.category] || 'var(--text-secondary)' }"
        >[{{ entry.category }}]</span>
        <span class="log-message">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.chip:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.chip.active {
  background: rgba(88, 166, 255, 0.15);
  border-color: var(--accent);
  color: var(--accent);
}

.search-input {
  flex: 1;
  min-width: 120px;
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

.log-entries {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  max-height: 480px;
  overflow-y: auto;
  font-family: "Cascadia Code", "Fira Code", "SF Mono", Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
}

.log-entries-compact {
  max-height: 200px;
}

.log-empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 24px;
  font-family: inherit;
}

.log-line {
  display: flex;
  gap: 8px;
  padding: 1px 4px;
  border-radius: 2px;
}

.log-line:hover {
  background: var(--bg-tertiary);
}

.log-time {
  color: var(--text-secondary);
  flex-shrink: 0;
  opacity: 0.7;
}

.log-level {
  flex-shrink: 0;
  font-weight: 600;
  width: 40px;
}

.log-category {
  flex-shrink: 0;
  width: 70px;
  font-weight: 500;
}

.log-message {
  color: var(--text-primary);
  word-break: break-all;
}
</style>
