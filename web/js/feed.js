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
// from the private bucket (never a public URL), each with its current status.
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
      });
    } else {
      viewModels.push({
        id: row.id,
        kind: "link",
        content: row.link,
        status: row.status,
        created_at: row.created_at,
      });
    }
  }
  return viewModels;
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
