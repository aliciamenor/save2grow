import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyPush } from "../supabase/functions/_shared/push-handler.js";
import { makeFakeDb, makeFakeTelegram } from "./fakes.js";

// Criterion 4: daily push selects pending items oldest-first within each objective, capped at 3,
// and the send payload carries the 3 triage buttons.
test("criterion 4: only the oldest 3 pending items per objective are selected, with 3 triage buttons", async () => {
  const items = [
    { id: 1, objective_id: 1, chat_id: 42, link: "a", status: "pending", created_at: "2026-01-01T00:00:00Z" },
    { id: 2, objective_id: 1, chat_id: 42, link: "b", status: "pending", created_at: "2026-01-02T00:00:00Z" },
    { id: 3, objective_id: 1, chat_id: 42, link: "c", status: "pending", created_at: "2026-01-03T00:00:00Z" },
    { id: 4, objective_id: 1, chat_id: 42, link: "d", status: "pending", created_at: "2026-01-04T00:00:00Z" },
    { id: 5, objective_id: 1, chat_id: 42, link: "e", status: "pending", created_at: "2026-01-05T00:00:00Z" },
    // A deleted item must never be re-sent, even though it is the oldest.
    { id: 0, objective_id: 1, chat_id: 42, link: "old-deleted", status: "deleted", created_at: "2025-12-01T00:00:00Z" },
  ];
  const { db } = makeFakeDb({
    objectives: [{ id: 1, chat_id: 42, name: "Aprender Rust" }],
    items,
  });

  const sends = await buildDailyPush(db);

  assert.equal(sends.length, 3);
  assert.deepEqual(sends.map((s) => s.item.link), ["a", "b", "c"]); // oldest 3, in order

  for (const send of sends) {
    const buttons = send.reply_markup.inline_keyboard[0];
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map((b) => b.text), ["Borrar", "Guardar como recurso", "Pendiente"]);
    assert.equal(buttons[0].callback_data, `triage:${send.item.id}:borrar`);
    assert.equal(buttons[1].callback_data, `triage:${send.item.id}:recurso`);
    assert.equal(buttons[2].callback_data, `triage:${send.item.id}:pendiente`);
  }
});

test("criterion 4: caps apply per objective independently", async () => {
  const { db } = makeFakeDb({
    objectives: [
      { id: 1, chat_id: 42, name: "Obj A" },
      { id: 2, chat_id: 42, name: "Obj B" },
    ],
    items: [
      { id: 1, objective_id: 1, chat_id: 42, link: "a1", status: "pending", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, objective_id: 1, chat_id: 42, link: "a2", status: "pending", created_at: "2026-01-02T00:00:00Z" },
      { id: 3, objective_id: 1, chat_id: 42, link: "a3", status: "pending", created_at: "2026-01-03T00:00:00Z" },
      { id: 4, objective_id: 1, chat_id: 42, link: "a4", status: "pending", created_at: "2026-01-04T00:00:00Z" },
      { id: 5, objective_id: 2, chat_id: 42, link: "b1", status: "pending", created_at: "2026-01-01T00:00:00Z" },
    ],
  });

  const sends = await buildDailyPush(db);
  const fromA = sends.filter((s) => s.objective.id === 1);
  const fromB = sends.filter((s) => s.objective.id === 2);

  assert.equal(fromA.length, 3);
  assert.equal(fromB.length, 1);
});

test("runDailyPush actually sends one Telegram message per selected item", async () => {
  const { db } = makeFakeDb({
    objectives: [{ id: 1, chat_id: 42, name: "Obj" }],
    items: [{ id: 1, objective_id: 1, chat_id: 42, link: "a", status: "pending", created_at: "2026-01-01T00:00:00Z" }],
  });
  const { telegram, sentMessages } = makeFakeTelegram();
  const { runDailyPush } = await import("../supabase/functions/_shared/push-handler.js");

  await runDailyPush(db, telegram);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chat_id, 42);
});
