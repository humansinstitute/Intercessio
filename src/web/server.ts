#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { serve } from "bun";

import { ensureServerRunning } from "../api/server-control.js";
import { sendIPCRequest } from "../api/ipc.js";
import {
  listKeys,
  getActiveKeyId,
  setActiveKeyId,
  createKey,
  importKey as importKeyMaterial,
} from "../api/key-store.js";
import { DEFAULT_RELAYS } from "../api/constants.js";
import { log } from "../api/logger.js";
import { normalizeRelays } from "../api/relays.js";
import { listTemplateSummaries, DEFAULT_TEMPLATE_ID } from "../api/signing-templates.js";

const PORT = Number(process.env.INTERCESSIO_WEBUI_PORT ?? 4173);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function loadSessions() {
  await ensureServerRunning();
  const response = await sendIPCRequest({ type: "list-sessions" });
  if (!response.ok || !response.sessions) throw new HttpError(502, "Failed to fetch sessions from signing server.");
  return response.sessions;
}

async function loadActivity() {
  await ensureServerRunning();
  const response = await sendIPCRequest({ type: "list-activity" });
  if (!response.ok) throw new HttpError(502, "Failed to fetch activity from signing server.");
  return response.activity ?? [];
}

async function requireServerRunning() {
  try {
    await ensureServerRunning();
    return true;
  } catch {
    return false;
  }
}

async function resolveKeyId(preferred?: string) {
  if (preferred) return preferred;
  const active = await getActiveKeyId();
  if (active) return active;
  throw new HttpError(400, "Select or create a key first.");
}

function resolveTemplateId(templateId?: string) {
  const templates = listTemplateSummaries();
  if (!templateId) return DEFAULT_TEMPLATE_ID;
  const match = templates.find((tpl) => tpl.id === templateId);
  if (!match) throw new HttpError(400, "Unknown signing policy.");
  return match.id;
}

function randomSecret() {
  return randomBytes(16).toString("hex");
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Intercessio Web UI</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/intercessio-icon.png" />
    <link rel="manifest" href="/manifest.json" />
    <style>
      :root {
        color-scheme: light;
        font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --accent: #059669;
        --accent-strong: #047857;
        --accent-soft: #065f46;
        --bg: #ffffff;
        --bg-raised: #f8faf9;
        --bg-overlay: rgba(5, 150, 105, 0.1);
        --text: #1c1917;
        --text-muted: #2f3843;
        --border: #e7e5e4;
        --shadow: 0 18px 40px rgba(5, 150, 105, 0.12);
        --field-bg: #ffffff;
      }
      .menu-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 14px;
        border: 1px solid var(--accent);
        background: var(--bg-overlay);
        color: var(--accent-strong);
        font-size: 1.1rem;
        cursor: pointer;
        transition: background 200ms ease, transform 200ms ease;
      }
      .menu-toggle:hover {
        transform: translateY(-1px);
        background: rgba(5, 150, 105, 0.16);
      }
      .menu-panel {
        position: absolute;
        top: calc(100% + 0.6rem);
        right: 1rem;
        min-width: 200px;
        background: var(--bg-raised);
        border: 1px solid var(--border);
        border-radius: 12px;
        box-shadow: var(--shadow);
        padding: 0.75rem;
        display: none;
        flex-direction: column;
        gap: 0.5rem;
        z-index: 20;
      }
      .menu-panel.show {
        display: flex;
      }
      body.theme-dark {
        background: linear-gradient(160deg, #0a0a0a, #1c1917);
        color: #f5f5f4;
      }
      body.theme-dark header {
        background: rgba(28, 25, 23, 0.85);
        border-color: #44403c;
      }
      body.theme-dark .card {
        background: #292524;
        border-color: #44403c;
        box-shadow: 0 18px 40px rgba(16, 185, 129, 0.15);
      }
      body.theme-dark .session-card {
        background: rgba(15, 23, 42, 0.6);
      }
      body.theme-dark input,
      body.theme-dark textarea,
      body.theme-dark select {
        background: rgba(28, 25, 23, 0.8);
        border-color: #44403c;
        color: #f5f5f4;
      }
      body.theme-dark .muted {
        color: #d6d3d1;
      }
      body.theme-dark .status-pill {
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
      }
      body.theme-dark .list-card .meta {
        color: #d6d3d1;
      }
      body.theme-dark .session-meta {
        color: #d6d3d1;
      }
      body {
        margin: 0;
        padding: 0;
        min-height: 100vh;
        background: linear-gradient(160deg, #f9fafb, #f5f5f0);
        color: var(--text);
      }
      header {
        padding: 1.5rem 2rem;
        border-bottom: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(6px);
      }
      main {
        padding: 2rem;
        display: grid;
        gap: 1.5rem;
      }
      h1, h2 {
        margin: 0;
      }
      a {
        color: #38bdf8;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1.5rem;
      }
      .card {
        background: var(--bg-raised);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1.25rem;
        backdrop-filter: blur(6px);
        box-shadow: var(--shadow);
      }
      .card h2 {
        font-size: 1.25rem;
        margin: 0 0 0.75rem 0;
        color: var(--text);
        padding: 0.35rem 0;
      }
      label {
        display: flex;
        flex-direction: column;
        font-size: 0.85rem;
        color: var(--text-muted);
        margin-bottom: 0.75rem;
        gap: 0.4rem;
      }
      input, textarea, select, button {
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--field-bg);
        color: var(--text);
        padding: 0.55rem 0.75rem;
        font-size: 0.95rem;
      }
      textarea {
        resize: vertical;
        min-height: 60px;
      }
      button {
        cursor: pointer;
        border: none;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        font-weight: 600;
        transition: transform 120ms ease, box-shadow 120ms ease;
        box-shadow: none;
        color: #ffffff;
      }
      button:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 22px rgba(5, 150, 105, 0.25);
      }
      .copy-btn {
        margin-left: 0.5rem;
        padding: 0.35rem 0.65rem;
        font-size: 0.8rem;
      }
      .danger-btn {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        box-shadow: 0 6px 18px rgba(239, 68, 68, 0.4);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      td, th {
        border-bottom: 1px solid rgba(30, 41, 59, 0.8);
        padding: 0.5rem;
      }
      th {
        text-align: left;
        color: #94a3b8;
        font-weight: 500;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        font-size: 0.75rem;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
      }
      .status-pill.waiting {
        background: rgba(234, 179, 8, 0.2);
        color: #fcd34d;
      }
      .status-pill.stopped {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
      }
      .activity-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 320px;
        overflow-y: auto;
        font-size: 0.85rem;
      }
      .activity-item {
        padding: 0.65rem 0;
        border-bottom: 1px solid var(--border);
      }
      .activity-item small {
        color: var(--text-muted);
        display: block;
        font-size: 0.8rem;
      }
      .policy-control select,
      select.template-select {
        background: var(--field-bg);
        color: var(--text);
      }
      body.theme-dark .policy-control select,
      body.theme-dark select.template-select {
        background: rgba(28, 25, 23, 0.8);
        color: #f5f5f4;
      }
      .toast {
        position: fixed;
        right: 1.5rem;
        bottom: 1.5rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        background: var(--bg-raised);
        border: 1px solid var(--border);
        box-shadow: var(--shadow);
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 150ms ease, transform 150ms ease;
        color: var(--text);
      }
      .toast.show {
        opacity: 1;
        transform: translateY(0);
      }
      .muted {
        color: var(--text-muted);
        font-size: 0.85rem;
        overflow-wrap: anywhere;
      }
      .section-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        border: none;
        background: none;
        color: inherit;
        padding: 0;
        cursor: pointer;
        text-align: left;
        box-shadow: none;
      }
      .section-toggle h2 {
        margin: 0;
      }
      .section-toggle .chevron {
        display: none;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.75rem 0;
      }
      .modal {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.7);
        backdrop-filter: blur(4px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        z-index: 50;
      }
      .modal.show {
        display: flex;
      }
      .modal-content {
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 12px;
        padding: 1.25rem;
        width: min(520px, 100%);
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
        position: relative;
      }
      .modal-content h3 {
        margin-top: 0;
        margin-bottom: 0.75rem;
      }
      .modal-close {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: rgba(148, 163, 184, 0.15);
        color: #e2e8f0;
      }
      .list-cards {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .list-card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.75rem;
        background: var(--bg-raised);
      }
      .list-card .meta {
        color: #1f2937;
      }
      .list-card h4 {
        margin: 0 0 0.35rem 0;
      }
      .list-card .meta {
        font-size: 0.85rem;
        color: #1f2937;
        margin: 0.15rem 0;
      }
      .session-card {
        border: none;
        border-radius: 0;
        background: transparent;
        border-top: 1px solid var(--border);
        padding-top: 0.35rem;
      }
      .session-header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.85rem 0.1rem;
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        text-align: left;
        border-radius: 10px;
        box-shadow: none;
      }
      .session-title {
        font-weight: 600;
      }
      .chevron {
        display: none;
      }
      .session-details {
        padding: 0 0.9rem 0.9rem;
        display: none;
        background: transparent;
      }
      .session-meta {
        font-size: 0.9rem;
        color: var(--text-muted);
        margin: 0.25rem 0;
        overflow-wrap: anywhere;
      }
      .session-actions {
        margin-top: 0.5rem;
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
      }
    </style>
  </head>
  <body>
    <header>
      <div style="display:flex; align-items:center; gap:0.85rem;">
        <img src="/intercessio-icon.png" alt="Intercessio" style="width:44px;height:44px;border-radius:12px;box-shadow:0 6px 12px rgba(0,0,0,0.12);" />
        <div>
          <h1 style="margin:0;font-size:1.4rem;">Intercessio</h1>
          <p class="muted" style="margin:0;">Your signer, your policy</p>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:0.75rem; position:relative;">
        <button type="button" id="menu-toggle" class="menu-toggle" aria-expanded="false" style="position:fixed; right:1.5rem; top:1.5rem;">☰</button>
        <div id="menu-panel" class="menu-panel" style="position:fixed; right:1.5rem; top:4rem;">
          <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.9rem;">
            <span class="muted">Theme</span>
            <select id="theme-toggle" style="min-width:110px;">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </div>
      <div id="server-status-bar" style="position:absolute; bottom:0; left:0; right:0; height:4px; background:#f87171;"></div>
    </header>
    <main>
      <div class="grid">
        <section class="card">
          <button type="button" class="section-toggle" data-section="keys">
            <h2>Keys</h2>
            <span class="chevron">▸</span>
          </button>
          <div data-section-content="keys">
            <div class="actions">
              <button type="button" id="open-generate-key">Generate Key</button>
              <button type="button" id="open-import-key">Import Key</button>
            </div>
            <div id="keys-list" class="muted">Loading keys...</div>
          </div>
        </section>
      </div>
      <div class="grid">
        <section class="card">
          <button type="button" class="section-toggle" data-section="sessions">
            <h2>Sessions</h2>
            <span class="chevron">▸</span>
          </button>
          <div data-section-content="sessions">
            <div class="actions">
              <button type="button" id="open-bunker-modal">Create Bunker Session</button>
            </div>
            <div id="bunker-result" class="muted" style="margin-top:0.5rem;">Start a bunker session to see details here.</div>
            <div id="sessions-list" class="muted">Loading sessions...</div>
          </div>
        </section>
        <section class="card">
          <button type="button" class="section-toggle" data-section="activity">
            <h2>Activity</h2>
            <span class="chevron">▸</span>
          </button>
          <ul id="activity-list" class="activity-list" data-section-content="activity">
            <li class="muted">Waiting for activity...</li>
          </ul>
        </section>
      </div>
    </main>
    <div class="modal" id="generate-key-modal">
      <div class="modal-content">
        <button class="modal-close" type="button" data-close="generate-key-modal">Close</button>
        <h3>Generate Key</h3>
        <form id="generate-key-form">
          <label>Label (optional)
            <input name="label" autocomplete="off" placeholder="Key label" />
          </label>
          <button type="submit">Generate Key</button>
        </form>
      </div>
    </div>
    <div class="modal" id="import-key-modal">
      <div class="modal-content">
        <button class="modal-close" type="button" data-close="import-key-modal">Close</button>
        <h3>Import Key</h3>
        <form id="import-key-form">
          <label>Label (optional)
            <input name="label" autocomplete="off" placeholder="Imported key label" />
          </label>
          <label>Secret (nsec or hex)
            <textarea name="secret" placeholder="nsec1... or 64 char hex"></textarea>
          </label>
          <button type="submit">Import Key</button>
        </form>
      </div>
    </div>
    <div class="modal" id="bunker-modal">
      <div class="modal-content">
        <button class="modal-close" type="button" data-close="bunker-modal">Close</button>
        <h3>Create Bunker Session</h3>
        <form id="bunker-form">
          <label>Key
            <select name="keyId" id="bunker-key"></select>
          </label>
          <label>Alias
            <input name="alias" autocomplete="off" placeholder="Bunker alias" />
          </label>
          <label>Relays (comma separated)
            <input name="relays" autocomplete="off" placeholder="${DEFAULT_RELAYS.join(", ")}" />
          </label>
          <label>Secret (leave blank for random)
            <input name="secret" autocomplete="off" placeholder="Shared secret" />
          </label>
          <label>Signing policy
            <select name="template" id="bunker-template"></select>
          </label>
          <p class="muted" id="bunker-template-hint">Select a signing policy.</p>
          <label>
            <input type="checkbox" checked disabled /> Auto approve (required for headless)
          </label>
          <button type="submit">Start Bunker</button>
        </form>
      </div>
    </div>
    <div id="toast" class="toast"></div>
    <script>
      window.INTERCESSIO_DEFAULT_RELAYS = ${JSON.stringify(DEFAULT_RELAYS)};
      window.INTERCESSIO_DEFAULT_TEMPLATE = "${DEFAULT_TEMPLATE_ID}";
    </script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;

const APP_JS = `const state = {
  keys: [],
  activeKeyId: null,
  sessions: [],
  activity: [],
  templates: [],
};

const toastEl = document.getElementById("toast");
const keysList = document.getElementById("keys-list");
const sessionsList = document.getElementById("sessions-list");
const activityList = document.getElementById("activity-list");
const bunkerKeySelect = document.getElementById("bunker-key");
const bunkerTemplateSelect = document.getElementById("bunker-template");
const bunkerTemplateHint = document.getElementById("bunker-template-hint");
const bunkerResult = document.getElementById("bunker-result");
const serverStatus = document.getElementById("server-status");
const generateKeyModal = document.getElementById("generate-key-modal");
const importKeyModal = document.getElementById("import-key-modal");
const bunkerModal = document.getElementById("bunker-modal");
const menuToggle = document.getElementById("menu-toggle");
const menuPanel = document.getElementById("menu-panel");
const themeToggle = document.getElementById("theme-toggle");
const openGenerateKeyBtn = document.getElementById("open-generate-key");
const openImportKeyBtn = document.getElementById("open-import-key");
const openBunkerBtn = document.getElementById("open-bunker-modal");
const DEFAULT_TEMPLATE_ID = window.INTERCESSIO_DEFAULT_TEMPLATE || "auto_sign";
const expandedSessions = new Set();
const collapsedSections = new Set(["keys"]);

async function fetchJSON(path, options = {}) {
  const config = {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  };
  if (options.body && typeof options.body !== "string") {
    config.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, config);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || payload?.message || "Request failed");
  }
  return response.json().catch(() => ({}));
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2500);
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.add("show");
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove("show");
}

function setupModalBindings() {
  const pairs = [
    [openGenerateKeyBtn, generateKeyModal],
    [openImportKeyBtn, importKeyModal],
    [openBunkerBtn, bunkerModal],
  ];
  pairs.forEach(([trigger, modal]) => {
    if (!trigger || !modal) return;
    trigger.addEventListener("click", () => openModal(modal));
  });
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
  document.querySelectorAll(".modal-close").forEach((button) => {
    const targetId = button.dataset.close;
    const target = targetId ? document.getElementById(targetId) : button.closest(".modal");
    button.addEventListener("click", () => closeModal(target));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal.show").forEach((modal) => closeModal(modal));
    }
  });
}

setupModalBindings();

function setupSectionToggles() {
  document.querySelectorAll(".section-toggle").forEach((toggle) => {
    const section = toggle.dataset.section;
    if (!section) return;
    toggle.addEventListener("click", () => {
      if (collapsedSections.has(section)) {
        collapsedSections.delete(section);
      } else {
        collapsedSections.add(section);
      }
      applySectionVisibility();
    });
  });
  applySectionVisibility();
}

function applySectionVisibility() {
  document.querySelectorAll("[data-section-content]").forEach((el) => {
    const section = el.getAttribute("data-section-content");
    if (!section) return;
    const isCollapsed = collapsedSections.has(section);
    el.style.display = isCollapsed ? "none" : "";
    const chevron = document.querySelector('.section-toggle[data-section="' + section + '"] .chevron');
    if (chevron) {
      chevron.classList.toggle("open", !isCollapsed);
    }
  });
}

setupSectionToggles();

function setupThemeSwitcher() {
  if (!themeToggle) return;
  const saved = localStorage.getItem("intercessio_theme");
  const initial = saved === "dark" ? "dark" : "light";
  applyTheme(initial);
  themeToggle.value = initial;
  themeToggle.addEventListener("change", () => {
    const next = themeToggle.value === "dark" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem("intercessio_theme", next);
  });
}

function applyTheme(mode) {
  if (mode === "dark") {
    document.documentElement.style.setProperty("color-scheme", "dark");
    document.body.classList.add("theme-dark");
  } else {
    document.documentElement.style.setProperty("color-scheme", "light");
    document.body.classList.remove("theme-dark");
  }
}

function setupMenu() {
  if (!menuToggle || !menuPanel) return;
  const closeMenu = () => {
    menuPanel.classList.remove("show");
    menuToggle.setAttribute("aria-expanded", "false");
  };
  menuToggle.addEventListener("click", () => {
    const open = menuPanel.classList.toggle("show");
    menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", (event) => {
    if (!menuPanel.classList.contains("show")) return;
    const target = event.target;
    if (target === menuPanel || target === menuToggle || menuPanel.contains(target) || menuToggle.contains(target)) return;
    closeMenu();
  });
}

async function copyText(value) {
  if (!value) throw new Error("Nothing to copy.");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  } else {
    const tempInput = document.createElement("textarea");
    tempInput.value = value;
    tempInput.style.position = "fixed";
    tempInput.style.opacity = "0";
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  }
}

function renderKeys() {
  if (!state.keys.length) {
    keysList.textContent = "No keys yet. Generate or import one.";
    bunkerKeySelect.innerHTML = "<option value=''>No keys available</option>";
    return;
  }

const rows = state.keys
  .map((key) => {
    const label = key.label || "Unnamed key";
    const npubShort = key.npub.length > 28 ? key.npub.slice(0, 28) + "..." : key.npub;
    const created = new Date(key.createdAt).toLocaleString();
    return (
      '<div class="list-card">' +
      '<div style="display:flex; justify-content:space-between; gap:0.5rem; align-items:center;">' +
      "<h4>" +
      label +
      "</h4>" +
      "</div>" +
      '<div class="meta">npub: <span title="' +
      key.npub +
      '" style="overflow-wrap:anywhere;">' +
      npubShort +
      "</span></div>" +
      '<div class="meta">Created: ' +
      created +
      "</div>" +
      "</div>"
    );
  })
  .join("");

  keysList.innerHTML = '<div class="list-cards">' + rows + "</div>";

  bunkerKeySelect.innerHTML = state.keys
    .map((key) => {
      const optionLabel = key.label || "Unnamed key";
      const selected = key.id === state.activeKeyId ? " selected" : "";
      return '<option value="' + key.id + '"' + selected + ">" + optionLabel + "</option>";
    })
    .join("");
}

function getTemplateLabel(id) {
  const template = state.templates.find((tpl) => tpl.id === id);
  return template ? template.label : id;
}

function getTemplateDescription(id) {
  return state.templates.find((tpl) => tpl.id === id)?.description ?? "";
}

function renderTemplatePicker() {
  if (!bunkerTemplateSelect) return;
  if (!state.templates.length) {
    bunkerTemplateSelect.innerHTML = "<option value=''>No signing policies available</option>";
    return;
  }
  bunkerTemplateSelect.innerHTML = state.templates
    .map((template) => \`<option value="\${template.id}">\${template.label}</option>\`)
    .join("");
  if (!bunkerTemplateSelect.value) {
    const defaultOption = state.templates.find((tpl) => tpl.id === DEFAULT_TEMPLATE_ID);
    bunkerTemplateSelect.value = defaultOption ? defaultOption.id : state.templates[0].id;
  }
  updateTemplateHint();
}

function updateTemplateHint() {
  if (!bunkerTemplateHint || !bunkerTemplateSelect) return;
  const description = getTemplateDescription(bunkerTemplateSelect.value);
  bunkerTemplateHint.textContent = description || "Select a signing policy.";
}

function renderSessions() {
  if (!state.sessions.length) {
    sessionsList.textContent = "No sessions yet.";
    return;
  }
  const rows = state.sessions
    .map((session) => {
      const pillClass = session.active ? session.status : "stopped";
      const label = session.alias || session.id;
      const relays = session.relays.join(", ");
      const uri = session.uri
        ? '<div class="session-meta">URI: <span class="muted">' +
          session.uri +
          '</span> <button type="button" class="copy-btn" data-copy="' +
          session.uri +
          '">Copy</button></div>'
        : '<div class="session-meta">Pending bunker URI...</div>';
      const lastClient = session.lastClient ? '<div class="session-meta">Last client: ' + session.lastClient + "</div>" : "";
      const policyControls = buildPolicyControl(session);
      const expanded = expandedSessions.has(session.id);
      const header =
        '<button type="button" class="session-header session-toggle" data-session="' +
        session.id +
        '">' +
        '<span class="session-title">' +
        label +
        "</span>" +
        '<span class="status-pill ' +
        pillClass +
        '">' +
        (session.active ? session.status : "stopped") +
        "</span></button>";
      const details =
        '<div class="session-details" data-session="' +
        session.id +
        '" style="display:' +
        (expanded ? "block" : "none") +
        ';">' +
        '<div class="session-meta">' +
        session.type +
        " · key=" +
        session.keyId +
        "</div>" +
        '<div class="session-meta">Relays: ' +
        relays +
        "</div>" +
        policyControls +
        uri +
        lastClient +
        '<div class="session-actions">' +
        '<button type="button" class="copy-btn rename-session" data-session="' +
        session.id +
        '" data-alias="' +
        (session.alias || "") +
        '">Edit name</button>' +
        '<button type="button" class="copy-btn danger-btn delete-session" data-session="' +
        session.id +
        '">Delete</button>' +
        "</div>" +
        "</div>";
      return '<div class="session-card" data-session="' + session.id + '">' + header + details + "</div>";
    })
    .join("");
  sessionsList.innerHTML = rows;
}

function buildPolicyControl(session) {
  if (!state.templates.length) {
    return \`<div class="muted">Policy: \${session.template}</div>\`;
  }
  const options = state.templates
    .map((template) => \`<option value="\${template.id}" \${template.id === session.template ? "selected" : ""}>\${template.label}</option>\`)
    .join("");
  const description = getTemplateDescription(session.template);
  return \`<div class="policy-control">
    <label>Policy
      <select class="template-select" data-session="\${session.id}" data-current="\${session.template}">
        \${options}
      </select>
    </label>
    <small class="muted">\${description}</small>
  </div>\`;
}

function renderActivity() {
  if (!state.activity.length) {
    activityList.innerHTML = '<li class="muted">No signing activity captured yet.</li>';
    return;
  }
  const items = state.activity.slice(0, 20).map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const label = entry.sessionLabel || entry.sessionId || "session";
    return \`<li class="activity-item">
      <strong>\${entry.summary}</strong>
      <small>\${time} · \${label}</small>
    </li>\`;
  });
  activityList.innerHTML = items.join("");
}

async function refreshKeys() {
  const data = await fetchJSON("/api/keys");
  state.keys = data.keys || [];
  state.activeKeyId = data.activeKeyId;
  renderKeys();
}

async function refreshTemplates() {
  const data = await fetchJSON("/api/templates").catch(() => ({ templates: [] }));
  state.templates = data.templates || [];
  renderTemplatePicker();
  renderSessions();
}

async function refreshSessions() {
  const data = await fetchJSON("/api/sessions").catch(() => ({ sessions: [] }));
  state.sessions = data.sessions || [];
  renderSessions();
}

async function refreshActivity() {
  const data = await fetchJSON("/api/activity").catch(() => ({ activity: [] }));
  state.activity = data.activity || [];
  renderActivity();
}

async function refreshStatus() {
  const data = await fetchJSON("/api/status").catch(() => ({ serverRunning: false }));
  const bar = document.getElementById("server-status-bar");
  if (bar) {
    bar.style.background = data.serverRunning ? "#10b981" : "#ef4444";
  }
  document.body.setAttribute("data-server-running", data.serverRunning ? "true" : "false");
}

document.getElementById("generate-key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const label = form.label.value;
  await fetchJSON("/api/keys/generate", { method: "POST", body: { label } });
  form.reset();
  showToast("Key generated.");
  closeModal(generateKeyModal);
  await refreshKeys();
});

document.getElementById("import-key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const label = form.label.value;
  const secret = form.secret.value;
  await fetchJSON("/api/keys/import", { method: "POST", body: { label, secret } });
  form.reset();
  showToast("Key imported.");
  closeModal(importKeyModal);
  await refreshKeys();
});

document.getElementById("bunker-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const relaysInput = form.relays.value
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const payload = {
    keyId: form.keyId.value || undefined,
    alias: form.alias.value || undefined,
    relays: relaysInput.length ? relaysInput : undefined,
    secret: form.secret.value || undefined,
    autoApprove: true,
    template: bunkerTemplateSelect?.value || DEFAULT_TEMPLATE_ID,
  };
  const result = await fetchJSON("/api/bunker", { method: "POST", body: payload });
  const uri = result.bunkerUri
    ? \`<div><strong>URI:</strong> \${result.bunkerUri} <button type="button" class="copy-btn" data-copy="\${result.bunkerUri}">Copy</button></div>\`
    : "<div>Waiting for bunker URI...</div>";
  bunkerResult.innerHTML = \`
    <div><strong>Session ID:</strong> \${result.sessionId}</div>
    <div><strong>Secret:</strong> \${result.secret}</div>
    \${uri}
  \`;
  showToast("Bunker session requested.");
  form.reset();
  updateTemplateHint();
  closeModal(bunkerModal);
  await refreshSessions();
});

bunkerTemplateSelect?.addEventListener("change", () => {
  updateTemplateHint();
});

bunkerResult.addEventListener("click", async (event) => {
  const target = event.target;
  if (target.matches("button.copy-btn")) {
    const value = target.dataset.copy;
    if (!value) return;
    try {
      await copyText(value);
      showToast("Bunker URI copied.");
    } catch {
      showToast("Unable to copy bunker URI.");
    }
  }
});

sessionsList.addEventListener("change", async (event) => {
  const target = event.target;
  if (!target.matches || !target.matches("select.template-select")) return;
  const select = target;
  const sessionId = select.dataset.session;
  if (!sessionId) return;
  const previous = select.dataset.current;
  try {
    await fetchJSON("/api/sessions/template", { method: "POST", body: { sessionId, template: select.value } });
    select.dataset.current = select.value;
    showToast("Signing policy updated.");
    await refreshSessions();
  } catch (error) {
    if (previous) select.value = previous;
    showToast(error instanceof Error ? error.message : String(error));
  }
});

sessionsList.addEventListener("click", async (event) => {
  const target = event.target;
  const toggle = target.closest ? target.closest(".session-toggle") : null;
  if (toggle) {
    const sessionId = toggle.dataset.session;
    if (sessionId) {
      if (expandedSessions.has(sessionId)) {
        expandedSessions.delete(sessionId);
      } else {
        expandedSessions.add(sessionId);
      }
      renderSessions();
    }
    return;
  }
  if (target.matches("button.rename-session")) {
    const sessionId = target.dataset.session;
    if (!sessionId) return;
    const currentAlias = target.dataset.alias || "";
    const nextAlias = window.prompt("Enter session name", currentAlias);
    if (nextAlias === null) return;
    await fetchJSON("/api/sessions/rename", { method: "POST", body: { sessionId, alias: nextAlias || undefined } });
    showToast("Session name updated.");
    await refreshSessions();
    return;
  }
  if (target.matches("button.copy-btn")) {
    const value = target.dataset.copy;
    if (!value) return;
    try {
      await copyText(value);
      showToast("Bunker URI copied.");
    } catch {
      showToast("Unable to copy bunker URI.");
    }
    return;
  }
  if (target.matches("button.delete-session")) {
    const sessionId = target.dataset.session;
    if (!sessionId) return;
    const confirmDelete = window.confirm("Delete this session? This removes it from the signing server.");
    if (!confirmDelete) return;
    await fetchJSON("/api/sessions/delete", { method: "POST", body: { sessionId } });
    showToast("Session deleted.");
    await refreshSessions();
  }
});

async function init() {
  setupMenu();
  setupThemeSwitcher();
  await Promise.all([refreshKeys(), refreshTemplates(), refreshSessions(), refreshActivity(), refreshStatus()]);
  setInterval(refreshSessions, 5000);
  setInterval(refreshActivity, 5000);
  setInterval(refreshStatus, 8000);
}

init().catch((error) => {
  console.error(error);
  serverStatus.textContent = "Failed to load web UI data.";
  serverStatus.style.color = "#f87171";
});

let touchStartY = 0;
let isPulling = false;
let pullFrame;

function setupPullToRefresh() {
  window.addEventListener("touchstart", (event) => {
    if (window.scrollY > 0) return;
    touchStartY = event.touches[0].clientY;
    isPulling = true;
  });
  window.addEventListener("touchmove", (event) => {
    if (!isPulling) return;
    const currentY = event.touches[0].clientY;
    if (currentY - touchStartY > 80 && window.scrollY === 0) {
      isPulling = false;
      clearTimeout(pullFrame);
      pullFrame = setTimeout(() => {
        window.location.reload();
      }, 50);
    }
  });
  window.addEventListener("touchend", () => {
    isPulling = false;
  });
}
setupPullToRefresh();
`;

async function apiRouter(request: Request, url: URL) {
  try {
    if (request.method === "GET" && url.pathname === "/api/status") {
      const running = await requireServerRunning();
      return jsonResponse({ serverRunning: running });
    }
    if (request.method === "GET" && url.pathname === "/api/keys") {
      const [keys, activeKeyId] = await Promise.all([listKeys(), getActiveKeyId()]);
      return jsonResponse({ keys, activeKeyId });
    }
    if (request.method === "GET" && url.pathname === "/api/templates") {
      const templates = listTemplateSummaries();
      return jsonResponse({ templates });
    }
    if (request.method === "POST" && url.pathname === "/api/keys/generate") {
      const body = await parseJson(request);
      const key = await createKey(body?.label);
      return jsonResponse({ key });
    }
    if (request.method === "POST" && url.pathname === "/api/keys/import") {
      const body = await parseJson(request);
      if (typeof body?.secret !== "string") throw new HttpError(400, "Secret is required.");
      const key = await importKeyMaterial(body.secret, body.label);
      return jsonResponse({ key });
    }
    if (request.method === "POST" && url.pathname === "/api/keys/active") {
      const body = await parseJson(request);
      if (typeof body?.keyId !== "string") throw new HttpError(400, "keyId is required.");
      await setActiveKeyId(body.keyId);
      return jsonResponse({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/sessions") {
      const sessions = await loadSessions();
      return jsonResponse({ sessions });
    }
    if (request.method === "GET" && url.pathname === "/api/activity") {
      const activity = await loadActivity();
      return jsonResponse({ activity });
    }
    if (request.method === "POST" && url.pathname === "/api/sessions/delete") {
      const body = await parseJson(request);
      if (typeof body?.sessionId !== "string") throw new HttpError(400, "sessionId is required.");
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "delete-session", sessionId: body.sessionId });
      if (!response.ok) throw new HttpError(502, response.error ?? "Failed to delete session.");
      return jsonResponse({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/sessions/rename") {
      const body = await parseJson(request);
      if (typeof body?.sessionId !== "string") throw new HttpError(400, "sessionId is required.");
      const alias = typeof body?.alias === "string" && body.alias.trim().length ? body.alias.trim() : "";
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "rename-session", sessionId: body.sessionId, alias });
      if (!response.ok) throw new HttpError(502, response.error ?? "Failed to rename session.");
      return jsonResponse({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/bunker") {
      const body = await parseJson(request);
      const keyId = await resolveKeyId(typeof body?.keyId === "string" ? body.keyId : undefined);
      const alias = typeof body?.alias === "string" && body.alias.trim().length ? body.alias.trim() : undefined;
      const relays = Array.isArray(body?.relays) ? body.relays.map(String) : undefined;
      const secret = typeof body?.secret === "string" && body.secret.trim() ? body.secret.trim() : randomSecret();
      const template = resolveTemplateId(typeof body?.template === "string" ? body.template : undefined);
      const relayList = normalizeRelays(relays);
      await ensureServerRunning();
      const response = await sendIPCRequest({
        type: "start-bunker",
        keyId,
        alias,
        relays: relayList,
        secret,
        autoApprove: true,
        template,
      });
      if (!response.ok) throw new HttpError(502, response.error);
      return jsonResponse({ bunkerUri: response.bunkerUri, sessionId: response.sessionId, secret });
    }
    if (request.method === "POST" && url.pathname === "/api/sessions/template") {
      const body = await parseJson(request);
      if (typeof body?.sessionId !== "string") throw new HttpError(400, "sessionId is required.");
      if (typeof body?.template !== "string") throw new HttpError(400, "template is required.");
      const template = resolveTemplateId(body.template);
      await ensureServerRunning();
      const response = await sendIPCRequest({
        type: "update-session-template",
        sessionId: body.sessionId,
        template,
      });
      if (!response.ok) throw new HttpError(502, response.error ?? "Failed to update session template.");
      return jsonResponse({ ok: true });
    }
    throw new HttpError(404, "Route not found.");
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    log.error(error instanceof Error ? error.message : String(error));
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

serve({
  port: PORT,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return apiRouter(request, url);
    }
    if (url.pathname === "/app.js") {
      return new Response(APP_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }
    if (url.pathname === "/manifest.json") {
      return new Response(await Bun.file(new URL("./manifest.json", import.meta.url)).text(), {
        headers: { "content-type": "application/manifest+json; charset=utf-8" },
      });
    }
    if (url.pathname === "/intercessio-icon.png") {
      const file = Bun.file(new URL("./public/intercessio-icon.png", import.meta.url));
      if (await file.exists()) {
        return new Response(file, { headers: { "content-type": "image/png" } });
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
});

log.info(`Intercessio web UI available on http://localhost:${PORT}`);
