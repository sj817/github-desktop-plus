/**
 * i18n Preload Script — runs inside GitHub Desktop's renderer process.
 * Uses MutationObserver to replace English text with translations.
 * Injected via preload-injector.ts using executeJavaScript.
 * Translations are pre-embedded by the injector as window.__GDP_TRANSLATIONS__.
 */

(function () {
  type GDPTextNode = Text & {
    __gdpSourceText?: string;
    __gdpTranslatedText?: string;
  };

  type GDPAttrState = {
    source: string;
    translated: string;
  };

  type GDPTranslatedElement = Element & {
    __gdpAttrState?: Record<string, GDPAttrState>;
  };

  function getTranslations(): Record<string, string> {
    return ((window as unknown as Record<string, unknown>).__GDP_TRANSLATIONS__ as Record<string, string> | undefined) ?? {};
  }

  // Prefer translations embedded by the injector (avoids __dirname uncertainty
  // in the renderer context entirely).
  const initialTranslations = getTranslations();

  if (Object.keys(initialTranslations).length === 0) {
    console.warn("[GDP i18n] No translations available");
    return;
  }

  console.log(`[GDP i18n] Active with ${Object.keys(initialTranslations).length} entries`);

  function buildTranslationPattern(pattern: string): { regex: RegExp; names: string[] } | null {
    const token = /(\{\{(\w+)\}\}|\{(\w+)\})/g;
    const names: string[] = [];
    let cursor = 0;
    let regexStr = "";

    for (const match of pattern.matchAll(token)) {
      const raw = match[0];
      const name = match[2] ?? match[3];
      const index = match.index ?? -1;
      if (!raw || !name || index < 0) continue;

      regexStr += pattern
        .slice(cursor, index)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regexStr += "(.+)";
      names.push(name);
      cursor = index + raw.length;
    }

    if (names.length === 0) return null;

    regexStr += pattern.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { regex: new RegExp(`^${regexStr}$`), names };
  }

  function translateText(text: string): string {
    const translations = getTranslations();
    const entries = Object.entries(translations);
    const trimmed = text.trim();
    if (!trimmed) return text;

    // Exact match first
    const exact = translations[trimmed];
    if (exact !== undefined) return text.replace(trimmed, exact);

    // Pattern match (entries with {{var}} or {var} placeholders)
    for (const [pattern, replacement] of entries) {
      const compiled = buildTranslationPattern(pattern);
      if (compiled === null) continue;

      const match = trimmed.match(compiled.regex);

      if (match) {
        let result = replacement;
        compiled.names.forEach((name, i) => {
          result = result.replace(`{{${name}}}`, match[i + 1]);
          result = result.replace(`{${name}}`, match[i + 1]);
        });
        return text.replace(trimmed, result);
      }
    }

    return text;
  }

  function translateNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const textNode = node as GDPTextNode;
      const current = textNode.textContent;
      const source =
        textNode.__gdpSourceText !== undefined &&
        current === textNode.__gdpTranslatedText
          ? textNode.__gdpSourceText
          : current;

      const translated = translateText(source);
      textNode.__gdpSourceText = source;
      textNode.__gdpTranslatedText = translated;

      if (translated !== current) {
        textNode.textContent = translated;
      }
    }
  }

  function translateAttribute(el: Element, attr: string) {
    const current = el.getAttribute(attr);
    if (!current) return;

    const translatedElement = el as GDPTranslatedElement;
    const prev = translatedElement.__gdpAttrState?.[attr];
    const source =
      prev !== undefined && current === prev.translated
        ? prev.source
        : current;

    const translated = translateText(source);
    translatedElement.__gdpAttrState ??= {};
    translatedElement.__gdpAttrState[attr] = { source, translated };

    if (translated !== current) {
      el.setAttribute(attr, translated);
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
        translateAttribute(root, attr);
      }
      root.querySelectorAll("[title],[placeholder],[aria-label]").forEach((el) => {
        for (const attr of ["title", "placeholder", "aria-label"]) {
          translateAttribute(el, attr);
        }
      });
    }
  }

  // Expose translateTree globally for hot-reload support
  (window as unknown as Record<string, unknown>).__gdpTranslateTree = translateTree;

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
