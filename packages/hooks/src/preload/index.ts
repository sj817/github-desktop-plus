import { lookupTranslation } from '../i18n-lookup'

/**
 * i18n Preload Script — runs inside GitHub Desktop's renderer process.
 * Uses MutationObserver to replace English text with translations.
 * Injected from the main-process hook using executeJavaScript.
 * Translations are pre-embedded by the injector as window.__GDP_TRANSLATIONS__.
 *
 * The observer callback runs synchronously after every React commit, so the
 * work per DOM mutation has to stay small: diff rows, commit lists and file
 * lists churn hundreds of nodes per frame while scrolling. The hot paths are
 * therefore memoised per batch (ancestry checks) and per node (results), and
 * text that cannot possibly match a translation is rejected before any lookup.
 */

(function () {
  type GDPTextNode = Text & {
    __gdpSourceText?: string;
    __gdpTranslatedText?: string;
    __gdpGeneration?: number;
  };

  type GDPAttrState = {
    source: string;
    translated: string;
    generation: number;
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

  // Syntax-highlight token classes (`cm-keyword`, …) mark code; the theme
  // class `cm-s-default` on the diff container does not.
  const SYNTAX_TOKEN_CLASS = /(?:^|\s)cm-(?!s-)/;

  // Every translation key is an English UI string, so text without a single
  // ASCII letter (line numbers, `+`/`-` prefixes, SHAs, CJK text we already
  // wrote) can never match — skip the lookups entirely.
  const HAS_ASCII_LETTER = /[A-Za-z]/;

  // Bumped whenever the translations object is replaced (hot reload, locale
  // switch) so nodes translated under an older table get re-translated.
  let translationsRef: Record<string, string> | null = null;
  let generation = 0;

  function getTranslations(): Record<string, string> {
    const current =
      ((window as unknown as Record<string, unknown>).__GDP_TRANSLATIONS__ as Record<string, string> | undefined) ?? {};
    if (current !== translationsRef) {
      translationsRef = current;
      generation++;
    }
    return current;
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

  type PreparedTranslationPattern = {
    pattern: string;
    replacement: string;
    regex: RegExp;
    names: string[];
    /**
     * Longest literal run of the pattern. A text that does not even contain it
     * cannot match the regex, and `includes` is far cheaper than running a
     * `(.+)`-anchored regex for each of the ~180 patterns.
     */
    literal: string;
  };

  const translationPatternCache = new WeakMap<object, PreparedTranslationPattern[]>();

  function longestLiteral(pattern: string): string {
    let longest = "";
    for (const piece of pattern.split(/\{\{\w+\}\}|\{\w+\}/)) {
      const trimmed = piece.trim();
      if (trimmed.length > longest.length) longest = trimmed;
    }
    return longest;
  }

  function translationPatterns(translations: Record<string, string>): PreparedTranslationPattern[] {
    const cached = translationPatternCache.get(translations);
    if (cached !== undefined) return cached;

    const prepared: PreparedTranslationPattern[] = [];
    const entries = Object.entries(translations).sort((left, right) => right[0].length - left[0].length);
    for (const [pattern, replacement] of entries) {
      const compiled = buildTranslationPattern(pattern);
      if (compiled !== null) {
        prepared.push({ pattern, replacement, ...compiled, literal: longestLiteral(pattern) });
      }
    }
    translationPatternCache.set(translations, prepared);
    return prepared;
  }

  function matchPattern(
    candidate: string,
    patterns: PreparedTranslationPattern[],
    contextEl: Element | null,
  ): string | null {
    for (const { pattern, replacement, regex, names, literal } of patterns) {
      if (literal !== "" && !candidate.includes(literal)) continue;
      const match = candidate.match(regex);
      if (match === null) continue;

      let result = resolveOverride(pattern, replacement, contextEl);
      names.forEach((name, i) => {
        const value = match[i + 1] ?? "";
        result = result.replace(`{{${name}}}`, value);
        result = result.replace(`{${name}}`, value);
      });
      return result;
    }
    return null;
  }

  // `contextEl` is the element the text belongs to (a text node's parent, or the
  // attribute's element). It is used only to resolve anchor-based overrides; when
  // omitted (e.g. context-menu labels with no DOM node) the flat translation is used.
  function translateText(text: string, contextEl: Element | null = null): string {
    const trimmed = text.trim();
    if (!trimmed || !HAS_ASCII_LETTER.test(trimmed)) return text;

    const translations = getTranslations();

    // Exact match first, then a case-insensitive fallback (see i18n-lookup.ts:
    // GitHub Desktop title-cases most labels on macOS, and both spellings want
    // the same translation).
    const direct = lookupTranslation(translations, trimmed);
    if (direct !== undefined) {
      return text.replace(trimmed, resolveOverride(direct.key, direct.value, contextEl));
    }

    const patterns = translationPatterns(translations);

    // Whitespace-normalized match: collapse internal whitespace (handles multiline JSX text nodes)
    const normalized = trimmed.replace(/\s+/g, ' ');
    if (normalized !== trimmed) {
      const normalizedHit = lookupTranslation(translations, normalized);
      if (normalizedHit !== undefined) {
        return text.replace(trimmed, resolveOverride(normalizedHit.key, normalizedHit.value, contextEl));
      }

      // Also try pattern match with normalized text
      const normalizedResult = matchPattern(normalized, patterns, contextEl);
      if (normalizedResult !== null) return text.replace(trimmed, normalizedResult);
    }

    // Pattern match (entries with {{var}} or {var} placeholders)
    const result = matchPattern(trimmed, patterns, contextEl);
    return result === null ? text : text.replace(trimmed, result);
  }

  function hasSyntaxTokenClass(el: Element): boolean {
    const className = el.getAttribute("class");
    return className !== null && SYNTAX_TOKEN_CLASS.test(className);
  }

  // The ancestry check is the single most repeated operation: every text node
  // of every touched row walks up to the document root unless it hits a
  // non-translatable ancestor. Rows share almost all of that path, so results
  // are memoised per element for the duration of one observer batch (the DOM
  // does not change while the callback runs), and dropped afterwards.
  let ancestryCache = new WeakMap<Element, boolean>();

  // Start of a translation pass: fresh ancestry cache, and the generation
  // counter caught up with the current translations object so the per-node
  // fast path below sees a hot-reloaded table before the first node is checked.
  function beginPass(): void {
    ancestryCache = new WeakMap();
    getTranslations();
  }

  function isInsideNonTranslatableContent(el: Element | null): boolean {
    const visited: Element[] = [];
    let current = el;
    let result = false;
    while (current !== null) {
      const cached = ancestryCache.get(current);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      if (current.matches(NON_TRANSLATABLE_SELECTOR) || hasSyntaxTokenClass(current)) {
        result = true;
        break;
      }
      visited.push(current);
      current = current.parentElement;
    }
    for (const element of visited) ancestryCache.set(element, result);
    return result;
  }

  function translateNode(node: Node) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent) return;

    const textNode = node as GDPTextNode;
    const current = textNode.textContent;

    if (isInsideNonTranslatableContent(textNode.parentElement)) {
      if (
        textNode.__gdpSourceText !== undefined &&
        current === textNode.__gdpTranslatedText
      ) {
        textNode.textContent = textNode.__gdpSourceText;
      }
      return;
    }

    // Already handled under the current translation table: this is either the
    // characterData record produced by our own write below, or a node revisited
    // by a later batch. Nothing to recompute.
    if (current === textNode.__gdpTranslatedText && textNode.__gdpGeneration === generation) {
      return;
    }

    const source =
      textNode.__gdpSourceText !== undefined &&
      current === textNode.__gdpTranslatedText
        ? textNode.__gdpSourceText
        : current;

    const translated = translateText(source, textNode.parentElement);
    textNode.__gdpSourceText = source;
    textNode.__gdpTranslatedText = translated;
    textNode.__gdpGeneration = generation;

    if (translated !== current) {
      textNode.textContent = translated;
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
    if (prev !== undefined && current === prev.translated && prev.generation === generation) {
      return;
    }
    const source =
      prev !== undefined && current === prev.translated
        ? prev.source
        : current;

    const translated = translateText(source, el);
    translatedElement.__gdpAttrState ??= {};
    translatedElement.__gdpAttrState[attr] = { source, translated, generation };

    if (translated !== current) {
      el.setAttribute(attr, translated);
    }
  }

  const TRANSLATED_ATTRIBUTES = ["title", "placeholder", "aria-label"];

  function translateSubtree(root: Node) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      translateNode(node);
    }

    if (root instanceof Element) {
      for (const attr of TRANSLATED_ATTRIBUTES) {
        translateAttribute(root, attr);
      }
      root.querySelectorAll("[title],[placeholder],[aria-label]").forEach((el) => {
        for (const attr of TRANSLATED_ATTRIBUTES) {
          translateAttribute(el, attr);
        }
      });
    }
  }

  // Public entry point (initial pass, hot reload): always starts from a clean
  // ancestry cache because arbitrary time may have passed since the last batch.
  function translateTree(root: Node) {
    beginPass();
    translateSubtree(root);
  }

  // Expose translateTree globally for hot-reload support
  (window as unknown as Record<string, unknown>).__gdpTranslateTree = translateTree;

  // Initial translation
  if (document.body) {
    translateTree(document.body);
  }

  function hasAncestorIn(node: Node, set: ReadonlySet<Node>): boolean {
    let current = node.parentNode;
    while (current !== null) {
      if (set.has(current)) return true;
      current = current.parentNode;
    }
    return false;
  }

  // Observe DOM mutations for dynamic content (React re-renders)
  const observer = new MutationObserver((mutations) => {
    beginPass();

    // Every element inserted in this batch; roots are the ones with no
    // inserted ancestor, so each subtree is walked exactly once.
    const addedElements = new Set<Node>();
    const textNodes = new Set<Node>();

    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        if (mutation.target.isConnected && mutation.target.textContent) {
          textNodes.add(mutation.target);
        }
        continue;
      }
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        // Nodes React inserted and removed again within the same batch are
        // gone already; walking them would be wasted work.
        if (!node.isConnected) continue;
        if (node.nodeType === Node.TEXT_NODE) {
          textNodes.add(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          addedElements.add(node);
        }
      }
    }

    for (const element of addedElements) {
      if (!hasAncestorIn(element, addedElements)) translateSubtree(element);
    }
    for (const node of textNodes) {
      if (!hasAncestorIn(node, addedElements)) translateNode(node);
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
