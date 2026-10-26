// Spec 004 — DOM wiring only. All data/triage/card logic lives in feed.js (unit tested); this
// file reads the form, calls feed.js, and writes the DOM — same split as index.ts vs
// _shared/*.js in the Telegram bot (decisions.md, 2026-10-26), so it is not unit tested, same as
// that wiring layer. The one exception is the triage-visibility decision (criterion 1), which
// is extracted into feed.js's `remainsInTab` precisely so it can be tested without a DOM — see
// tests/web-feed.test.js.
import { SUPABASE_URL, SUPABASE_ANON_KEY, REDIRECT_URL } from "./config.js";
import {
  fetchFeed,
  triageItem,
  applyTriageResult,
  remainsInTab,
  filterByTab,
  countsByTab,
  buildCard,
  TABS,
} from "./feed.js";

// `supabase` is the global the CDN UMD bundle attaches to `window` (loaded via <script> in
// index.html) — no bundler, no npm install, per this repo's zero-dependency pattern.
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginSection = document.getElementById("login-section");
const feedSection = document.getElementById("feed-section");
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const feedList = document.getElementById("feed-list");
const emptyState = document.getElementById("empty-state");
const tabsNav = document.getElementById("tabs");
const logoutButton = document.getElementById("logout-button");

let viewModels = [];
let activeTab = "pendientes"; // criterion 2: Pendientes is the default tab.

function showLoggedOut() {
  loginSection.hidden = false;
  feedSection.hidden = true;
}

function showLoggedIn() {
  loginSection.hidden = true;
  feedSection.hidden = false;
}

// --- Icons (criterion 6) — simple inline SVG line icons, consistent stroke width, no icon
// library dependency (delegated decision). Each action's accessible name is the Spanish verb
// phrase it performs, since icon-only buttons still need one.

const ICONS = {
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
  resource: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.8-9.1C.7 8 2 4.8 5 3.8c2-.6 4 .1 5.2 1.8l1.8 2.4 1.8-2.4C15 3.9 17 3.2 19 3.8c3 1 4.3 4.2 2.8 7.6-2.3 4.5-9.8 9.1-9.8 9.1z"/></svg>`,
  pending: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
};

const PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-6 6-3-3-3 3"/></svg>`;

const DECISION_BY_ICON = [
  { decision: "delete", icon: "delete", label: "Borrar", className: "icon-delete" },
  { decision: "resource", icon: "resource", label: "Guardar como recurso", className: "icon-resource" },
  { decision: "pending", icon: "pending", label: "Pendiente", className: "icon-pending" },
];

// --- Tabs (criterion 2) ---------------------------------------------------------------------

function renderTabs() {
  const counts = countsByTab(viewModels);
  tabsNav.innerHTML = "";
  for (const tab of TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab.key === activeTab));
    const count = counts[tab.key] || 0;
    button.textContent = tab.key === "pendientes" ? `${tab.label} (${count})` : tab.label;
    button.addEventListener("click", () => {
      activeTab = tab.key;
      renderTabs();
      renderFeed();
    });
    tabsNav.appendChild(button);
  }
}

// --- Cards (criteria 4, 5, 6) ----------------------------------------------------------------

function buildVisualEl(visual) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-visual";
  if (visual.type === "image") {
    wrapper.appendChild(Object.assign(document.createElement("img"), { src: visual.src, alt: "" }));
  } else {
    wrapper.classList.add("placeholder");
    wrapper.innerHTML = PLACEHOLDER_SVG;
  }
  return wrapper;
}

function buildCardEl(vm) {
  const card = buildCard(vm);

  const li = document.createElement("li");
  li.dataset.itemId = String(vm.id);
  li.className = "card";

  // The whole visual+text block is one link when the card has somewhere to go (any link kind —
  // "link-preview" had no clickable element at all before this fix, "link-plain" already had one
  // on its own text). Image items have no href and render unwrapped, same as before. The triage
  // icons stay outside this anchor as siblings, never nested inside it (a button inside an <a>
  // fires both actions on click).
  const contentWrap = card.href
    ? Object.assign(document.createElement("a"), {
        className: "card-content-link",
        href: card.href,
        target: "_blank",
        rel: "noopener noreferrer",
      })
    : document.createElement("div");
  contentWrap.className = card.href ? "card-content-link" : "card-content";

  contentWrap.appendChild(buildVisualEl(card.visual));

  const body = document.createElement("div");
  body.className = "card-body";

  if (card.heading) {
    body.appendChild(Object.assign(document.createElement("p"), { className: "card-heading", textContent: card.heading }));
  }
  if (card.body) {
    const bodyClass = card.kind === "link-plain" ? "card-text card-link" : "card-text";
    body.appendChild(Object.assign(document.createElement("p"), { className: bodyClass, textContent: card.body }));
  }
  body.appendChild(Object.assign(document.createElement("span"), { className: "card-timestamp", textContent: card.timestamp }));
  contentWrap.appendChild(body);
  li.appendChild(contentWrap);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  for (const { decision, icon, label, className } of DECISION_BY_ICON) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-button ${className}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = ICONS[icon];
    button.addEventListener("click", () => onTriage(vm.id, decision, li));
    actions.appendChild(button);
  }
  li.appendChild(actions);

  return li;
}

function renderFeed() {
  feedList.innerHTML = "";
  const visible = filterByTab(viewModels, activeTab);
  emptyState.hidden = visible.length > 0;
  for (const vm of visible) {
    feedList.appendChild(buildCardEl(vm));
  }
}

// Criterion 1: triage moves an item between tabs, no page reload, the same code path from any
// tab (including the Borrados → Pendiente restore case). `remainsInTab` (feed.js, unit tested)
// is the only decision made here; this function's own DOM removal is deliberately left
// untested, same convention as the rest of this file.
async function onTriage(itemId, decision, li) {
  const newStatus = await triageItem(client, itemId, decision);
  viewModels = applyTriageResult(viewModels, itemId, newStatus);
  renderTabs();
  if (!remainsInTab(newStatus, activeTab)) {
    li.remove();
    if (filterByTab(viewModels, activeTab).length === 0) emptyState.hidden = false;
  }
}

async function loadFeed() {
  viewModels = await fetchFeed(client);
  renderTabs();
  renderFeed();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("email-input").value.trim();
  loginMessage.textContent = "";
  try {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: REDIRECT_URL },
    });
    if (error) throw error;
    loginMessage.textContent = "Revisa tu email.";
  } catch {
    // Criterion 2 (spec 003): no stack traces, no raw API responses shown to the user.
    loginMessage.textContent = "No se pudo enviar el enlace. Inténtalo de nuevo.";
  }
});

logoutButton.addEventListener("click", async () => {
  await client.auth.signOut();
});

client.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showLoggedIn();
    loadFeed();
  } else {
    showLoggedOut();
  }
});

// Criterion 3 (spec 003): session persists across reload — getSession() reads the client's own
// local storage, restoring it without a fresh login.
client.auth.getSession().then(({ data }) => {
  if (data.session) {
    showLoggedIn();
    loadFeed();
  } else {
    showLoggedOut();
  }
});
