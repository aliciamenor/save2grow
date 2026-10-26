// Open Graph link preview — fetch + parse, spec 004 criterion 4.
//
// Pure-ish, same shape as the rest of _shared/: takes `fetchImpl` as a collaborator instead of
// importing a global, so it is unit tested with mock HTML responses and no real network
// (tests/og-preview.test.js). Runs identically under Deno (Edge Functions) and Node (tests),
// since it only uses the standard fetch API shape.
//
// Delegated decision (specs/done/004-feed-ux-and-gaping-styling.md): plain regex over `<meta>`
// tags, no HTML parsing library — keeps this at zero npm/Deno-module dependencies, matching the
// rest of the repo (decisions.md, 2026-10-25). `<meta property="og:x" content="...">` is a fixed,
// simple attribute shape; a regex that accepts either attribute order is reliable enough for it
// without a general HTML parser, which this repo has avoided everywhere else for the same reason.
//
// Timeout (delegated decision): 4000ms — a few seconds at most, so capture still feels instant,
// long enough that a normal, non-pathological page doesn't trip it.
export const OG_FETCH_TIMEOUT_MS = 4000;

function matchMetaContent(html, property) {
  // Accepts either attribute order: property before content, or content before property.
  const patterns = [
    new RegExp(
      `<meta[^>]*?\\bproperty=["']${property}["'][^>]*?\\bcontent=["']([^"']*)["'][^>]*?>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*?\\bcontent=["']([^"']*)["'][^>]*?\\bproperty=["']${property}["'][^>]*?>`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
  }
  return null;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Parses raw HTML into `{title, description, image}`, each `null` when the tag is absent.
// Never throws — a malformed fragment just yields nulls, same as a page with no OG tags at all.
export function parseOgTags(html) {
  if (typeof html !== "string" || html.length === 0) {
    return { title: null, description: null, image: null };
  }
  return {
    title: matchMetaContent(html, "og:title"),
    description: matchMetaContent(html, "og:description"),
    image: matchMetaContent(html, "og:image"),
  };
}

// Fetches a URL and parses its OG tags. Returns `null` (never throws) when:
// - the fetch fails, times out, or responds with a non-2xx status
// - the page has none of the three OG tags
// so callers can fall back to a plain link unconditionally, with no try/catch of their own.
export async function fetchOgPreview(url, { fetchImpl = fetch, timeoutMs = OG_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res || !res.ok) return null;
    const html = await res.text();
    const preview = parseOgTags(html);
    if (!preview.title && !preview.description && !preview.image) return null;
    return preview;
  } catch {
    // Stopping condition honored: a timeout, a network error, or a site that blocks this
    // fetcher (bot-blocking) all fall into the same "no preview" outcome as "no OG tags" — never
    // worked around with spoofed headers or other evasion.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
