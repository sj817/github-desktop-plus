import { existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * On Windows, GitHub Desktop is installed via Squirrel.
 * The top-level GitHubDesktop.exe is the Squirrel launcher — it spawns the
 * real versioned exe from app-X.Y.Z/ and exits immediately (code 0).
 * We must find and launch the versioned exe directly.
 */
function findVersionedExeWindows(): string {
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "GitHubDesktop")
    : "";
  if (!base || !existsSync(base)) return "";

  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return "";
  }

  // Sort descending so the newest version is tried first
  const appDirs = entries
    .filter((d) => /^app-\d+\.\d+/.test(d))
    .sort()
    .reverse();

  for (const dir of appDirs) {
    const exe = join(base, dir, "GitHubDesktop.exe");
    if (existsSync(exe)) return exe;
  }

  // Last-resort fallback to the Squirrel launcher
  const launcher = join(base, "GitHubDesktop.exe");
  return existsSync(launcher) ? launcher : "";
}

export function detectDesktopPath(): string {
  const platform = process.platform;

  if (platform === "win32") {
    return findVersionedExeWindows();
  }

  if (platform === "darwin") {
    const candidates = [
      "/Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop",
      join(
        process.env.HOME ?? "",
        "Applications",
        "GitHub Desktop.app",
        "Contents",
        "MacOS",
        "GitHub Desktop"
      ),
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    return "";
  }

  // Linux
  for (const p of [
    "/usr/bin/github-desktop",
    "/usr/local/bin/github-desktop",
    "/snap/bin/github-desktop",
  ]) {
    if (existsSync(p)) return p;
  }
  return "";
}
