// Daily push, spec 002 criterion 3: a small prioritized set, oldest first, capped — no longer
// grouped by objective (spec 001's criterion 4 behavior, since objective is out of scope here).
// No AI/LLM call anywhere in this file (criterion 5).

const DEFAULT_CAP = 3;

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

export async function buildDailyPush(db, { cap = DEFAULT_CAP } = {}) {
  const items = await db.getPendingItems(cap);
  const sends = [];

  for (const item of items) {
    const reply_markup = triageKeyboard(item.id);
    if (item.image_path) {
      const photoUrl = await db.getSignedUrl(item.image_path);
      sends.push({ item, chat_id: item.chat_id, kind: "photo", photo: photoUrl, reply_markup });
    } else {
      sends.push({ item, chat_id: item.chat_id, kind: "text", text: item.link, reply_markup });
    }
  }

  return sends;
}

export async function runDailyPush(db, telegram, opts) {
  const sends = await buildDailyPush(db, opts);
  for (const send of sends) {
    if (send.kind === "photo") {
      await telegram.sendPhoto(send.chat_id, send.photo, send.reply_markup);
    } else {
      await telegram.sendMessage(send.chat_id, send.text, send.reply_markup);
    }
  }
  return sends;
}
