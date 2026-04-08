/**
 * Telemetry Blocker — prevents GitHub Desktop from sending usage stats.
 * Intercepts HTTP/HTTPS requests to central.github.com.
 */

const https = require("https");
const http = require("http");

const BLOCKED_HOSTS = ["central.github.com"];
const BLOCKED_PATHS = [
  "/api/usage/desktop",
  "/api/usage/desktop-non-fatal/exception",
  "/api/usage/desktop/exception",
];

function shouldBlock(options: { hostname?: string; host?: string; path?: string }): boolean {
  const host = options.hostname || options.host || "";
  const path = options.path || "";

  if (BLOCKED_HOSTS.some((h) => host.includes(h))) {
    if (BLOCKED_PATHS.some((p) => path.startsWith(p)) || path === "") {
      return true;
    }
  }
  return false;
}

function createNoopResponse() {
  const { EventEmitter } = require("events");
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setEncoding = () => res;
  res.read = () => null;
  res.pipe = () => res;
  // Simulate a successful but empty response
  setTimeout(() => {
    res.emit("data", "{}");
    res.emit("end");
  }, 1);
  return res;
}

function createNoopRequest() {
  const { EventEmitter } = require("events");
  const req = new EventEmitter();
  req.write = () => true;
  req.end = () => {
    const res = createNoopResponse();
    req.emit("response", res);
  };
  req.abort = () => {};
  req.destroy = () => {};
  req.setTimeout = () => req;
  req.setNoDelay = () => {};
  req.setSocketKeepAlive = () => {};
  return req;
}

// Wrap https.request
const originalHttpsRequest = https.request;
https.request = function (
  options: string | { hostname?: string; host?: string; path?: string },
  ...args: unknown[]
) {
  const opts = typeof options === "string" ? new URL(options) : options;
  if (shouldBlock(opts as { hostname?: string; host?: string; path?: string })) {
    console.log(`[GDP] Blocked telemetry: ${(opts as { hostname?: string }).hostname}${(opts as { path?: string }).path}`);
    return createNoopRequest();
  }
  return originalHttpsRequest.call(this, options, ...args);
};

// Wrap http.request
const originalHttpRequest = http.request;
http.request = function (
  options: string | { hostname?: string; host?: string; path?: string },
  ...args: unknown[]
) {
  const opts = typeof options === "string" ? new URL(options) : options;
  if (shouldBlock(opts as { hostname?: string; host?: string; path?: string })) {
    console.log(`[GDP] Blocked telemetry: ${(opts as { hostname?: string }).hostname}${(opts as { path?: string }).path}`);
    return createNoopRequest();
  }
  return originalHttpRequest.call(this, options, ...args);
};

// Also hook electron.net.request if available
try {
  const electron = require("electron");
  if (electron.net && electron.net.request) {
    const originalNetRequest = electron.net.request;
    electron.net.request = function (options: string | { hostname?: string; host?: string; path?: string; url?: string }) {
      let opts: { hostname?: string; host?: string; path?: string };
      if (typeof options === "string") {
        opts = new URL(options) as unknown as { hostname?: string; host?: string; path?: string };
      } else if ((options as { url?: string }).url) {
        opts = new URL((options as { url?: string }).url!) as unknown as { hostname?: string; host?: string; path?: string };
      } else {
        opts = options as { hostname?: string; host?: string; path?: string };
      }

      if (shouldBlock(opts)) {
        console.log(`[GDP] Blocked telemetry (net): ${opts.hostname}${opts.path}`);
        return createNoopRequest();
      }
      return originalNetRequest.call(this, options);
    };
  }
} catch {
  // electron.net may not be available in renderer
}
