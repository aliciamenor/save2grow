// Core logic of the Telegram webhook, spec 001 criteria 1, 2, 3, 5.
//
// Pure-ish: takes its collaborators (db, telegram, onSenderId) as a `ctx` object instead of
// importing them, so unit tests can hand it fakes with no network and no real Supabase/Telegram.
// No AI/LLM call anywhere in this file (criterion 6).

const URL_RE = /https?:\/\/\S+/i;

const TRIAGE_STATUS_BY_ACTION = {
  borrar: "deleted",
  recurso: "resource",
  pendiente: "pending",
};

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

  const text = (message.text || "").trim();

  // Criterion 3: the next message after "+ nuevo objetivo" names the new objective.
  const pendingAction = await db.getPendingAction(chatId);
  if (pendingAction && pendingAction.kind === "awaiting_objective_name") {
    const name = text;
    const objective = await db.insertObjective(chatId, name);
    const capture = await db.getCapture(pendingAction.capture_id);
    const item = await db.insertItem({
      objective_id: objective.id,
      chat_id: chatId,
      link: capture.link,
      status: "pending",
    });
    await db.deleteCapture(capture.id);
    await db.deletePendingAction(chatId);
    await telegram.sendMessage(chatId, `Objetivo "${name}" creado. Guardado ahí.`);
    return { action: "objective_created_and_item_attached", objective, item };
  }

  // Criterion 1: forwarding a link creates a pending item (prompts for an objective first).
  if (URL_RE.test(text)) {
    const capture = await db.insertCapture(chatId, text);
    const objectives = await db.listObjectives(chatId);
    const buttons = objectives.map((o) => [
      { text: o.name, callback_data: `obj:${capture.id}:${o.id}` },
    ]);
    buttons.push([{ text: "+ nuevo objetivo", callback_data: `newobj:${capture.id}` }]);
    await telegram.sendMessage(chatId, "Elige un objetivo:", { inline_keyboard: buttons });
    return { action: "prompted_objective_selection", capture };
  }

  return { action: "ignored" };
}

async function handleCallbackQuery(callbackQuery, { db, telegram, onSenderId }) {
  const chatId = callbackQuery.message.chat.id;
  if (onSenderId) onSenderId(callbackQuery.from && callbackQuery.from.id);

  const data = callbackQuery.data || "";

  // Criterion 2: selecting an existing objective saves the item.
  if (data.startsWith("obj:")) {
    const [, captureId, objectiveId] = data.split(":");
    const capture = await db.getCapture(captureId);
    const item = await db.insertItem({
      objective_id: objectiveId,
      chat_id: chatId,
      link: capture.link,
      status: "pending",
    });
    await db.deleteCapture(capture.id);
    await telegram.answerCallbackQuery(callbackQuery.id, "Guardado.");
    return { action: "item_saved", item };
  }

  // Criterion 3, step 1: "+ nuevo objetivo" prompts for a name.
  if (data.startsWith("newobj:")) {
    const [, captureId] = data.split(":");
    await db.setPendingAction(chatId, captureId);
    await telegram.answerCallbackQuery(callbackQuery.id);
    await telegram.sendMessage(chatId, "¿Cómo se llama el nuevo objetivo?");
    return { action: "awaiting_objective_name" };
  }

  // Criterion 5: triage decision updates the item's status, nothing is blocked by it.
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
