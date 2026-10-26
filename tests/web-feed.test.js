import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchFeed,
  triageItem,
  applyTriageResult,
  filterByTab,
  countsByTab,
  relativeTime,
  buildCard,
  remainsInTab,
} from "../web/js/feed.js";
import { makeFakeSupabase } from "./web-fakes.js";

// Criterion 4: feed lists everything saved, newest first, links as clickable text, images via a
// signed URL from the private bucket, each with its current status.
test("fetchFeed: newest first, link and image items with status and signed URL", async () => {
  const { supabase } = makeFakeSupabase({
    items: [
      {
        id: 1,
        link: "https://a.example/article",
        image_path: null,
        status: "pending",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        link: null,
        image_path: "123/1700000000-abc.jpg",
        status: "resource",
        created_at: "2026-01-02T00:00:00Z",
      },
      {
        id: 3,
        link: "https://b.example/post",
        image_path: null,
        status: "deleted",
        created_at: "2026-01-03T00:00:00Z",
      },
    ],
  });

  const feed = await fetchFeed(supabase);

  assert.equal(feed.length, 3);
  // newest first: id 3, then 2, then 1
  assert.deepEqual(feed.map((vm) => vm.id), [3, 2, 1]);

  const imageVm = feed.find((vm) => vm.id === 2);
  assert.equal(imageVm.kind, "image");
  assert.equal(imageVm.status, "resource");
  assert.match(
    imageVm.content,
    /^https:\/\/fake\.supabase\.co\/storage\/v1\/object\/sign\/item-images\/123\/1700000000-abc\.jpg\?expiresIn=3600$/,
  );

  const linkVm = feed.find((vm) => vm.id === 1);
  assert.equal(linkVm.kind, "link");
  assert.equal(linkVm.content, "https://a.example/article");
  assert.equal(linkVm.status, "pending");
});

test("fetchFeed: empty feed renders an empty list, no error", async () => {
  const { supabase } = makeFakeSupabase({ items: [] });
  const feed = await fetchFeed(supabase);
  assert.deepEqual(feed, []);
});

// Criterion 5: each of the 3 triage decisions issues the right update call and flips status.
for (const [decision, expectedStatus] of [
  ["delete", "deleted"],
  ["resource", "resource"],
  ["pending", "pending"],
]) {
  test(`triageItem: "${decision}" updates items.status to "${expectedStatus}"`, async () => {
    const { supabase, calls } = makeFakeSupabase({
      items: [
        {
          id: 42,
          link: "https://x.example",
          image_path: null,
          status: "pending",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const newStatus = await triageItem(supabase, 42, decision);

    assert.equal(newStatus, expectedStatus);
    assert.equal(calls.update.length, 1);
    assert.deepEqual(calls.update[0], {
      column: "id",
      value: 42,
      patch: { status: expectedStatus },
    });
  });
}

test("triageItem: rejects an unknown decision without calling Supabase", async () => {
  const { supabase, calls } = makeFakeSupabase({ items: [] });
  await assert.rejects(() => triageItem(supabase, 1, "not-a-real-decision"));
  assert.equal(calls.update.length, 0);
});

// Criterion 5: the item's displayed status updates in memory without touching the others or
// needing a full re-render/page reload.
test("applyTriageResult: updates only the matching item's status, leaves others untouched", () => {
  const before = [
    { id: 1, kind: "link", content: "a", status: "pending" },
    { id: 2, kind: "image", content: "b", status: "pending" },
  ];
  const after = applyTriageResult(before, 2, "resource");
  assert.deepEqual(after, [
    { id: 1, kind: "link", content: "a", status: "pending" },
    { id: 2, kind: "image", content: "b", status: "resource" },
  ]);
  // original array is untouched (pure function)
  assert.equal(before[1].status, "pending");
});

// --- Spec 004 criterion 2: three tabs, filtered by status, with counts ----------------------

const MIXED_VMS = [
  { id: 1, kind: "link", content: "a", status: "pending", created_at: "2026-01-01T00:00:00Z" },
  { id: 2, kind: "link", content: "b", status: "pending", created_at: "2026-01-01T00:00:00Z" },
  { id: 3, kind: "image", content: "c", status: "resource", created_at: "2026-01-01T00:00:00Z" },
  { id: 4, kind: "link", content: "d", status: "deleted", created_at: "2026-01-01T00:00:00Z" },
];

test("filterByTab: pendientes/recursos/borrados each return only their own status", () => {
  assert.deepEqual(filterByTab(MIXED_VMS, "pendientes").map((vm) => vm.id), [1, 2]);
  assert.deepEqual(filterByTab(MIXED_VMS, "recursos").map((vm) => vm.id), [3]);
  assert.deepEqual(filterByTab(MIXED_VMS, "borrados").map((vm) => vm.id), [4]);
});

test("filterByTab: an unknown tab key throws rather than silently returning nothing", () => {
  assert.throws(() => filterByTab(MIXED_VMS, "nope"));
});

test('countsByTab: "Pendientes (3)"-style counts, read off the same view models as the lists', () => {
  assert.deepEqual(countsByTab(MIXED_VMS), { pendientes: 2, recursos: 1, borrados: 1 });
});

test("countsByTab: an empty feed counts zero in every tab", () => {
  assert.deepEqual(countsByTab([]), { pendientes: 0, recursos: 0, borrados: 0 });
});

// --- Spec 004 criterion 3: Spanish relative time, boundary cases ----------------------------

const NOW = new Date("2026-01-10T12:00:00Z");

test("relativeTime: boundary cases (minutes, hours, days, weeks, and the under-a-minute case)", () => {
  assert.equal(relativeTime(new Date(NOW.getTime() - 10 * 1000), NOW), "hoy");
  assert.equal(relativeTime(new Date(NOW.getTime() - 1 * 60000), NOW), "hace 1 minuto");
  assert.equal(relativeTime(new Date(NOW.getTime() - 5 * 60000), NOW), "hace 5 minutos");
  assert.equal(relativeTime(new Date(NOW.getTime() - 1 * 3600000), NOW), "hace 1 hora");
  assert.equal(relativeTime(new Date(NOW.getTime() - 3 * 3600000), NOW), "hace 3 horas");
  assert.equal(relativeTime(new Date(NOW.getTime() - 1 * 86400000), NOW), "hace 1 día");
  assert.equal(relativeTime(new Date(NOW.getTime() - 2 * 86400000), NOW), "hace 2 días");
  assert.equal(relativeTime(new Date(NOW.getTime() - 7 * 86400000), NOW), "hace 1 semana");
  assert.equal(relativeTime(new Date(NOW.getTime() - 14 * 86400000), NOW), "hace 2 semanas");
});

// --- Spec 004 criteria 4 (render) and 5 (shared card shape) ----------------------------------

test("buildCard: an image item renders the image visual, no heading/body/href", () => {
  const vm = { kind: "image", content: "https://signed.example/x.jpg", preview: null, created_at: NOW };
  const card = buildCard(vm, NOW);
  assert.equal(card.kind, "image");
  assert.deepEqual(card.visual, { type: "image", src: "https://signed.example/x.jpg" });
  assert.equal(card.heading, null);
  assert.equal(card.body, null);
  assert.equal(card.href, null);
});

test("buildCard: a link with full preview fields renders a preview card with its image", () => {
  const vm = {
    kind: "link",
    content: "https://example.com/article",
    preview: { title: "T", description: "D", image: "https://cdn.example/i.jpg" },
    created_at: NOW,
  };
  const card = buildCard(vm, NOW);
  assert.equal(card.kind, "link-preview");
  assert.deepEqual(card.visual, { type: "image", src: "https://cdn.example/i.jpg" });
  assert.equal(card.heading, "T");
  assert.equal(card.body, "D");
  assert.equal(card.href, "https://example.com/article");
});

test("buildCard: a link with preview text but no preview image falls back to the placeholder visual", () => {
  const vm = {
    kind: "link",
    content: "https://example.com/article",
    preview: { title: "T", description: "D", image: null },
    created_at: NOW,
  };
  const card = buildCard(vm, NOW);
  assert.equal(card.kind, "link-preview");
  assert.deepEqual(card.visual, { type: "placeholder" });
});

test("buildCard: a link with no preview (null) renders the plain-link fallback card", () => {
  const vm = { kind: "link", content: "https://example.com/plain", preview: null, created_at: NOW };
  const card = buildCard(vm, NOW);
  assert.equal(card.kind, "link-plain");
  assert.deepEqual(card.visual, { type: "placeholder" });
  assert.equal(card.heading, null);
  assert.equal(card.body, "https://example.com/plain");
  assert.equal(card.href, "https://example.com/plain");
});

test("fetchFeed: a link row with preview columns set builds a preview view model", async () => {
  const { supabase } = makeFakeSupabase({
    items: [
      {
        id: 5,
        link: "https://example.com/with-preview",
        image_path: null,
        status: "pending",
        created_at: "2026-01-05T00:00:00Z",
        preview_title: "A title",
        preview_description: "A description",
        preview_image_url: "https://cdn.example/p.jpg",
      },
    ],
  });
  const feed = await fetchFeed(supabase);
  assert.deepEqual(feed[0].preview, {
    title: "A title",
    description: "A description",
    image: "https://cdn.example/p.jpg",
  });
});

test("fetchFeed: a link row with no preview columns builds a null preview (plain-link fallback)", async () => {
  const { supabase } = makeFakeSupabase({
    items: [
      {
        id: 6,
        link: "https://example.com/no-preview",
        image_path: null,
        status: "pending",
        created_at: "2026-01-06T00:00:00Z",
      },
    ],
  });
  const feed = await fetchFeed(supabase);
  assert.equal(feed[0].preview, null);
});

// --- Spec 004 criterion 1: triage moves an item between tabs, never deletes it from view -----
//
// This is the pure logic app.js's icon-click handler calls to decide whether to remove the
// item's DOM node from the current tab's list (the DOM removal itself is one line in app.js:
// `if (!stillVisible) li.remove()`, deliberately left untested, same convention as the rest of
// app.js's DOM wiring — see decisions.md). Exercising every one of the 3 icons from every one of
// the 3 tabs here covers exactly what the DOM would show: the item leaves its current tab's
// list whenever the new status doesn't belong to that tab, including the Borrados→Pendiente
// restore case.
const ALL_TRIAGE_FROM_EVERY_TAB = [
  // [currentTab, decision, resultingStatus, expectedStillVisibleInCurrentTab]
  ["pendientes", "pending", "pending", true], // no-op triage stays put
  ["pendientes", "resource", "resource", false], // leaves Pendientes
  ["pendientes", "delete", "deleted", false], // leaves Pendientes, to Borrados
  ["recursos", "resource", "resource", true],
  ["recursos", "pending", "pending", false],
  ["recursos", "delete", "deleted", false],
  ["borrados", "delete", "deleted", true],
  ["borrados", "pending", "pending", false], // the restore case
  ["borrados", "resource", "resource", false],
];

for (const [tab, decision, expectedStatus, expectedStillVisible] of ALL_TRIAGE_FROM_EVERY_TAB) {
  test(`triage from ${tab} via "${decision}" → status=${expectedStatus}, stillVisible=${expectedStillVisible}`, () => {
    const before = [{ id: 1, kind: "link", content: "x", status: filterByTab(MIXED_VMS, tab)[0]?.status ?? "pending" }];
    const DECISION_TO_STATUS = { delete: "deleted", resource: "resource", pending: "pending" };
    const newStatus = DECISION_TO_STATUS[decision];
    const after = applyTriageResult(before, 1, newStatus);
    assert.equal(after[0].status, expectedStatus);
    assert.equal(remainsInTab(newStatus, tab), expectedStillVisible);
    // the item is never removed from the in-memory model — only from the current tab's visible
    // list (criterion 1: "it never deletes anything from view" of another tab).
    assert.equal(after.length, before.length);
  });
}
