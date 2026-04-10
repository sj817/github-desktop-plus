import type { RPCSchema } from "electrobun/bun";

/** Configuration for GitHub Desktop Plus */
export interface GDPConfig {
  /** GitHub Desktop executable path (auto-detected if empty) */
  desktopPath: string;
  /** Block auto-update checks */
  blockUpdates: boolean;
  /** Block manual update check button in About dialog */
  blockManualUpdateCheck: boolean;
  /** Block telemetry/stats reporting */
  blockTelemetry: boolean;
  /** Override log level (debug/info/warn/error), empty = no override */
  logLevel: string;
  /** Enable i18n text replacement */
  enableI18n: boolean;
  /** Locale code for i18n */
  locale: string;
  /** Minimize to tray on launch */
  minimizeOnLaunch: boolean;
  /** Show navbar in GitHub Desktop window */
  showNavbar: boolean;
}

export const defaultConfig: GDPConfig = {
  desktopPath: "",
  blockUpdates: true,
  blockManualUpdateCheck: true,
  blockTelemetry: true,
  logLevel: "",
  enableI18n: true,
  locale: "zh-CN",
  minimizeOnLaunch: true,
  showNavbar: true,
};

/** Status of the GitHub Desktop process */
export type DesktopStatus = "stopped" | "starting" | "running" | "error";

export interface StatusInfo {
  status: DesktopStatus;
  pid: number | null;
  message: string;
}

/** Structured log entry from hooks */
export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "block";
  category: "update" | "telemetry" | "i18n" | "menu" | "system" | "navbar";
  message: string;
}

/** Locale entry for the translation editor */
export interface LocaleEntry {
  key: string;
  value: string;
  category: string;
}

/** RPC schema for bun <-> webview communication */
export type MainViewRPC = {
  bun: RPCSchema<{
    requests: {
      /** Get the current config */
      getConfig: {
        params: Record<string, never>;
        response: GDPConfig;
      };
      /** Save config changes */
      saveConfig: {
        params: GDPConfig;
        response: { ok: boolean; error?: string };
      };
      /** Auto-detect GitHub Desktop path */
      detectDesktopPath: {
        params: Record<string, never>;
        response: { path: string; found: boolean };
      };
      /** Launch GitHub Desktop with hooks */
      launchDesktop: {
        params: Record<string, never>;
        response: { ok: boolean; error?: string };
      };
      /** Stop the running GitHub Desktop process */
      stopDesktop: {
        params: Record<string, never>;
        response: { ok: boolean };
      };
      /** Get current desktop process status */
      getStatus: {
        params: Record<string, never>;
        response: StatusInfo;
      };
      /** Get hook logs */
      getLogs: {
        params: { since?: string };
        response: LogEntry[];
      };
      /** Get locale entries for editing */
      getLocaleEntries: {
        params: { locale: string; category: string };
        response: LocaleEntry[];
      };
      /** Save locale entries */
      saveLocaleEntries: {
        params: { locale: string; category: string; entries: LocaleEntry[] };
        response: { ok: boolean; error?: string };
      };
      /** List available locales */
      listLocales: {
        params: Record<string, never>;
        response: string[];
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      /** Push status update to webview */
      statusUpdate: StatusInfo;
      /** Push new log entries to webview */
      logPush: LogEntry[];
    };
  }>;
};
