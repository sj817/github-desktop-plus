import { lookupTranslation } from '../i18n-lookup'

/**
 * i18n Preload Script — runs inside GitHub Desktop's renderer process.
 * Uses MutationObserver to replace English text with translations.
 * Injected from the main-process hook using executeJavaScript.
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

  const NON_TRANSLATABLE_SELECTOR = [
    "code",
    "pre",
    "kbd",
    "samp",
    ".CodeMirror-code",
    ".CodeMirror-line",
    ".CodeMirror-line-like",
    ".cm-content",
    ".cm-line",
    ".side-by-side-diff .content-wrapper",
    ".side-by-side-diff-container .content-wrapper",
    ".blob-code",
    ".blob-code-inner",
    "[data-gdp-no-translate]",
    // GDP's own settings dialog. Its copy is already localised, and it is a
    // React tree — letting the observer rewrite text nodes React owns would
    // mean the locale pack silently re-labelling GDP's own UI.
    "#gdp-settings-dialog",
  ].join(",");

  function getTranslations(): Record<string, string> {
    return ((window as unknown as Record<string, unknown>).__GDP_TRANSLATIONS__ as Record<string, string> | undefined) ?? {};
  }

  type GDPOverride = { anchor: string; value: string };

  function getOverrides(): Record<string, GDPOverride[]> {
    return (
      ((window as unknown as Record<string, unknown>).__GDP_OVERRIDES__ as
        | Record<string, GDPOverride[]>
        | undefined) ?? {}
    );
  }

  // Anchor-based disambiguation: the same English key may need different
  // translations in different UI areas. An override applies only when the
  // element being translated is inside a DOM subtree matching its anchor
  // selector. Absent any override for `key`, this returns `defaultValue`
  // unchanged (the common fast path — no closest() cost).
  function resolveOverride(
    key: string,
    defaultValue: string,
    contextEl: Element | null,
  ): string {
    if (!contextEl) return defaultValue;
    const list = getOverrides()[key];
    if (!list || list.length === 0) return defaultValue;
    for (const override of list) {
      try {
        if (contextEl.closest(override.anchor)) return override.value;
      } catch {
        // Invalid selector — ignore this override, keep scanning.
      }
    }
    return defaultValue;
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

  // `contextEl` is the element the text belongs to (a text node's parent, or the
  // attribute's element). It is used only to resolve anchor-based overrides; when
  // omitted (e.g. context-menu labels with no DOM node) the flat translation is used.
  function translateText(text: string, contextEl: Element | null = null): string {
    const translations = getTranslations();
    const entries = Object.entries(translations).sort((a, b) => b[0].length - a[0].length);
    const trimmed = text.trim();
    if (!trimmed) return text;

    // Exact match first, then a case-insensitive fallback (see i18n-lookup.ts:
    // GitHub Desktop title-cases most labels on macOS, and both spellings want
    // the same translation).
    const direct = lookupTranslation(translations, trimmed);
    if (direct !== undefined) {
      return text.replace(trimmed, resolveOverride(direct.key, direct.value, contextEl));
    }

    // Whitespace-normalized match: collapse internal whitespace (handles multiline JSX text nodes)
    const normalized = trimmed.replace(/\s+/g, ' ');
    if (normalized !== trimmed) {
      const normalizedHit = lookupTranslation(translations, normalized);
      if (normalizedHit !== undefined) {
        return text.replace(trimmed, resolveOverride(normalizedHit.key, normalizedHit.value, contextEl));
      }

      // Also try pattern match with normalized text
      for (const [pattern, replacement] of entries) {
        const compiled = buildTranslationPattern(pattern);
        if (compiled === null) continue;
        const normalizedMatch = normalized.match(compiled.regex);
        if (normalizedMatch) {
          let result = resolveOverride(pattern, replacement, contextEl);
          compiled.names.forEach((name, i) => {
            const value = normalizedMatch[i + 1] ?? "";
            result = result.replace(`{{${name}}}`, value);
            result = result.replace(`{${name}}`, value);
          });
          return text.replace(trimmed, result);
        }
      }
    }

    // Pattern match (entries with {{var}} or {var} placeholders)
    for (const [pattern, replacement] of entries) {
      const compiled = buildTranslationPattern(pattern);
      if (compiled === null) continue;

      const match = trimmed.match(compiled.regex);

      if (match) {
        let result = resolveOverride(pattern, replacement, contextEl);
        compiled.names.forEach((name, i) => {
          const value = match[i + 1] ?? "";
          result = result.replace(`{{${name}}}`, value);
          result = result.replace(`{${name}}`, value);
        });
        return text.replace(trimmed, result);
      }
    }

    return text;
  }

  function hasSyntaxTokenClass(el: Element): boolean {
    return Array.from(el.classList).some(
      (className) => className.startsWith("cm-") && !className.startsWith("cm-s-"),
    );
  }

  function isInsideNonTranslatableContent(el: Element | null): boolean {
    let current = el;
    while (current !== null) {
      if (current.matches(NON_TRANSLATABLE_SELECTOR) || hasSyntaxTokenClass(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function translateNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const textNode = node as GDPTextNode;
      if (isInsideNonTranslatableContent(textNode.parentElement)) {
        if (
          textNode.__gdpSourceText !== undefined &&
          textNode.textContent === textNode.__gdpTranslatedText
        ) {
          textNode.textContent = textNode.__gdpSourceText;
        }
        return;
      }

      const current = textNode.textContent;
      const source =
        textNode.__gdpSourceText !== undefined &&
        current === textNode.__gdpTranslatedText
          ? textNode.__gdpSourceText
          : current;

      const translated = translateText(source, textNode.parentElement);
      textNode.__gdpSourceText = source;
      textNode.__gdpTranslatedText = translated;

      if (translated !== current) {
        textNode.textContent = translated;
      }
    }
  }

  function translateAttribute(el: Element, attr: string) {
    if (isInsideNonTranslatableContent(el)) {
      const translatedElement = el as GDPTranslatedElement;
      const prev = translatedElement.__gdpAttrState?.[attr];
      if (prev !== undefined && el.getAttribute(attr) === prev.translated) {
        el.setAttribute(attr, prev.source);
      }
      return;
    }

    const current = el.getAttribute(attr);
    if (!current) return;

    const translatedElement = el as GDPTranslatedElement;
    const prev = translatedElement.__gdpAttrState?.[attr];
    const source =
      prev !== undefined && current === prev.translated
        ? prev.source
        : current;

    const translated = translateText(source, el);
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

  // ---------------------------------------------------------------------------
  // Intercept show-contextual-menu IPC to translate context menu labels.
  // Context menus are built via new MenuItem({ label }) in the main process,
  // bypassing Menu.buildFromTemplate. We translate before sending over IPC.
  // ---------------------------------------------------------------------------
  function translateMenuItems(items: Array<Record<string, unknown>>): void {
    for (const item of items) {
      if (typeof item.label === "string") {
        const translated = translateText(item.label);
        if (translated !== item.label) {
          item.label = translated;
        }
      }
      if (item.submenu && Array.isArray(item.submenu)) {
        translateMenuItems(item.submenu as Array<Record<string, unknown>>);
      }
    }
  }

  try {
    // nodeIntegration: true in GitHub Desktop, so require() is available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = (require as NodeRequire)("electron") as {
      ipcRenderer?: {
        invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      };
    };
    const ipc = electron?.ipcRenderer;
    if (ipc && typeof ipc.invoke === "function") {
      const originalInvoke = ipc.invoke.bind(ipc);
      ipc.invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
        if (channel === "show-contextual-menu" && Array.isArray(args[0])) {
          translateMenuItems(args[0] as Array<Record<string, unknown>>);
        }
        return originalInvoke(channel, ...args);
      };
      console.log("[GDP i18n] show-contextual-menu IPC interceptor active");
    }
  } catch (e) {
    console.warn("[GDP i18n] Failed to intercept ipcRenderer.invoke:", e);
  }
})();
