// Shared in-memory fakes for the unit tests. No network, no real Supabase/Telegram — this is
// what makes the handlers testable without live credentials (spec 002 criteria 1-4 evals).

export function makeFakeDb(fixture = {}) {
  const state = {
    items: fixture.items ? [...fixture.items] : [],
    images: fixture.images ? { ...fixture.images } : {},
    nextId: fixture.nextId || 1000,
  };

  const calls = {
    insertItem: [],
    updateItemStatus: [],
    uploadImage: [],
    getSignedUrl: [],
  };

  function freshId() {
    return state.nextId++;
  }

  const db = {
    async insertItem({ chat_id, link = null, image_path = null, status = "pending" }) {
      const row = {
        id: freshId(),
        chat_id,
        link,
        image_path,
        status,
        created_at: new Date().toISOString(),
      };
      state.items.push(row);
      calls.insertItem.push(row);
      return row;
    },
    async getPendingItems(limit) {
      return state.items
        .filter((i) => i.status === "pending")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, limit);
    },
    async updateItemStatus(itemId, status) {
      calls.updateItemStatus.push({ itemId, status });
      const item = state.items.find((i) => String(i.id) === String(itemId));
      if (item) item.status = status;
      return item;
    },
    async uploadImage(path, bytes, contentType) {
      calls.uploadImage.push({ path, bytes, contentType });
      state.images[path] = bytes;
      return { path };
    },
    async getSignedUrl(path) {
      calls.getSignedUrl.push(path);
      return `https://fake.supabase.co/storage/v1/object/sign/item-images/${path}?token=fake`;
    },
  };

  return { db, state, calls };
}

export function makeFakeTelegram(fixture = {}) {
  const sentMessages = [];
  const sentPhotos = [];
  const answeredCallbacks = [];
  const getFileCalls = [];
  const downloadFileCalls = [];

  const telegram = {
    async sendMessage(chatId, text, replyMarkup) {
      const payload = { chat_id: chatId, text, reply_markup: replyMarkup };
      sentMessages.push(payload);
      return payload;
    },
    async sendPhoto(chatId, photo, replyMarkup) {
      const payload = { chat_id: chatId, photo, reply_markup: replyMarkup };
      sentPhotos.push(payload);
      return payload;
    },
    async answerCallbackQuery(callbackQueryId, text) {
      const payload = { callback_query_id: callbackQueryId, text };
      answeredCallbacks.push(payload);
      return payload;
    },
    async getFile(fileId) {
      getFileCalls.push(fileId);
      return { file_path: fixture.filePath || `photos/${fileId}.jpg` };
    },
    async downloadFile(filePath) {
      downloadFileCalls.push(filePath);
      return fixture.fileBytes || new Uint8Array([1, 2, 3]);
    },
  };

  return {
    telegram,
    sentMessages,
    sentPhotos,
    answeredCallbacks,
    getFileCalls,
    downloadFileCalls,
  };
}
