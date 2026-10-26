import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchFeed, triageItem, applyTriageResult } from "../web/js/feed.js";
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
