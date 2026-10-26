import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOgTags, fetchOgPreview } from "../supabase/functions/_shared/og-preview.js";

// Criterion 4 (fetch/parse eval) — mock HTML responses: full tags, partial tags, no tags, and a
// timeout/network error, asserting the parsed result or `null` per case, and that a failure
// never throws past the caller.

test("parseOgTags: full og:title/description/image", () => {
  const html = `
    <html><head>
      <meta property="og:title" content="A great article">
      <meta property="og:description" content="What it is about">
      <meta property="og:image" content="https://cdn.example/img.jpg">
    </head></html>
  `;
  assert.deepEqual(parseOgTags(html), {
    title: "A great article",
    description: "What it is about",
    image: "https://cdn.example/img.jpg",
  });
});

test("parseOgTags: accepts content-before-property attribute order", () => {
  const html = `<meta content="Reordered title" property="og:title">`;
  assert.deepEqual(parseOgTags(html), {
    title: "Reordered title",
    description: null,
    image: null,
  });
});

test("parseOgTags: partial tags (title only) — the rest are null", () => {
  const html = `<meta property="og:title" content="Only a title">`;
  assert.deepEqual(parseOgTags(html), {
    title: "Only a title",
    description: null,
    image: null,
  });
});

test("parseOgTags: no OG tags at all — everything null", () => {
  const html = `<html><head><title>No OG here</title></head></html>`;
  assert.deepEqual(parseOgTags(html), { title: null, description: null, image: null });
});

test("parseOgTags: decodes common HTML entities in content", () => {
  const html = `<meta property="og:title" content="Tom &amp; Jerry &quot;classic&quot;">`;
  assert.equal(parseOgTags(html).title, `Tom & Jerry "classic"`);
});

test("parseOgTags: empty/non-string input never throws", () => {
  assert.deepEqual(parseOgTags(""), { title: null, description: null, image: null });
  assert.deepEqual(parseOgTags(undefined), { title: null, description: null, image: null });
});

function fakeFetchOk(html) {
  return async () => ({ ok: true, text: async () => html });
}

test("fetchOgPreview: a page with full OG tags resolves the parsed preview", async () => {
  const html = `
    <meta property="og:title" content="Fetched title">
    <meta property="og:description" content="Fetched description">
    <meta property="og:image" content="https://cdn.example/a.jpg">
  `;
  const result = await fetchOgPreview("https://example.com/article", {
    fetchImpl: fakeFetchOk(html),
  });
  assert.deepEqual(result, {
    title: "Fetched title",
    description: "Fetched description",
    image: "https://cdn.example/a.jpg",
  });
});

test("fetchOgPreview: a page with no OG tags resolves null (plain-link fallback)", async () => {
  const result = await fetchOgPreview("https://example.com/plain", {
    fetchImpl: fakeFetchOk("<html><body>nothing here</body></html>"),
  });
  assert.equal(result, null);
});

test("fetchOgPreview: a non-2xx response resolves null, never throws", async () => {
  const result = await fetchOgPreview("https://example.com/missing", {
    fetchImpl: async () => ({ ok: false, text: async () => "" }),
  });
  assert.equal(result, null);
});

test("fetchOgPreview: a network error resolves null, never throws", async () => {
  const result = await fetchOgPreview("https://example.com/down", {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(result, null);
});

test("fetchOgPreview: a slow page that outlives the timeout resolves null, never throws or hangs", async () => {
  const result = await fetchOgPreview("https://example.com/slow", {
    timeoutMs: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => resolve({ ok: true, text: async () => "<meta property=\"og:title\" content=\"too late\">" }),
          500,
        );
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      }),
  });
  assert.equal(result, null);
});
