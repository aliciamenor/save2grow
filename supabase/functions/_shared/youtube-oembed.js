// YouTube oEmbed link preview — spec 006.
//
// YouTube blocks the generic OG scraper (og-preview.js) for non-browser requests (spec 004's
// documented, accepted fallback case) — confirmed live. This uses YouTube's own public,
// documented oEmbed endpoint instead: `https://www.youtube.com/oembed?url=<encoded
// url>&format=json`, no API key, no spoofed headers (closed decision, Gate 1, 2026-10-27 — see
// decisions.md).
//
// Same collaborator-injection shape as og-preview.js: `fetchImpl` defaults to the global
// `fetch`, swapped for a mock in tests (tests/youtube-oembed.test.js). Never throws — same
// "falls back silently to the plain-link card" contract as fetchOgPreview.

export const YOUTUBE_OEMBED_TIMEOUT_MS = 4000;

// Delegated decision (specs/006-youtube-oembed-preview.md): covers the common real-world forms
// (youtube.com/watch?v=, youtu.be/, m.youtube.com/watch?v=) without over-matching an unrelated
// URL that merely contains "youtube" as a substring — the hostname must appear right after the
// protocol (with an optional "www." or "m." prefix), never inside a path or query string.
const YOUTUBE_URL_RE =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?(?:[^#]*&)?v=[^&\s]+|youtu\.be\/[^?\s]+)/i;

export function isYouTubeUrl(url) {
  return typeof url === "string" && YOUTUBE_URL_RE.test(url);
}

// Fetches YouTube's oEmbed endpoint for `url` and maps the response to the same
// `{title, description, image}` shape `fetchOgPreview` resolves. `description` is always `null`
// — oEmbed doesn't provide one, and it is never fabricated (criterion 1). Returns `null` — never
// throws — on a non-2xx response, a network error, a timeout, or an unparseable/empty body, so
// callers can fall back to the plain-link card unconditionally (criterion 2), exactly like
// `fetchOgPreview`.
export async function fetchYouTubeOembed(
  url,
  { fetchImpl = fetch, timeoutMs = YOUTUBE_OEMBED_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetchImpl(endpoint, { signal: controller.signal });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || !data.title) return null;
    return {
      title: data.title,
      description: null,
      image: data.thumbnail_url || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
