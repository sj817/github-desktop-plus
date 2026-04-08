<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { electroview } from "./electroview";
import type { GDPConfig, StatusInfo, LogEntry } from "../shared/types";
import SettingsPanel from "./components/SettingsPanel.vue";
import StatusBar from "./components/StatusBar.vue";
import LogPanel from "./components/LogPanel.vue";
import LocaleEditor from "./components/LocaleEditor.vue";

type TabId = "dashboard" | "settings" | "logs" | "locale";

const activeTab = ref<TabId>("dashboard");
const config = ref<GDPConfig | null>(null);
const status = ref<StatusInfo>({
  status: "stopped",
  pid: null,
  message: "Loading...",
});
const logs = ref<LogEntry[]>([]);
const loading = ref(true);
const actionLoading = ref(false);

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: "dashboard", label: "控制台", icon: "⚡" },
  { id: "settings", label: "设置", icon: "⚙" },
  { id: "logs", label: "日志", icon: "📋" },
  { id: "locale", label: "语言管理", icon: "🌐" },
];

const blockStats = computed(() => {
  const update = logs.value.filter(l => l.category === "update" && l.level === "block").length;
  const telemetry = logs.value.filter(l => l.category === "telemetry" && l.level === "block").length;
  const menu = logs.value.filter(l => l.category === "menu").length;
  return { update, telemetry, menu };
});

async function loadData() {
  try {
    const [cfg, sts] = await Promise.all([
      electroview.rpc.request.getConfig({}),
      electroview.rpc.request.getStatus({}),
    ]);
    config.value = cfg;
    status.value = sts;
    // Load initial logs
    try {
      const initialLogs = await electroview.rpc.request.getLogs({});
      logs.value = initialLogs;
    } catch { /* logs may not be available yet */ }
  } catch (e) {
    status.value = {
      status: "error",
      pid: null,
      message: String(e),
    };
  } finally {
    loading.value = false;
  }
}

async function handleSaveConfig(cfg: GDPConfig) {
  const result = await electroview.rpc.request.saveConfig(cfg);
  if (result.ok) {
    config.value = { ...cfg };
  }
}

async function handleDetectPath() {
  const result = await electroview.rpc.request.detectDesktopPath({});
  if (result.found && config.value) {
    config.value = { ...config.value, desktopPath: result.path };
    await handleSaveConfig(config.value);
  }
}

async function handleLaunch() {
  actionLoading.value = true;
  try {
    const result = await electroview.rpc.request.launchDesktop({});
    if (!result.ok) {
      status.value = { status: "error", pid: null, message: result.error ?? "Launch failed" };
    }
    const sts = await electroview.rpc.request.getStatus({});
    status.value = sts;
  } finally {
    actionLoading.value = false;
  }
}

async function handleStop() {
  actionLoading.value = true;
  try {
    await electroview.rpc.request.stopDesktop({});
    const sts = await electroview.rpc.request.getStatus({});
    status.value = sts;
  } finally {
    actionLoading.value = false;
  }
}

function onStatusUpdate(e: Event) {
  const detail = (e as CustomEvent<StatusInfo>).detail;
  status.value = detail;
}

function onLogPush(e: Event) {
  const entries = (e as CustomEvent<LogEntry[]>).detail;
  logs.value = [...logs.value, ...entries].slice(-500);
}

onMounted(() => {
  loadData();
  window.addEventListener("gdp:status", onStatusUpdate);
  window.addEventListener("gdp:logPush", onLogPush);
});

onUnmounted(() => {
  window.removeEventListener("gdp:status", onStatusUpdate);
  window.removeEventListener("gdp:logPush", onLogPush);
});
</script>

<template>
  <div class="app">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="#58a6ff"/>
          </svg>
          <span class="logo-text">GDP</span>
        </div>
      </div>
      <nav class="sidebar-nav">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="nav-item"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="nav-icon">{{ tab.icon }}</span>
          <span class="nav-label">{{ tab.label }}</span>
        </button>
      </nav>
      <div class="sidebar-footer">
        <StatusBar :status="status" />
      </div>
    </aside>

    <!-- Main content -->
    <main class="main-content">
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>

      <template v-else-if="config">
        <!-- Dashboard -->
        <div v-show="activeTab === 'dashboard'" class="tab-content">
          <h2 class="page-title">控制台</h2>

          <!-- Status cards -->
          <div class="cards-grid">
            <div class="card" :class="'card-' + status.status">
              <div class="card-icon">{{ status.status === 'running' ? '🟢' : status.status === 'error' ? '🔴' : '⚪' }}</div>
              <div class="card-body">
                <div class="card-title">进程状态</div>
                <div class="card-value">{{ status.status === 'running' ? '运行中' : status.status === 'error' ? '错误' : '已停止' }}</div>
                <div class="card-hint" v-if="status.pid">PID: {{ status.pid }}</div>
              </div>
            </div>
            <div class="card">
              <div class="card-icon">🛡️</div>
              <div class="card-body">
                <div class="card-title">更新拦截</div>
                <div class="card-value">{{ blockStats.update }} 次</div>
              </div>
            </div>
            <div class="card">
              <div class="card-icon">📡</div>
              <div class="card-body">
                <div class="card-title">遥测拦截</div>
                <div class="card-value">{{ blockStats.telemetry }} 次</div>
              </div>
            </div>
            <div class="card">
              <div class="card-icon">🌐</div>
              <div class="card-body">
                <div class="card-title">菜单翻译</div>
                <div class="card-value">{{ blockStats.menu }} 项</div>
              </div>
            </div>
          </div>

          <!-- Quick actions -->
          <div class="section">
            <h3 class="section-title">快速操作</h3>
            <div class="action-bar">
              <button
                v-if="status.status === 'stopped' || status.status === 'error'"
                class="btn btn-primary btn-lg"
                :disabled="actionLoading"
                @click="handleLaunch"
              >
                <span class="btn-icon">🚀</span>
                {{ actionLoading ? "启动中..." : "启动 GitHub Desktop" }}
              </button>
              <button
                v-else
                class="btn btn-danger btn-lg"
                :disabled="actionLoading"
                @click="handleStop"
              >
                <span class="btn-icon">⏹</span>
                {{ actionLoading ? "停止中..." : "停止 GitHub Desktop" }}
              </button>
            </div>
          </div>

          <!-- Recent logs preview -->
          <div class="section" v-if="logs.length > 0">
            <div class="section-header">
              <h3 class="section-title">最近日志</h3>
              <button class="btn btn-ghost btn-sm" @click="activeTab = 'logs'">查看全部 →</button>
            </div>
            <LogPanel :logs="logs" :compact="true" :max-lines="8" />
          </div>
        </div>

        <!-- Settings -->
        <div v-show="activeTab === 'settings'" class="tab-content">
          <h2 class="page-title">设置</h2>
          <SettingsPanel
            :config="config"
            @save="handleSaveConfig"
            @detect-path="handleDetectPath"
          />
        </div>

        <!-- Logs -->
        <div v-show="activeTab === 'logs'" class="tab-content">
          <h2 class="page-title">运行日志</h2>
          <LogPanel :logs="logs" :compact="false" />
        </div>

        <!-- Locale Editor -->
        <div v-show="activeTab === 'locale'" class="tab-content">
          <h2 class="page-title">语言管理</h2>
          <LocaleEditor :locale="config.locale" />
        </div>
      </template>
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border: #30363d;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --accent: #58a6ff;
  --accent-hover: #79c0ff;
  --green: #3fb950;
  --yellow: #d29922;
  --red: #f85149;
  --orange: #d29922;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  font-size: 13px;
}

.app {
  display: flex;
  height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 200px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 1px;
}

.sidebar-nav {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  text-align: left;
}

.nav-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.nav-item.active {
  background: rgba(88, 166, 255, 0.1);
  color: var(--accent);
}

.nav-icon {
  font-size: 15px;
  width: 20px;
  text-align: center;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border);
}

/* Main content */
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 20px;
}

/* Cards */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  transition: border-color 0.2s;
}

.card:hover {
  border-color: var(--accent);
}

.card-running {
  border-color: var(--green);
}

.card-error {
  border-color: var(--red);
}

.card-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.card-title {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.card-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-hint {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
  font-family: monospace;
}

/* Sections */
.section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.section-header .section-title {
  margin-bottom: 0;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #238636;
  border-color: #2ea043;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #2ea043;
}

.btn-danger {
  background: #da3633;
  border-color: #f85149;
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background: #f85149;
}

.btn-ghost {
  background: transparent;
  border: none;
  color: var(--accent);
  padding: 4px 8px;
}

.btn-ghost:hover {
  color: var(--accent-hover);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.btn-lg {
  padding: 10px 24px;
  font-size: 14px;
}

.btn-icon {
  font-size: 14px;
}

.action-bar {
  display: flex;
  gap: 12px;
}

.tab-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
