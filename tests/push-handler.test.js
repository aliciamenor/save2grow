import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyPush, runDailyPush } from "../supabase/functions/_shared/push-handler.js";
import { makeFakeDb, makeFakeTelegram } from "./fakes.js";

// Criterion 3: daily push selects the oldest 3 pending items overall (no longer grouped by
// objective), one message per item, with the 3 triage buttons.
test("criterion 3: only the oldest 3 pending items overall are selected, with 3 triage buttons", async () => {
  const items = [
    { id: 1, chat_id: 42, link: "a", status: "pending", created_at: "2026-01-01T00:00:00Z" },
    { id: 2, chat_id: 42, link: "b", status: "pending", created_at: "2026-01-02T00:00:00Z" },
    { id: 3, chat_id: 42, link: "c", status: "pending", created_at: "2026-01-03T00:00:00Z" },
    { id: 4, chat_id: 42, link: "d", status: "pending", created_at: "2026-01-04T00:00:00Z" },
    { id: 5, chat_id: 42, link: "e", status: "pending", created_at: "2026-01-05T00:00:00Z" },
    // A deleted item must never be re-sent, even though it is the oldest.
    { id: 0, chat_id: 42, link: "old-deleted", status: "deleted", created_at: "2025-12-01T00:00:00Z" },
  ];
  const { db } = makeFakeDb({ items });

  const sends = await buildDailyPush(db);

  assert.equal(sends.length, 3);
  assert.deepEqual(sends.map((s) => s.item.link), ["a", "b", "c"]); // oldest 3, in order

  for (const send of sends) {
    assert.equal(send.kind, "text");
    const buttons = send.reply_markup.inline_keyboard[0];
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map((b) => b.text), ["Borrar", "Guardar como recurso", "Pendiente"]);
    assert.equal(buttons[0].callback_data, `triage:${send.item.id}:borrar`);
    assert.equal(buttons[1].callback_data, `triage:${send.item.id}:recurso`);
    assert.equal(buttons[2].callback_data, `triage:${send.item.id}:pendiente`);
  }
});

test("criterion 3: the cap of 3 is overall, across chats/items, not per objective", async () => {
  const { db } = makeFakeDb({
    items: [
      { id: 1, chat_id: 42, link: "a1", status: "pending", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, chat_id: 42, link: "a2", status: "pending", created_at: "2026-01-02T00:00:00Z" },
      { id: 3, chat_id: 42, link: "a3", status: "pending", created_at: "2026-01-03T00:00:00Z" },
      { id: 4, chat_id: 42, link: "a4", status: "pending", created_at: "2026-01-04T00:00:00Z" },
      { id: 5, chat_id: 42, link: "b1", status: "pending", created_at: "2026-01-05T00:00:00Z" },
    ],
  });

  const sends = await buildDailyPush(db);

  assert.equal(sends.length, 3);
  assert.deepEqual(sends.map((s) => s.item.link), ["a1", "a2", "a3"]);
});

// Criterion 4 (image items): the push sends a photo, not a text link, for an image item — same
// triage buttons as any other item.
test("criterion 3/4: an image item is pushed as a photo via a signed URL, with triage buttons", async () => {
  const { db, calls } = makeFakeDb({
    items: [
      { id: 11, chat_id: 42, link: null, image_path: "42/123-abc.jpg", status: "pending", created_at: "2026-01-01T00:00:00Z" },
    ],
  });

  const sends = await buildDailyPush(db);

  assert.equal(sends.length, 1);
  assert.equal(sends[0].kind, "photo");
  assert.match(sends[0].photo, /42\/123-abc\.jpg/);
  assert.deepEqual(calls.getSignedUrl, ["42/123-abc.jpg"]);
  assert.equal(sends[0].reply_markup.inline_keyboard[0].length, 3);
});

test("runDailyPush sends a text message for a link item and a photo for an image item", async () => {
  const { db } = makeFakeDb({
    items: [
      { id: 1, chat_id: 42, link: "a", status: "pending", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, chat_id: 42, link: null, image_path: "42/x.jpg", status: "pending", created_at: "2026-01-02T00:00:00Z" },
    ],
  });
  const { telegram, sentMessages, sentPhotos } = makeFakeTelegram();

  await runDailyPush(db, telegram);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chat_id, 42);
  assert.equal(sentPhotos.length, 1);
  assert.equal(sentPhotos[0].chat_id, 42);
});
