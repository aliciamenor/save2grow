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
    return res.json();
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
