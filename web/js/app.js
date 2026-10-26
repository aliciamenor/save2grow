// Spec 003 — DOM wiring only. All data/triage logic lives in feed.js (unit tested); this file
// only reads the form, calls feed.js, and writes the DOM — same split as index.ts vs
// _shared/*.js in the Telegram bot, so it is not unit tested, same as that wiring layer.
import { SUPABASE_URL, SUPABASE_ANON_KEY, REDIRECT_URL } from "./config.js";
import { fetchFeed, triageItem, applyTriageResult } from "./feed.js";

// `supabase` is the global the CDN UMD bundle attaches to `window` (loaded via <script> in
// index.html) — no bundler, no npm install, per this repo's zero-dependency pattern.
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginSection = document.getElementById("login-section");
const feedSection = document.getElementById("feed-section");
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const feedList = document.getElementById("feed-list");
const logoutButton = document.getElementById("logout-button");

let viewModels = [];

function showLoggedOut() {
  loginSection.hidden = false;
  feedSection.hidden = true;
}

function showLoggedIn() {
  loginSection.hidden = true;
  feedSection.hidden = false;
}

const STATUS_LABEL = {
  pending: "Pendiente",
  resource: "Recurso",
  deleted: "Borrado",
};

function renderFeed() {
  feedList.innerHTML = "";
  for (const vm of viewModels) {
    const li = document.createElement("li");
    li.dataset.itemId = String(vm.id);
    li.className = "feed-item";

    const contentEl =
      vm.kind === "image"
        ? Object.assign(document.createElement("img"), { src: vm.content, alt: "imagen guardada" })
        : Object.assign(document.createElement("a"), {
            href: vm.content,
            textContent: vm.content,
            target: "_blank",
            rel: "noopener noreferrer",
          });
    li.appendChild(contentEl);

    const statusEl = document.createElement("span");
    statusEl.className = "status";
    statusEl.textContent = STATUS_LABEL[vm.status] || vm.status;
    li.appendChild(statusEl);

    const actions = document.createElement("div");
    actions.className = "actions";
    for (const [decision, label] of [
      ["delete", "Borrar"],
      ["resource", "Guardar como recurso"],
      ["pending", "Pendiente"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("click", () => onTriage(vm.id, decision, statusEl));
      actions.appendChild(button);
    }
    li.appendChild(actions);

    feedList.appendChild(li);
  }
}

async function onTriage(itemId, decision, statusEl) {
  const newStatus = await triageItem(client, itemId, decision);
  viewModels = applyTriageResult(viewModels, itemId, newStatus);
  // Patch just this item's status text — no full re-render, no page reload (criterion 5).
  statusEl.textContent = STATUS_LABEL[newStatus] || newStatus;
}

async function loadFeed() {
  viewModels = await fetchFeed(client);
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
    // Criterion 2: no stack traces, no raw API responses shown to the user.
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

// Criterion 3: session persists across reload — getSession() reads the client's own local
// storage, restoring it without a fresh login.
client.auth.getSession().then(({ data }) => {
  if (data.session) {
    showLoggedIn();
    loadFeed();
  } else {
    showLoggedOut();
  }
});
