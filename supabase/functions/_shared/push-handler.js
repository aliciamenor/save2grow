// Daily push, spec 001 criterion 4: a small prioritized set per objective, oldest first, capped.
// No AI/LLM call anywhere in this file (criterion 6).

const DEFAULT_CAP_PER_OBJECTIVE = 3;

function triageKeyboard(itemId) {
  return {
    inline_keyboard: [
      [
        { text: "Borrar", callback_data: `triage:${itemId}:borrar` },
        { text: "Guardar como recurso", callback_data: `triage:${itemId}:recurso` },
        { text: "Pendiente", callback_data: `triage:${itemId}:pendiente` },
      ],
    ],
  };
}

export async function buildDailyPush(db, { capPerObjective = DEFAULT_CAP_PER_OBJECTIVE } = {}) {
  const objectives = await db.listAllObjectives();
  const sends = [];

  for (const objective of objectives) {
    const items = await db.getPendingItemsByObjective(objective.id, capPerObjective);
    for (const item of items) {
      sends.push({
        item,
        objective,
        chat_id: item.chat_id,
        text: `[${objective.name}] ${item.link}`,
        reply_markup: triageKeyboard(item.id),
      });
    }
  }

  return sends;
}

export async function runDailyPush(db, telegram, opts) {
  const sends = await buildDailyPush(db, opts);
  for (const send of sends) {
    await telegram.sendMessage(send.chat_id, send.text, send.reply_markup);
  }
  return sends;
}
