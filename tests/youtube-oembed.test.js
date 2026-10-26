import { test } from "node:test";
import assert from "node:assert/strict";
import { isYouTubeUrl, fetchYouTubeOembed } from "../supabase/functions/_shared/youtube-oembed.js";

// Criterion 1 (delegated decision) — cover the common real-world forms without over-matching
// an unrelated URL that merely contains "youtube" as a substring.

test("isYouTubeUrl: recognizes youtube.com/watch?v=", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), true);
  assert.equal(isYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ"), true);
});

test("isYouTubeUrl: recognizes youtu.be/ short links", () => {
  assert.equal(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ"), true);
});

test("isYouTubeUrl: recognizes m.youtube.com/watch?v=", () => {
  assert.equal(isYouTubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), true);
});

test("isYouTubeUrl: recognizes youtube.com/watch with a leading query param before v=", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ"), true);
});

test("isYouTubeUrl: does not over-match a URL that merely contains \"youtube\" as a substring", () => {
  assert.equal(isYouTubeUrl("https://example.com/youtube.com/watch?v=x"), false);
  assert.equal(isYouTubeUrl("https://notyoutube.com/watch?v=x"), false);
  assert.equal(isYouTubeUrl("https://example.com/is-this-youtube-cool"), false);
});

test("isYouTubeUrl: a non-YouTube link is untouched", () => {
  assert.equal(isYouTubeUrl("https://example.com/article"), false);
});

test("isYouTubeUrl: non-string input never throws", () => {
  assert.equal(isYouTubeUrl(undefined), false);
  assert.equal(isYouTubeUrl(null), false);
});

function fakeFetchOk(body) {
  return async () => ({ ok: true, json: async () => body });
}

test("fetchYouTubeOembed: maps title/thumbnail_url to {title, description:null, image}", async () => {
  const result = await fetchYouTubeOembed("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
    fetchImpl: fakeFetchOk({
      title: "Never Gonna Give You Up",
      author_name: "Rick Astley",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }),
  });
  assert.deepEqual(result, {
    title: "Never Gonna Give You Up",
    description: null,
    image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  });
});

test("fetchYouTubeOembed: also maps a youtu.be/ short link", async () => {
  const result = await fetchYouTubeOembed("https://youtu.be/dQw4w9WgXcQ", {
    fetchImpl: fakeFetchOk({ title: "A short link video", thumbnail_url: "https://i.ytimg.com/x.jpg" }),
  });
  assert.deepEqual(result, {
    title: "A short link video",
    description: null,
    image: "https://i.ytimg.com/x.jpg",
  });
});

test("fetchYouTubeOembed: requests the oEmbed endpoint with the URL encoded", async () => {
  const seenUrls = [];
  await fetchYouTubeOembed("https://www.youtube.com/watch?v=abc", {
    fetchImpl: async (url) => {
      seenUrls.push(url);
      return { ok: true, json: async () => ({ title: "t", thumbnail_url: null }) };
    },
  });
  assert.deepEqual(seenUrls, [
    "https://www.youtube.com/oembed?url=" +
      encodeURIComponent("https://www.youtube.com/watch?v=abc") +
      "&format=json",
  ]);
});

// Criterion 2 — a failed/non-2xx/timeout oEmbed call falls back to the plain-link card (null),
// same contract as fetchOgPreview.

test("fetchYouTubeOembed: a non-2xx response resolves null, never throws", async () => {
  const result = await fetchYouTubeOembed("https://www.youtube.com/watch?v=dead", {
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  assert.equal(result, null);
});

test("fetchYouTubeOembed: a network error resolves null, never throws", async () => {
  const result = await fetchYouTubeOembed("https://www.youtube.com/watch?v=down", {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(result, null);
});

test("fetchYouTubeOembed: a slow response that outlives the timeout resolves null, never hangs", async () => {
  const result = await fetchYouTubeOembed("https://www.youtube.com/watch?v=slow", {
    timeoutMs: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true, json: async () => ({ title: "too late" }) }), 500);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      }),
  });
  assert.equal(result, null);
});

test("fetchYouTubeOembed: a response with no title resolves null", async () => {
  const result = await fetchYouTubeOembed("https://www.youtube.com/watch?v=notitle", {
    fetchImpl: fakeFetchOk({ thumbnail_url: "https://i.ytimg.com/x.jpg" }),
  });
  assert.equal(result, null);
});
