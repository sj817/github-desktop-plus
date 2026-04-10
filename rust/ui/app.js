// ---- Selectors -------------------------------------------------------------

const $ = (id) => document.getElementById(id)

const el = {
  memoryTarget:        $("memory-target"),
  runtime:             $("runtime"),
  uiStrategy:          $("ui-strategy"),
  modules:             $("modules"),
  tree:                $("tree"),
  detectPath:          $("detect-path"),
  detectBtn:           $("detect-btn"),
  saveBtn:             $("save-btn"),
  saveStatus:          $("save-status"),
  updDisabled:         $("cfg-updates-disabled"),
  telDisabled:         $("cfg-telemetry-disabled"),
  i18nEnabled:         $("cfg-i18n-enabled"),
  disableFilelog:      $("cfg-disable-filelog"),
  // Locale editor
  localePanel:         $("locale-panel"),
  localeSelect:        $("locale-select"),
  categorySelect:      $("category-select"),
  localeSearch:        $("locale-search"),
  localeLoadBtn:       $("locale-load-btn"),
  localeSaveBtn:       $("locale-save-btn"),
  localeSaveStatus:    $("locale-save-status"),
  localeEditorWrap:    $("locale-editor-container"),
}

// ---- State -----------------------------------------------------------------

let currentConfig = null

// ---- Helpers ---------------------------------------------------------------

const setText = (node, value) => { if (node) node.textContent = value }

const setStatus = (msg, isError = false) => {
  setText(el.saveStatus, msg)
  el.saveStatus.className = "save-status " + (isError ? "status-err" : "status-ok")
  setTimeout(() => setText(el.saveStatus, ""), 3000)
}

// ---- Boot ------------------------------------------------------------------

const boot = async () => {
  try {
    const [status, modules, tree, config] = await Promise.all([
      fetch("/api/status").then((r) => r.json()),
      fetch("/api/modules").then((r) => r.json()),
      fetch("/api/tree").then((r) => r.json()),
      fetch("/api/config").then((r) => r.json()),
    ])

    // Runtime stats
    setText(el.memoryTarget,  `< ${status.memory_target_mb}MB`)
    setText(el.runtime,       status.runtime)
    setText(el.uiStrategy,    status.ui_strategy)

    // Module list
    if (el.modules) {
      el.modules.innerHTML = ""
      for (const mod of modules) {
        const li = document.createElement("li")
        li.className = "module-item"
        const title = document.createElement("strong")
        title.textContent = mod.name
        const desc = document.createElement("span")
        desc.textContent = mod.responsibility
        li.append(title, desc)
        el.modules.append(li)
      }
    }

    // Directory tree
    setText(el.tree, tree.tree)

    // Config toggles
    applyConfig(config)
  } catch (err) {
    console.error("boot failed:", err)
    setText(el.tree, "Failed to load runtime data — is gdp-web running?")
  }
}

// ---- Config ----------------------------------------------------------------

const applyConfig = (config) => {
  currentConfig = config
  if (el.updDisabled)    el.updDisabled.checked    = config.updates?.disabled    ?? true
  if (el.telDisabled)    el.telDisabled.checked    = config.telemetry?.disabled  ?? true
  if (el.i18nEnabled)    el.i18nEnabled.checked    = config.i18n?.enabled        ?? true
  if (el.disableFilelog) el.disableFilelog.checked = config.logging?.disable_file_log ?? false
}

el.saveBtn?.addEventListener("click", async () => {
  if (!currentConfig) return

  const payload = {
    ...currentConfig,
    updates: {
      ...currentConfig.updates,
      disabled: el.updDisabled?.checked ?? currentConfig.updates?.disabled,
    },
    telemetry: {
      ...currentConfig.telemetry,
      disabled: el.telDisabled?.checked ?? currentConfig.telemetry?.disabled,
    },
    i18n: {
      ...currentConfig.i18n,
      enabled: el.i18nEnabled?.checked ?? currentConfig.i18n?.enabled,
    },
    logging: {
      ...currentConfig.logging,
      disable_file_log: el.disableFilelog?.checked ?? currentConfig.logging?.disable_file_log,
    },
  }

  try {
    const updated = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json())

    if (updated.error) {
      setStatus("保存失败: " + updated.error, true)
    } else {
      applyConfig(updated)
      setStatus("已保存")
    }
  } catch (err) {
    setStatus("网络错误", true)
    console.error("save failed:", err)
  }
})

// ---- Detect ----------------------------------------------------------------

el.detectBtn?.addEventListener("click", async () => {
  try {
    const result = await fetch("/api/detect").then((r) => r.json())
    if (result.found) {
      setText(el.detectPath, result.path)
      el.detectPath.className = "detect-info status-ok"
    } else {
      setText(el.detectPath, "未找到 GitHub Desktop 安装")
      el.detectPath.className = "detect-info status-err"
    }
  } catch (err) {
    setText(el.detectPath, "检测失败")
    el.detectPath.className = "detect-info status-err"
  }
})

// ---- Start -----------------------------------------------------------------

boot()

// ---- Locale Editor ---------------------------------------------------------

/** All entries currently loaded from the server */
let localeAllEntries = []

const setLocaleStatus = (msg, isError = false) => {
  const el2 = el.localeSaveStatus
  if (!el2) return
  el2.textContent = msg
  el2.className = "save-status " + (isError ? "status-err" : "status-ok")
  if (!isError) setTimeout(() => (el2.textContent = ""), 4000)
}

/** Populate the locale <select> from the /api/locales endpoint */
const loadLocaleList = async () => {
  try {
    const locales = await fetch("/api/locales").then((r) => r.json())
    if (!el.localeSelect) return
    el.localeSelect.innerHTML = ""
    for (const loc of locales) {
      const opt = document.createElement("option")
      opt.value = loc
      opt.textContent = loc
      if (loc === "zh-CN") opt.selected = true
      el.localeSelect.appendChild(opt)
    }
    if (!locales.length) {
      const opt = document.createElement("option")
      opt.value = "zh-CN"
      opt.textContent = "zh-CN"
      el.localeSelect.appendChild(opt)
    }
  } catch (e) {
    console.warn("Failed to load locale list:", e)
  }
}

/** Fetch entries for the current locale + category and render the table */
const loadLocaleEntries = async () => {
  if (!el.localeSelect || !el.categorySelect) return
  const locale = el.localeSelect.value || "zh-CN"
  const category = el.categorySelect.value || "ui"
  try {
    setLocaleStatus("加载中…")
    const entries = await fetch(
      `/api/locale?locale=${encodeURIComponent(locale)}&category=${encodeURIComponent(category)}`
    ).then((r) => {
      if (!r.ok) throw new Error(r.statusText)
      return r.json()
    })
    localeAllEntries = entries
    renderLocaleEditor(entries)
    setLocaleStatus(`已加载 ${entries.length} 条`)
  } catch (err) {
    setLocaleStatus("加载失败: " + err.message, true)
    console.error(err)
  }
}

/** Filter and re-render based on search input */
const filterLocaleEntries = () => {
  const q = (el.localeSearch?.value ?? "").trim().toLowerCase()
  const filtered = q
    ? localeAllEntries.filter(
        (e) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)
      )
    : localeAllEntries
  renderLocaleEditor(filtered)
}

/** Build the editable table from an array of {key, value} */
const renderLocaleEditor = (entries) => {
  if (!el.localeEditorWrap) return
  el.localeEditorWrap.innerHTML = ""

  if (!entries.length) {
    el.localeEditorWrap.textContent = "暂无数据"
    return
  }

  const table = document.createElement("table")
  table.className = "locale-table"
  table.innerHTML =
    "<thead><tr><th class='col-key'>键名</th><th class='col-val'>翻译文本</th></tr></thead>"
  const tbody = document.createElement("tbody")

  for (const entry of entries) {
    const tr = document.createElement("tr")

    const tdKey = document.createElement("td")
    tdKey.className = "locale-key"
    tdKey.title = entry.key
    tdKey.textContent = entry.key

    const tdVal = document.createElement("td")
    const input = document.createElement("input")
    input.type = "text"
    input.value = entry.value
    input.className = "locale-value-input"
    input.dataset.key = entry.key
    input.addEventListener("input", (e) => {
      // Sync back to master list
      const masterEntry = localeAllEntries.find((x) => x.key === entry.key)
      if (masterEntry) masterEntry.value = e.target.value
      entry.value = e.target.value
    })
    tdVal.appendChild(input)

    tr.appendChild(tdKey)
    tr.appendChild(tdVal)
    tbody.appendChild(tr)
  }

  table.appendChild(tbody)
  el.localeEditorWrap.appendChild(table)
}

/** Save the full (unfiltered) localeAllEntries back to disk */
const saveLocaleEntries = async () => {
  if (!localeAllEntries.length) {
    setLocaleStatus("没有已加载的数据", true)
    return
  }
  const locale = el.localeSelect?.value || "zh-CN"
  const category = el.categorySelect?.value || "ui"
  try {
    setLocaleStatus("保存中…")
    const resp = await fetch(
      `/api/locale?locale=${encodeURIComponent(locale)}&category=${encodeURIComponent(category)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localeAllEntries),
      }
    )
    if (!resp.ok) throw new Error(resp.statusText)
    const result = await resp.json()
    setLocaleStatus(`✓ 已保存 ${result.count} 条 — 重启 GitHub Desktop 后生效`)
  } catch (err) {
    setLocaleStatus("保存失败: " + err.message, true)
    console.error(err)
  }
}

// Wire locale editor controls
el.localeLoadBtn?.addEventListener("click", loadLocaleEntries)
el.localeSaveBtn?.addEventListener("click", saveLocaleEntries)
el.categorySelect?.addEventListener("change", loadLocaleEntries)
el.localeSelect?.addEventListener("change", loadLocaleEntries)
el.localeSearch?.addEventListener("input", filterLocaleEntries)

// Bootstrap: load locale list then auto-load entries
loadLocaleList().then(() => loadLocaleEntries())
