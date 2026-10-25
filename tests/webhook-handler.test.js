import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate } from "../supabase/functions/_shared/webhook-handler.js";
import { makeFakeDb, makeFakeTelegram } from "./fakes.js";

// Criterion 1: forwarding a link creates a pending item — replies with one button per existing
// objective + "+ nuevo objetivo".
test("criterion 1: a URL message prompts one button per objective + nuevo objetivo", async () => {
  const { db } = makeFakeDb({
    objectives: [
      { id: 1, chat_id: 42, name: "Aprender Rust" },
      { id: 2, chat_id: 42, name: "Buscar trabajo" },
    ],
  });
  const { telegram, sentMessages } = makeFakeTelegram();

  const update = {
    message: {
      chat: { id: 42 },
      from: { id: 999 },
      text: "mira esto https://example.com/article",
    },
  };

  await handleUpdate(update, { db, telegram });

  assert.equal(sentMessages.length, 1);
  const buttons = sentMessages[0].reply_markup.inline_keyboard;
  assert.equal(buttons.length, 3); // 2 objectives + "+ nuevo objetivo"
  assert.equal(buttons[0][0].text, "Aprender Rust");
  assert.equal(buttons[1][0].text, "Buscar trabajo");
  assert.equal(buttons[2][0].text, "+ nuevo objetivo");
});

// Criterion 2: selecting an existing objective saves the item (exact row).
test("criterion 2: tapping an existing objective inserts the pending item row", async () => {
  const { db, calls } = makeFakeDb({
    objectives: [{ id: 1, chat_id: 42, name: "Aprender Rust" }],
    captures: [{ id: 500, chat_id: 42, link: "https://example.com/article" }],
  });
  const { telegram } = makeFakeTelegram();

  const update = {
    callback_query: {
      id: "cbq1",
      from: { id: 999 },
      message: { chat: { id: 42 } },
      data: "obj:500:1",
    },
  };

  await handleUpdate(update, { db, telegram });

  assert.equal(calls.insertItem.length, 1);
  assert.deepEqual(calls.insertItem[0], {
    id: calls.insertItem[0].id,
    objective_id: "1",
    chat_id: 42,
    link: "https://example.com/article",
    status: "pending",
    created_at: calls.insertItem[0].created_at,
  });
  // The capture staged for selection is consumed.
  assert.equal(String(calls.deleteCapture[0]), "500");
});

// Criterion 3: "+ nuevo objetivo" then a name creates the objective and attaches the item.
test("criterion 3: new-objective two-message exchange creates objective + attaches item", async () => {
  const { db, calls } = makeFakeDb({
    captures: [{ id: 501, chat_id: 42, link: "https://example.com/other" }],
  });
  const { telegram, sentMessages } = makeFakeTelegram();

  // Message 1 (as a callback): tap "+ nuevo objetivo".
  await handleUpdate(
    {
      callback_query: {
        id: "cbq2",
        from: { id: 999 },
        message: { chat: { id: 42 } },
        data: "newobj:501",
      },
    },
    { db, telegram }
  );

  assert.equal(calls.setPendingAction.length, 1);
  assert.match(sentMessages[sentMessages.length - 1].text, /c[oó]mo se llama/i);

  // Message 2: the chat's next message names the objective.
  const result = await handleUpdate(
    {
      message: { chat: { id: 42 }, from: { id: 999 }, text: "Leer sobre producto" },
    },
    { db, telegram }
  );

  assert.equal(result.action, "objective_created_and_item_attached");
  assert.equal(calls.insertObjective.length, 1);
  assert.equal(calls.insertObjective[0].name, "Leer sobre producto");

  assert.equal(calls.insertItem.length, 1);
  assert.equal(calls.insertItem[0].objective_id, calls.insertObjective[0].id);
  assert.equal(calls.insertItem[0].link, "https://example.com/other");
  assert.equal(calls.insertItem[0].status, "pending");
});

// Criterion 5: each triage button updates the item's status; "Pendiente" is a no-op status-wise.
test("criterion 5: Borrar sets status=deleted", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 7, objective_id: 1, chat_id: 42, link: "x", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c1", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:7:borrar" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "7", status: "deleted" });
});

test("criterion 5: Guardar como recurso sets status=resource", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 8, objective_id: 1, chat_id: 42, link: "x", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c2", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:8:recurso" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "8", status: "resource" });
});

test("criterion 5: Pendiente leaves status=pending and does not block further capture", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 9, objective_id: 1, chat_id: 42, link: "x", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c3", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:9:pendiente" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "9", status: "pending" });

  // A further capture on the same chat is never blocked by any WIP cap.
  const { db: db2 } = makeFakeDb({ objectives: [{ id: 1, chat_id: 42, name: "Obj" }] });
  const { telegram: telegram2, sentMessages } = makeFakeTelegram();
  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/another" } },
    { db: db2, telegram: telegram2 }
  );
  assert.equal(result.action, "prompted_objective_selection");
  assert.equal(sentMessages.length, 1);
});

// Stopping condition: the sender's numeric Telegram ID is logged, never filtered/blocked.
test("logs the sender id via onSenderId without blocking the flow", async () => {
  const { db } = makeFakeDb({ objectives: [{ id: 1, chat_id: 42, name: "Obj" }] });
  const { telegram, sentMessages } = makeFakeTelegram();
  const seen = [];

  await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 123456789 }, text: "https://example.com/z" } },
    { db, telegram, onSenderId: (id) => seen.push(id) }
  );

  assert.deepEqual(seen, [123456789]);
  assert.equal(sentMessages.length, 1); // not blocked
});
