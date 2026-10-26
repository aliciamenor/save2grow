// Core logic of the Telegram webhook, spec 002 criteria 1, 2, 4.
//
// Pure-ish: takes its collaborators (db, telegram, onSenderId) as a `ctx` object instead of
// importing them, so unit tests can hand it fakes with no network and no real Supabase/Telegram.
// No AI/LLM call anywhere in this file (criterion 5).
//
// Spec 002 rolls back spec 001's objective-selection UI: no inline buttons, no
// "+ nuevo objetivo" flow, no `pending_actions` lookup. A link or a photo saves directly, with
// a short confirmation and nothing else (criterion 1, 2, 6). Objective selection returns in
// Fase 1, rebuilt against this simplified schema.

import { isYouTubeUrl } from "./youtube-oembed.js";

const URL_RE = /https?:\/\/\S+/i;

const TRIAGE_STATUS_BY_ACTION = {
  borrar: "deleted",
  recurso: "resource",
  pendiente: "pending",
};

const CONFIRMATION_TEXT = "Guardado.";

// Spec 005 criterion 2 — names where the existing item currently sits, instead of the normal
// "Guardado." confirmation. Keys are `items.status` values, same 3 as the triage map above.
const TAB_LABEL_BY_STATUS = {
  pending: "Pendientes",
  resource: "Recursos",
  deleted: "Borrados",
};

function duplicateReplyText(existingItem) {
  const label = TAB_LABEL_BY_STATUS[existingItem.status] || existingItem.status;
  return `Ya lo tienes guardado — está en ${label}.`;
}

export async function handleUpdate(update, ctx) {
  const { db, telegram, onSenderId, fetchOgPreview, fetchYouTubeOembed } = ctx;

  if (update.message) {
    return handleMessage(update.message, { db, telegram, onSenderId, fetchOgPreview, fetchYouTubeOembed });
  }

  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query, { db, telegram, onSenderId });
  }

  return { action: "unhandled" };
}

async function handleMessage(message, { db, telegram, onSenderId, fetchOgPreview, fetchYouTubeOembed }) {
  const chatId = message.chat.id;
  if (onSenderId) onSenderId(message.from && message.from.id);

  // Criterion 2: forwarding a photo saves it immediately — largest available size, downloaded
  // from Telegram and uploaded to the private `item-images` Supabase Storage bucket.
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    const file = await telegram.getFile(largest.file_id);
    const bytes = await telegram.downloadFile(file.file_path);
    const imagePath = `${chatId}/${Date.now()}-${largest.file_id}.jpg`;
    await db.uploadImage(imagePath, bytes, "image/jpeg");
    const item = await db.insertItem({ chat_id: chatId, image_path: imagePath, status: "pending" });
    await telegram.sendMessage(chatId, CONFIRMATION_TEXT);
    return { action: "item_saved", item };
  }

  const text = (message.text || "").trim();

  // Criterion 1: forwarding a link saves it immediately, no objective prompt.
  if (URL_RE.test(text)) {
    // Spec 005 criteria 1, 2: an exact match on the trimmed text against an existing item's
    // `link` (any status — closed decision, Gate 1, 2026-10-26) skips the insert entirely and
    // replies naming where the existing item currently sits, instead of "Guardado."
    const existing = await db.findItemByLink(text);
    if (existing) {
      await telegram.sendMessage(chatId, duplicateReplyText(existing));
      return { action: "duplicate", item: existing };
    }

    const item = await db.insertItem({ chat_id: chatId, link: text, status: "pending" });
    await telegram.sendMessage(chatId, CONFIRMATION_TEXT);
    // Spec 004 criterion 4: fetch the Open Graph preview once, right after the confirmation
    // reply — never blocking or breaking capture itself. `fetchOgPreview` is optional (older
    // callers, and most unit tests above, omit it); a fetch/parse failure already resolves to
    // `null` inside og-preview.js, and the try/catch here is a second line of defense so nothing
    // from this best-effort step can ever surface past the capture flow.
    if (fetchOgPreview || fetchYouTubeOembed) {
      try {
        const matchedUrl = text.match(URL_RE);
        const urlStr = matchedUrl && matchedUrl[0];
        console.log("og-preview: fetching", urlStr);
        // Spec 006 criterion 1: a YouTube URL is detected before the generic OG fetch runs, and
        // resolved via YouTube's own oEmbed endpoint instead — YouTube blocks the generic
        // scraper (spec 004's documented, accepted fallback case). A non-YouTube URL is
        // untouched and still goes through fetchOgPreview exactly as before.
        let preview = null;
        if (urlStr && isYouTubeUrl(urlStr) && fetchYouTubeOembed) {
          preview = await fetchYouTubeOembed(urlStr);
        } else if (urlStr && fetchOgPreview) {
          preview = await fetchOgPreview(urlStr);
        }
        console.log("og-preview: result", JSON.stringify(preview));
        if (preview) {
          await db.updateItemPreview(item.id, preview);
          console.log("og-preview: saved to item", item.id);
        }
      } catch (err) {
        console.error("link preview fetch failed:", err, err && err.stack);
      }
    }
    return { action: "item_saved", item };
  }

  return { action: "ignored" };
}

async function handleCallbackQuery(callbackQuery, { db, telegram, onSenderId }) {
  const chatId = callbackQuery.message.chat.id;
  if (onSenderId) onSenderId(callbackQuery.from && callbackQuery.from.id);

  const data = callbackQuery.data || "";

  // Criterion 4: triage still works exactly as in spec 001, unchanged — whether the item has a
  // link or an image, the status update is the same.
  if (data.startsWith("triage:")) {
    const [, itemId, decisionKey] = data.split(":");
    const status = TRIAGE_STATUS_BY_ACTION[decisionKey];
    if (status) {
      await db.updateItemStatus(itemId, status);
    }
    await telegram.answerCallbackQuery(callbackQuery.id, "Hecho.");
    return { action: "triaged", itemId, status };
  }

  return { action: "unhandled" };
}
