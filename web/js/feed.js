// Spec 003 — pure, DOM-free feed logic. Kept separate from app.js (the DOM wiring) so it can be
// unit tested under Node with a fake Supabase client, the same split this repo already uses
// between supabase/functions/_shared/*.js (tested) and the index.ts wiring (untested, see
// ARCHITECTURE.md).

export const IMAGE_BUCKET = "item-images";

// Delegated decision (specs/done/003-local-feed-with-auth.md): long enough that a normal
// browsing session doesn't hit expired links mid-scroll, short enough that a copied/leaked URL
// goes stale soon after. Matches the expiry already used for the Telegram daily push
// (supabase/functions/_shared/db.js#getSignedUrl default).
export const SIGNED_URL_EXPIRES_IN = 3600;

// Criterion 4: everything saved, newest first, links as clickable text, images as a signed URL
// from the private bucket (never a public URL), each with its current status. Spec 004 adds the
// link-preview fields (null for an image item, or a link with no OG tags / a failed fetch).
export async function fetchFeed(supabase) {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const viewModels = [];
  for (const row of rows) {
    if (row.image_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .createSignedUrl(row.image_path, SIGNED_URL_EXPIRES_IN);
      if (signErr) throw signErr;
      viewModels.push({
        id: row.id,
        kind: "image",
        content: signed.signedUrl,
        status: row.status,
        created_at: row.created_at,
        preview: null,
      });
    } else {
      const hasPreview = row.preview_title || row.preview_description || row.preview_image_url;
      viewModels.push({
        id: row.id,
        kind: "link",
        content: row.link,
        status: row.status,
        created_at: row.created_at,
        preview: hasPreview
          ? {
              title: row.preview_title || null,
              description: row.preview_description || null,
              image: row.preview_image_url || null,
            }
          : null,
      });
    }
  }
  return viewModels;
}

// --- Spec 004 — tabs (criterion 2) -----------------------------------------------------------

// Order matters: this is the display order of the tabs, Pendientes first (the default tab).
export const TABS = [
  { key: "pendientes", label: "Pendientes", status: "pending" },
  { key: "recursos", label: "Recursos", status: "resource" },
  { key: "borrados", label: "Borrados", status: "deleted" },
];

const STATUS_BY_TAB_KEY = Object.fromEntries(TABS.map((t) => [t.key, t.status]));

// Criterion 2: each tab's filtered list, by `status`.
export function filterByTab(viewModels, tabKey) {
  const status = STATUS_BY_TAB_KEY[tabKey];
  if (!status) throw new Error(`unknown tab: ${tabKey}`);
  return viewModels.filter((vm) => vm.status === status);
}

// Criterion 2: "Pendientes (3)" — a count per tab, read off the same view models (no separate
// query), so the count and the filtered list can never disagree.
export function countsByTab(viewModels) {
  const counts = {};
  for (const tab of TABS) counts[tab.key] = 0;
  for (const vm of viewModels) {
    const tab = TABS.find((t) => t.status === vm.status);
    if (tab) counts[tab.key] += 1;
  }
  return counts;
}

// --- Spec 004 — relative time (criterion 3) --------------------------------------------------

// Delegated decision (specs/done/004-feed-ux-and-gaping-styling.md), recorded in decisions.md:
// buckets by elapsed duration only (not calendar-day boundaries), in this order — under a
// minute reads as "hoy" (saved moments ago, today), then minutes, hours, days, and weeks.
export function relativeTime(createdAt, now = new Date()) {
  const diffMs = new Date(now).getTime() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  const weeks = Math.floor(days / 7);

  if (minutes < 1) return "hoy";
  if (minutes < 60) return minutes === 1 ? "hace 1 minuto" : `hace ${minutes} minutos`;
  if (hours < 24) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  if (days < 7) return days === 1 ? "hace 1 día" : `hace ${days} días`;
  return weeks === 1 ? "hace 1 semana" : `hace ${weeks} semanas`;
}

// --- Spec 004 — one shared card model for all 3 content kinds (criteria 4, 5) ----------------

// Pure data, no DOM: one function builds the same shape for every item, differing only in the
// `visual` and `heading`/`body` slots, so app.js renders one card component, not three unrelated
// layouts (criterion 5). `visual.type` is "image" (a real picture to show) or "placeholder" (the
// neutral block for a plain link with no OG image).
export function buildCard(viewModel, now = new Date()) {
  const timestamp = relativeTime(viewModel.created_at, now);

  if (viewModel.kind === "image") {
    return {
      kind: "image",
      visual: { type: "image", src: viewModel.content },
      heading: null,
      body: null,
      href: null,
      timestamp,
    };
  }

  if (viewModel.preview) {
    return {
      kind: "link-preview",
      visual: viewModel.preview.image
        ? { type: "image", src: viewModel.preview.image }
        : { type: "placeholder" },
      heading: viewModel.preview.title,
      body: viewModel.preview.description,
      href: viewModel.content,
      timestamp,
    };
  }

  // Criterion 4: a link with no OG tags (or a failed/timed-out fetch) falls back to today's
  // plain clickable link — never blocks or breaks capture, and renders through the same card.
  return {
    kind: "link-plain",
    visual: { type: "placeholder" },
    heading: null,
    body: viewModel.content,
    href: viewModel.content,
    timestamp,
  };
}

// Same 3 triage decisions as the Telegram push's inline keyboard (criterion 5).
export const DECISION_TO_STATUS = {
  delete: "deleted",
  resource: "resource",
  pending: "pending",
};

export async function triageItem(supabase, itemId, decision) {
  const status = DECISION_TO_STATUS[decision];
  if (!status) throw new Error(`unknown triage decision: ${decision}`);
  const { error } = await supabase.from("items").update({ status }).eq("id", itemId);
  if (error) throw error;
  return status;
}

// Pure in-memory state update, so the page can patch one item's status without a full re-render
// or page reload (criterion 5) — app.js calls this, then writes just that item's status text.
export function applyTriageResult(viewModels, itemId, newStatus) {
  return viewModels.map((vm) =>
    String(vm.id) === String(itemId) ? { ...vm, status: newStatus } : vm,
  );
}

// Spec 004 criterion 1: whether an item, after a triage decision, should still be shown in the
// tab it was triaged from. app.js's click handler (the DOM-move logic, extracted here so it is
// testable without a DOM, same split as the rest of this file) calls this right after
// `applyTriageResult` to decide whether to remove the item's DOM node from the current tab's
// list — "Borrar" moves it to Borrados (it leaves every other tab), restoring from Borrados with
// "Pendiente" is the exact same path, just a different starting tab.
export function remainsInTab(newStatus, currentTabKey) {
  return STATUS_BY_TAB_KEY[currentTabKey] === newStatus;
}
