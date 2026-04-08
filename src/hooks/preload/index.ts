/**
 * i18n Preload Script — runs inside GitHub Desktop's renderer process.
 * Uses MutationObserver to replace English text with translations.
 * Injected via preload-injector.ts using executeJavaScript.
 * Translations are pre-embedded by the injector as window.__GDP_TRANSLATIONS__.
 */

(function () {
  // Prefer translations embedded by the injector (avoids __dirname uncertainty
  // in the renderer context entirely).
  const translations: Record<string, string> =
    (window as unknown as Record<string, unknown>).__GDP_TRANSLATIONS__ as Record<string, string> ?? {};

  if (Object.keys(translations).length === 0) {
    console.warn("[GDP i18n] No translations available");
    return;
  }

  console.log(`[GDP i18n] Active with ${Object.keys(translations).length} entries`);

  const entries = Object.entries(translations);

  function translateText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return text;

    // Exact match first
    const exact = translations[trimmed];
    if (exact !== undefined) return text.replace(trimmed, exact);

    // Pattern match (entries with {{var}} placeholders)
    for (const [pattern, replacement] of entries) {
      if (!pattern.includes("{{")) continue;

      // Convert pattern to regex: "Hello {{name}}" -> /^Hello (.+)$/
      const regexStr = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\{\\{\\w+\\}\\}/g, "(.+)");
      const regex = new RegExp(`^${regexStr}$`);
      const match = trimmed.match(regex);

      if (match) {
        let result = replacement;
        const varNames = [...pattern.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        varNames.forEach((name, i) => {
          result = result.replace(`{{${name}}}`, match[i + 1]);
        });
        return text.replace(trimmed, result);
      }
    }

    return text;
  }

  function translateNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const translated = translateText(node.textContent);
      if (translated !== node.textContent) {
        node.textContent = translated;
      }
    }
  }

  function translateTree(root: Node) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      translateNode(node);
    }

    if (root instanceof Element) {
      for (const attr of ["title", "placeholder", "aria-label"]) {
        const val = root.getAttribute(attr);
        if (val) {
          const translated = translateText(val);
          if (translated !== val) root.setAttribute(attr, translated);
        }
      }
      root.querySelectorAll("[title],[placeholder],[aria-label]").forEach((el) => {
        for (const attr of ["title", "placeholder", "aria-label"]) {
          const val = el.getAttribute(attr);
          if (val) {
            const translated = translateText(val);
            if (translated !== val) el.setAttribute(attr, translated);
          }
        }
      });
    }
  }

  // Initial translation
  if (document.body) {
    translateTree(document.body);
  }

  // Observe DOM mutations for dynamic content (React re-renders)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData" && mutation.target.textContent) {
        translateNode(mutation.target);
      }
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            translateNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            translateTree(node);
          }
        });
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log("[GDP i18n] MutationObserver active");
})();
