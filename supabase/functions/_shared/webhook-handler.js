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

const URL_RE = /https?:\/\/\S+/i;

const TRIAGE_STATUS_BY_ACTION = {
  borrar: "deleted",
  recurso: "resource",
  pendiente: "pending",
};

const CONFIRMATION_TEXT = "Guardado.";

export async function handleUpdate(update, ctx) {
  const { db, telegram, onSenderId } = ctx;

  if (update.message) {
    return handleMessage(update.message, { db, telegram, onSenderId });
  }

  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query, { db, telegram, onSenderId });
  }

  return { action: "unhandled" };
}

async function handleMessage(message, { db, telegram, onSenderId }) {
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
    const item = await db.insertItem({ chat_id: chatId, link: text, status: "pending" });
    await telegram.sendMessage(chatId, CONFIRMATION_TEXT);
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
