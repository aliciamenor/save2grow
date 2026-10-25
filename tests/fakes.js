// Shared in-memory fakes for the unit tests. No network, no real Supabase/Telegram — this is
// what makes the handlers testable without live credentials (spec 001 criteria 1-5 evals).

export function makeFakeDb(fixture = {}) {
  const state = {
    objectives: fixture.objectives ? [...fixture.objectives] : [],
    items: fixture.items ? [...fixture.items] : [],
    captures: fixture.captures ? [...fixture.captures] : [],
    pendingActions: fixture.pendingActions ? [...fixture.pendingActions] : [],
    nextId: fixture.nextId || 1000,
  };

  const calls = {
    insertObjective: [],
    insertItem: [],
    insertCapture: [],
    updateItemStatus: [],
    setPendingAction: [],
    deletePendingAction: [],
    deleteCapture: [],
  };

  function freshId() {
    return state.nextId++;
  }

  const db = {
    async listObjectives(chatId) {
      return state.objectives.filter((o) => o.chat_id === chatId);
    },
    async listAllObjectives() {
      return state.objectives;
    },
    async insertObjective(chatId, name) {
      const row = { id: freshId(), chat_id: chatId, name, created_at: new Date().toISOString() };
      state.objectives.push(row);
      calls.insertObjective.push(row);
      return row;
    },
    async insertCapture(chatId, link) {
      const row = { id: freshId(), chat_id: chatId, link, created_at: new Date().toISOString() };
      state.captures.push(row);
      calls.insertCapture.push(row);
      return row;
    },
    async getCapture(id) {
      return state.captures.find((c) => String(c.id) === String(id));
    },
    async deleteCapture(id) {
      calls.deleteCapture.push(id);
      state.captures = state.captures.filter((c) => String(c.id) !== String(id));
    },
    async insertItem({ objective_id, chat_id, link, status = "pending" }) {
      const row = {
        id: freshId(),
        objective_id,
        chat_id,
        link,
        status,
        created_at: new Date().toISOString(),
      };
      state.items.push(row);
      calls.insertItem.push(row);
      return row;
    },
    async getPendingItemsByObjective(objectiveId, limit) {
      return state.items
        .filter((i) => String(i.objective_id) === String(objectiveId) && i.status === "pending")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, limit);
    },
    async updateItemStatus(itemId, status) {
      calls.updateItemStatus.push({ itemId, status });
      const item = state.items.find((i) => String(i.id) === String(itemId));
      if (item) item.status = status;
      return item;
    },
    async setPendingAction(chatId, captureId) {
      calls.setPendingAction.push({ chatId, captureId });
      state.pendingActions = state.pendingActions.filter((p) => p.chat_id !== chatId);
      const row = { chat_id: chatId, kind: "awaiting_objective_name", capture_id: captureId };
      state.pendingActions.push(row);
      return row;
    },
    async getPendingAction(chatId) {
      return state.pendingActions.find((p) => p.chat_id === chatId) || null;
    },
    async deletePendingAction(chatId) {
      calls.deletePendingAction.push(chatId);
      state.pendingActions = state.pendingActions.filter((p) => p.chat_id !== chatId);
    },
  };

  return { db, state, calls };
}

export function makeFakeTelegram() {
  const sentMessages = [];
  const answeredCallbacks = [];

  const telegram = {
    async sendMessage(chatId, text, replyMarkup) {
      const payload = { chat_id: chatId, text, reply_markup: replyMarkup };
      sentMessages.push(payload);
      return payload;
    },
    async answerCallbackQuery(callbackQueryId, text) {
      const payload = { callback_query_id: callbackQueryId, text };
      answeredCallbacks.push(payload);
      return payload;
    },
  };

  return { telegram, sentMessages, answeredCallbacks };
}
