<script setup lang="ts">
import { ref, watch } from "vue";
import type { GDPConfig } from "../../shared/types";

const props = defineProps<{
  config: GDPConfig;
}>();

const emit = defineEmits<{
  save: [config: GDPConfig];
  "detect-path": [];
}>();

// Local editable copy
const local = ref<GDPConfig>({ ...props.config });
const dirty = ref(false);

watch(
  () => props.config,
  (cfg) => {
    local.value = { ...cfg };
    dirty.value = false;
  }
);

function markDirty() {
  dirty.value = true;
}

function save() {
  emit("save", { ...local.value });
  dirty.value = false;
}

const logLevels = ["", "debug", "info", "warn", "error"];
const locales = ["zh-CN", "en"];
</script>

<template>
  <div class="settings">
    <!-- Desktop Path -->
    <div class="setting-group">
      <label class="setting-label">GitHub Desktop 路径</label>
      <div class="path-row">
        <input
          type="text"
          class="input"
          v-model="local.desktopPath"
          placeholder="自动检测..."
          @input="markDirty"
        />
        <button class="btn btn-small" @click="$emit('detect-path')">
          自动检测
        </button>
      </div>
    </div>

    <!-- Feature Toggles -->
    <div class="setting-group">
      <div class="group-title">功能开关</div>
      <label class="toggle-row">
        <input type="checkbox" v-model="local.blockUpdates" @change="markDirty" />
        <div class="toggle-content">
          <span class="toggle-label">禁用自动更新</span>
          <span class="toggle-hint">阻止 GitHub Desktop 自动检查和下载更新</span>
        </div>
      </label>
      <label class="toggle-row">
        <input type="checkbox" v-model="local.blockManualUpdateCheck" @change="markDirty" />
        <div class="toggle-content">
          <span class="toggle-label">拦截手动更新按钮</span>
          <span class="toggle-hint">拦截 About 对话框中的"检查更新"按钮，弹出 GDP 提示</span>
        </div>
      </label>
      <label class="toggle-row">
        <input type="checkbox" v-model="local.blockTelemetry" @change="markDirty" />
        <div class="toggle-content">
          <span class="toggle-label">禁用遥测上报</span>
          <span class="toggle-hint">阻止发送使用统计和崩溃报告到 central.github.com</span>
        </div>
      </label>
      <label class="toggle-row">
        <input type="checkbox" v-model="local.enableI18n" @change="markDirty" />
        <div class="toggle-content">
          <span class="toggle-label">启用中文界面</span>
          <span class="toggle-hint">通过菜单拦截 + DOM 文本替换实现界面汉化</span>
        </div>
      </label>
      <label class="toggle-row">
        <input type="checkbox" v-model="local.showNavbar" @change="markDirty" />
        <div class="toggle-content">
          <span class="toggle-label">注入控制导航栏</span>
          <span class="toggle-hint">在 GitHub Desktop 窗口右下角注入浮动控制面板</span>
        </div>
      </label>
      <label class="toggle-row">
        <input type="checkbox" v-model="local.minimizeOnLaunch" @change="markDirty" />
        <div class="toggle-content">
          <span class="toggle-label">启动后自动最小化</span>
          <span class="toggle-hint">启动 GitHub Desktop 后自动将 Plus 窗口最小化到后台</span>
        </div>
      </label>
    </div>

    <!-- Locale selector -->
    <div class="setting-group" v-if="local.enableI18n">
      <label class="setting-label">语言</label>
      <select class="input select" v-model="local.locale" @change="markDirty">
        <option v-for="loc in locales" :key="loc" :value="loc">
          {{ loc === 'zh-CN' ? '简体中文' : loc === 'en' ? 'English' : loc }}
        </option>
      </select>
    </div>

    <!-- Log Level -->
    <div class="setting-group">
      <label class="setting-label">日志级别</label>
      <select class="input select" v-model="local.logLevel" @change="markDirty">
        <option v-for="level in logLevels" :key="level" :value="level">
          {{ level || "不覆盖（使用默认）" }}
        </option>
      </select>
    </div>

    <!-- Save button -->
    <div class="setting-actions" v-if="dirty">
      <button class="btn btn-primary" @click="save">
        💾 保存设置
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-group {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.setting-label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.path-row {
  display: flex;
  gap: 8px;
}

.input {
  flex: 1;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.input:focus {
  border-color: var(--accent);
}

.select {
  flex: unset;
  width: 220px;
  cursor: pointer;
}

.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.toggle-row:last-of-type {
  border-bottom: none;
  padding-bottom: 0;
}

.toggle-row:first-of-type {
  padding-top: 0;
}

.toggle-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  margin-top: 2px;
  flex-shrink: 0;
}

.toggle-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-label {
  font-size: 13px;
  color: var(--text-primary);
}

.toggle-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.btn-small {
  padding: 8px 16px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.btn-small:hover {
  border-color: var(--accent);
}

.setting-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
