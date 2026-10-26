---
status: implementada
depends_on: []
---

# 006 — YouTube previews via oEmbed

YouTube blocks the generic Open Graph scraper (spec 004's documented, accepted fallback case).
For a YouTube URL specifically, use YouTube's own public oEmbed endpoint instead — not evasion,
it's YouTube's own sanctioned API for exactly this (title, author, thumbnail), no API key needed.

**Type**: feature · **Flow**: requirements-first

## Prior state

`main` at `403e5a0` (spec 005 merged and deployed). `supabase/functions/_shared/og-preview.js`'s
`fetchOgPreview` is tried for every link; YouTube returns a page with no readable OG tags to a
non-browser fetch, so YouTube links always fall back to the plain-link card today — confirmed
live by Alis.

## Acceptance criteria

1. **A YouTube URL (`youtube.com/watch`, `youtu.be/...`, `m.youtube.com/watch`) is detected before
   the generic OG fetch runs, and resolved via `https://www.youtube.com/oembed?url=<encoded
   url>&format=json` instead.** Maps the response to the same `{title, description, image}` shape
   the rest of the pipeline already expects — `title` from the response's `title`, `image` from
   `thumbnail_url`, `description` left `null` (oEmbed doesn't provide one; never fabricated).
   - Eval: unit test — mock oEmbed JSON response for a `youtube.com/watch?v=...` and a
     `youtu.be/...` URL → asserts the mapped `{title, description:null, image}`; a non-YouTube URL
     is untouched, still goes through `fetchOgPreview`.
   - **Evidence**: `tests/youtube-oembed.test.js` (`isYouTubeUrl` cases, `fetchYouTubeOembed`
     mapping cases) and `tests/webhook-handler.test.js` ("spec006 criterion 1: a YouTube link
     fetches via fetchYouTubeOembed, not fetchOgPreview", "...a youtu.be short link also routes
     to fetchYouTubeOembed", "...a non-YouTube URL is untouched, still goes through
     fetchOgPreview"). `evals/run.sh#spec006_unit_tests` — **PASS**, run 2026-10-27, 78/78 tests
     green (`node --test`).
2. **A failed/non-2xx/timeout oEmbed call falls back to the plain-link card**, same behavior and
   same honesty as every other failure case in spec 004 — never blocks or breaks capture.
   - Eval: unit test — mock a non-2xx oEmbed response and a network error → asserts `null`,
     same contract as `fetchOgPreview`.
   - **Evidence**: `tests/youtube-oembed.test.js` ("a non-2xx response resolves null", "a network
     error resolves null", "a slow response that outlives the timeout resolves null", "a response
     with no title resolves null") and `tests/webhook-handler.test.js` ("spec006 criterion 2: a
     failing fetchYouTubeOembed resolves no preview, capture unaffected" — also asserts
     `fetchOgPreview` is never called as a fallback, "...a throwing fetchYouTubeOembed never
     breaks capture"). `evals/run.sh#spec006_unit_tests` — **PASS**, run 2026-10-27.
3. **No AI calls anywhere in this scope** (unchanged hard constraint).
   - Eval: existing grep check, unchanged.
   - **Evidence**: `evals/run.sh#spec006_no_ai_calls` — **PASS**, run 2026-10-27 (also verified
     live: `https://www.youtube.com/oembed?url=...&format=json` requires no API key and returns
     `{"title":"Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)", ...,
     "thumbnail_url":"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"}` for a real video,
     confirming the endpoint itself is not an AI call, just YouTube's own public API).
4. **Manual smoke test**: Alis forwards a YouTube link she hasn't saved before and confirms the
   feed shows its real title and thumbnail, not the plain-link fallback.
   - Checklist in `learnings/006-smoke-test.md`.
   - **Evidence**: not run by the implementing agent (needs a live deploy and a real Telegram
     forward) — checklist written, pending Alis after deploy. See "Still open" in the handoff
     report.

## Decisions

**Closed before delegating:**
- DECIDED by Alis (Gate 1, 2026-10-27): YouTube gets its own oEmbed path; this is not the
  "evasion" spec 004's stopping condition warned against — oEmbed is YouTube's own public,
  documented API for this exact purpose, no spoofed headers, no bot-blocking workaround.

**Delegated to the implementing agent, with criterion:**
- Exact YouTube URL pattern matching (which hostnames/path shapes count as "a YouTube URL") —
  criterion: cover the common real-world forms (`youtube.com/watch?v=`, `youtu.be/`,
  `m.youtube.com/watch?v=`) without over-matching unrelated URLs that merely contain "youtube" as
  a substring.

**Stopping conditions:**
- If Alis later asks for the same treatment for another blocked site (Spotify, X) — that's a new
  spec, not an extension of this one; each sanctioned-API integration is its own small, reviewable
  piece, not a growing generic "platform APIs" module.

## Effects that escape the system

A real HTTP request to YouTube's public oEmbed endpoint during the manual smoke test — same
exposure class as every other preview fetch in this product.

## Out of scope, with reactivation condition

- oEmbed (or similar) support for other platforms (Spotify, X/Twitter, Vimeo) → only if Alis hits
  the same blocked-preview frustration with one of them specifically; not pre-built speculatively.
