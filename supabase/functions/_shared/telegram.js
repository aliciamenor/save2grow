// Thin fetch-based wrapper over the Telegram Bot API. No AI/LLM SDK involved (spec 001,
// criterion 6) — this only talks to Telegram's HTTP API.

export function makeTelegram(token) {
  const base = `https://api.telegram.org/bot${token}`;

  async function call(method, body) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      // Telegram's API returns 200 with {ok:false, description:...} on most call errors — an
      // HTTP-status-only check would miss this. Surface it loudly instead of returning silently,
      // so a bad reply_markup or stale token shows up in the function logs instead of just
      // "nothing happened" on the user's end.
      console.error(`telegram API error on ${method}:`, JSON.stringify(json));
    }
    return json;
  }

  return {
    async sendMessage(chatId, text, replyMarkup) {
      const body = { chat_id: chatId, text };
      if (replyMarkup) body.reply_markup = replyMarkup;
      return call("sendMessage", body);
    },

    async answerCallbackQuery(callbackQueryId, text) {
      const body = { callback_query_id: callbackQueryId };
      if (text) body.text = text;
      return call("answerCallbackQuery", body);
    },
  };
}
