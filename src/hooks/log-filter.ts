/**
 * Log Filter — overrides winston's log level in GitHub Desktop.
 * Hooks the `createLogger` export to set a custom log level.
 */

const Module = require("module");
const originalLoad = Module._load;
const targetLevel = process.env.GDP_LOG_LEVEL || "info";

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  const result = originalLoad.call(this, request, parent, isMain);

  if (request === "winston" && result && typeof result.createLogger === "function") {
    const originalCreateLogger = result.createLogger;
    result.createLogger = function (options: Record<string, unknown>) {
      if (options) {
        options.level = targetLevel;
      }
      return originalCreateLogger.call(this, options);
    };
  }

  return result;
};
