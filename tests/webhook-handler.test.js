import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate } from "../supabase/functions/_shared/webhook-handler.js";
import { makeFakeDb, makeFakeTelegram } from "./fakes.js";

// Criterion 1: forwarding a link saves it immediately, no buttons, no objective prompt.
test("criterion 1: a URL message is saved directly with a plain confirmation", async () => {
  const { db, calls } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();

  const update = {
    message: {
      chat: { id: 42 },
      from: { id: 999 },
      text: "mira esto https://example.com/article",
    },
  };

  const result = await handleUpdate(update, { db, telegram });

  assert.equal(result.action, "item_saved");
  assert.equal(calls.insertItem.length, 1);
  assert.deepEqual(calls.insertItem[0], {
    id: calls.insertItem[0].id,
    chat_id: 42,
    link: "mira esto https://example.com/article",
    image_path: null,
    status: "pending",
    created_at: calls.insertItem[0].created_at,
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].text, "Guardado.");
  assert.equal(sentMessages[0].reply_markup, undefined); // no inline_keyboard
});

// Criterion 2: forwarding a photo saves it too — downloads the largest size, uploads it to
// Supabase Storage, and inserts an item referencing the stored path.
test("criterion 2: a photo message downloads the largest size and saves it", async () => {
  const { db, calls } = makeFakeDb();
  const { telegram, sentMessages, getFileCalls, downloadFileCalls } = makeFakeTelegram({
    filePath: "photos/file_123.jpg",
    fileBytes: new Uint8Array([9, 9, 9]),
  });

  const update = {
    message: {
      chat: { id: 42 },
      from: { id: 999 },
      photo: [
        { file_id: "small_id", width: 90, height: 90 },
        { file_id: "large_id", width: 1280, height: 1280 },
      ],
    },
  };

  const result = await handleUpdate(update, { db, telegram });

  assert.equal(result.action, "item_saved");
  assert.deepEqual(getFileCalls, ["large_id"]); // the largest size, i.e. the last element
  assert.deepEqual(downloadFileCalls, ["photos/file_123.jpg"]);

  assert.equal(calls.uploadImage.length, 1);
  assert.deepEqual(calls.uploadImage[0].bytes, new Uint8Array([9, 9, 9]));

  assert.equal(calls.insertItem.length, 1);
  assert.equal(calls.insertItem[0].link, null);
  assert.equal(calls.insertItem[0].image_path, calls.uploadImage[0].path);
  assert.equal(calls.insertItem[0].status, "pending");

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].text, "Guardado.");
  assert.equal(sentMessages[0].reply_markup, undefined);
});

// Criterion 4 (unchanged from spec 001): each triage button updates the item's status; "Pendiente"
// is a no-op status-wise. These assertions are kept as spec 001 wrote them.
test("criterion 4: Borrar sets status=deleted", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 7, chat_id: 42, link: "x", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c1", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:7:borrar" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "7", status: "deleted" });
});

test("criterion 4: Guardar como recurso sets status=resource", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 8, chat_id: 42, link: "x", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c2", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:8:recurso" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "8", status: "resource" });
});

test("criterion 4: Pendiente leaves status=pending and does not block further capture", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 9, chat_id: 42, link: "x", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c3", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:9:pendiente" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "9", status: "pending" });

  // A further capture on the same chat is never blocked by any WIP cap.
  const { db: db2 } = makeFakeDb();
  const { telegram: telegram2, sentMessages } = makeFakeTelegram();
  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/another" } },
    { db: db2, telegram: telegram2 }
  );
  assert.equal(result.action, "item_saved");
  assert.equal(sentMessages.length, 1);
});

// Criterion 4, new case for spec 002: triage works the same on an image item.
test("criterion 4: triage works the same on an image item", async () => {
  const { db, calls } = makeFakeDb({
    items: [
      { id: 10, chat_id: 42, link: null, image_path: "42/123-abc.jpg", status: "pending", created_at: "2026-01-01" },
    ],
  });
  const { telegram } = makeFakeTelegram();

  await handleUpdate(
    { callback_query: { id: "c4", from: { id: 999 }, message: { chat: { id: 42 } }, data: "triage:10:recurso" } },
    { db, telegram }
  );

  assert.deepEqual(calls.updateItemStatus[0], { itemId: "10", status: "resource" });
});

// Stopping condition carried over from spec 001: the sender's numeric Telegram ID is logged,
// never filtered/blocked, by this shared handler (the actual owner whitelist lives in
// telegram-webhook/index.ts).
test("logs the sender id via onSenderId without blocking the flow", async () => {
  const { db } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();
  const seen = [];

  await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 123456789 }, text: "https://example.com/z" } },
    { db, telegram, onSenderId: (id) => seen.push(id) }
  );

  assert.deepEqual(seen, [123456789]);
  assert.equal(sentMessages.length, 1); // not blocked
});

// Spec 004 criterion 4: the OG preview is fetched once, right after "Guardado.", and written to
// the new preview fields — only for a link item, and only when `fetchOgPreview` is supplied.
test("spec004 criterion 4: a saved link fetches and stores its OG preview", async () => {
  const { db, calls } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();
  const seenUrls = [];
  const fetchOgPreview = async (url) => {
    seenUrls.push(url);
    return { title: "A title", description: "A description", image: "https://cdn.example/a.jpg" };
  };

  const update = {
    message: { chat: { id: 42 }, from: { id: 999 }, text: "mira esto https://example.com/article" },
  };

  const result = await handleUpdate(update, { db, telegram, fetchOgPreview });

  assert.equal(result.action, "item_saved");
  assert.deepEqual(seenUrls, ["https://example.com/article"]); // just the URL, not surrounding text
  assert.equal(sentMessages[0].text, "Guardado."); // reply still happens, unaffected
  assert.equal(calls.updateItemPreview.length, 1);
  assert.deepEqual(calls.updateItemPreview[0].preview, {
    title: "A title",
    description: "A description",
    image: "https://cdn.example/a.jpg",
  });
});

test("spec004 criterion 4: no OG tags (fetchOgPreview resolves null) — no preview write, capture unaffected", async () => {
  const { db, calls } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();
  const fetchOgPreview = async () => null;

  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/plain" } },
    { db, telegram, fetchOgPreview },
  );

  assert.equal(result.action, "item_saved");
  assert.equal(sentMessages[0].text, "Guardado.");
  assert.equal(calls.updateItemPreview.length, 0);
});

test("spec004 criterion 4: a throwing fetchOgPreview never breaks capture", async () => {
  const { db, calls } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();
  const fetchOgPreview = async () => {
    throw new Error("boom");
  };

  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/boom" } },
    { db, telegram, fetchOgPreview },
  );

  assert.equal(result.action, "item_saved");
  assert.equal(sentMessages[0].text, "Guardado.");
  assert.equal(calls.updateItemPreview.length, 0);
});

test("spec004 criterion 4: a photo message never calls fetchOgPreview", async () => {
  const { db } = makeFakeDb();
  const { telegram } = makeFakeTelegram({ fileBytes: new Uint8Array([1]) });
  let called = false;
  const fetchOgPreview = async () => {
    called = true;
    return null;
  };

  await handleUpdate(
    {
      message: {
        chat: { id: 42 },
        from: { id: 999 },
        photo: [{ file_id: "a", width: 10, height: 10 }],
      },
    },
    { db, telegram, fetchOgPreview },
  );

  assert.equal(called, false);
});

test("spec004 criterion 4: omitting fetchOgPreview entirely still saves the link (back-compat)", async () => {
  const { db, calls } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();

  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/no-fetcher" } },
    { db, telegram },
  );

  assert.equal(result.action, "item_saved");
  assert.equal(sentMessages[0].text, "Guardado.");
  assert.equal(calls.updateItemPreview.length, 0);
});

// Spec 005 criteria 1, 2: forwarding a link that exactly matches an existing item's `link`
// (any status) skips the insert and replies naming where it already sits.
test("spec005 criterion 1: an exact duplicate link does not insert a new row", async () => {
  const { db, calls } = makeFakeDb({
    items: [
      { id: 50, chat_id: 42, link: "https://example.com/already-saved", status: "pending", created_at: "2026-01-01" },
    ],
  });
  const { telegram, sentMessages } = makeFakeTelegram();

  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/already-saved" } },
    { db, telegram }
  );

  assert.equal(result.action, "duplicate");
  assert.equal(calls.insertItem.length, 0); // no new row
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].text, "Ya lo tienes guardado — está en Pendientes.");
});

test("spec005 criterion 2: the duplicate reply names the item's actual current status/tab", async () => {
  const cases = [
    { status: "pending", label: "Pendientes" },
    { status: "resource", label: "Recursos" },
    { status: "deleted", label: "Borrados" },
  ];

  for (const { status, label } of cases) {
    const { db, calls } = makeFakeDb({
      items: [{ id: 51, chat_id: 42, link: "https://example.com/dup", status, created_at: "2026-01-01" }],
    });
    const { telegram, sentMessages } = makeFakeTelegram();

    const result = await handleUpdate(
      { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/dup" } },
      { db, telegram }
    );

    assert.equal(result.action, "duplicate");
    assert.equal(calls.insertItem.length, 0);
    assert.equal(sentMessages[0].text, `Ya lo tienes guardado — está en ${label}.`);
  }
});

test("spec005: a non-matching link still saves normally (no false-positive duplicate)", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 52, chat_id: 42, link: "https://example.com/other", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram, sentMessages } = makeFakeTelegram();

  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/not-the-same" } },
    { db, telegram }
  );

  assert.equal(result.action, "item_saved");
  assert.equal(calls.insertItem.length, 1);
  assert.equal(sentMessages[0].text, "Guardado.");
});

test("spec005: a duplicate link never triggers an OG preview fetch", async () => {
  const { db, calls } = makeFakeDb({
    items: [{ id: 53, chat_id: 42, link: "https://example.com/dup2", status: "pending", created_at: "2026-01-01" }],
  });
  const { telegram, sentMessages } = makeFakeTelegram();
  let called = false;
  const fetchOgPreview = async () => {
    called = true;
    return null;
  };

  const result = await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/dup2" } },
    { db, telegram, fetchOgPreview }
  );

  assert.equal(result.action, "duplicate");
  assert.equal(called, false);
  assert.equal(calls.updateItemPreview.length, 0);
  assert.equal(sentMessages[0].text, "Ya lo tienes guardado — está en Pendientes.");
});

// Criterion 6: the objective-selection code path is gone from the live capture flow — no
// `newobj:`/`obj:` callback handling and no `awaiting_objective_name` left wired.
test("criterion 6: no objective-selection buttons are ever sent for a link or a photo", async () => {
  const { db } = makeFakeDb();
  const { telegram, sentMessages } = makeFakeTelegram();

  await handleUpdate(
    { message: { chat: { id: 42 }, from: { id: 999 }, text: "https://example.com/once-more" } },
    { db, telegram }
  );

  for (const sent of sentMessages) {
    assert.equal(sent.reply_markup, undefined);
  }

  // The old objective-selection callback data is not handled any more.
  const result = await handleUpdate(
    { callback_query: { id: "c5", from: { id: 999 }, message: { chat: { id: 42 } }, data: "obj:500:1" } },
    { db, telegram }
  );
  assert.equal(result.action, "unhandled");

  const result2 = await handleUpdate(
    { callback_query: { id: "c6", from: { id: 999 }, message: { chat: { id: 42 } }, data: "newobj:500" } },
    { db, telegram }
  );
  assert.equal(result2.action, "unhandled");
});
