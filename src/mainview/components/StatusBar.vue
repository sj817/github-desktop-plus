<script setup lang="ts">
import { computed } from "vue";
import type { StatusInfo } from "../../shared/types";

const props = defineProps<{
  status: StatusInfo;
}>();

const statusColor = computed(() => {
  switch (props.status.status) {
    case "running":
      return "#3fb950";
    case "starting":
      return "#d29922";
    case "error":
      return "#f85149";
    default:
      return "#8b949e";
  }
});

const statusLabel = computed(() => {
  switch (props.status.status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "error":
      return "错误";
    default:
      return "已停止";
  }
});
</script>

<template>
  <footer class="status-bar">
    <span class="dot" :style="{ background: statusColor }"></span>
    <span class="label">{{ statusLabel }}</span>
    <span class="message">{{ status.message }}</span>
    <span v-if="status.pid" class="pid">PID: {{ status.pid }}</span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  margin-top: 16px;
  border-top: 1px solid #21262d;
  font-size: 12px;
  color: #8b949e;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.label {
  font-weight: 600;
  color: #c9d1d9;
}

.message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pid {
  font-family: monospace;
  color: #8b949e;
}
</style>
