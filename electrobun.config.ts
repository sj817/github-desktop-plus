import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "GitHub Desktop Plus",
    identifier: "dev.gdp.app",
    version: "0.1.0",
  },
  build: {
    copy: {
      // Vite builds Vue app to dist/
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      // Hook scripts (pre-built CJS for Electron injection)
      "build/hooks": "resources/hooks",
      // Locale files
      "locales": "resources/locales",
    },
    watchIgnore: ["dist/**", "build/**"],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
