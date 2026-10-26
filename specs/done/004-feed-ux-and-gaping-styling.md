---
status: implementada
depends_on: []
---

# 004 — Feed UX overhaul: Instagram-style cards, 3 tabs, link previews, GAPING styling

Fixes the triage-doesn't-visibly-work bug, restructures the feed into a single-column card feed
(image/preview first, icon-only actions, like a social feed's post layout — not literally
Instagram's product, just that interaction pattern) across three tabs (Pendientes / Recursos /
Borrados — nothing is ever hidden from Alis), adds Open-Graph link previews, and restyles the
whole page using Alis's own GAPING design system tokens (inlined below — the agent has no access
to the Artifact itself).

**Type**: feature · **Flow**: requirements-first

## Prior state

`main` at `2ce57c2` (spec 003 merged and deployed; local feed with magic-link auth working).
Known bug, confirmed live: clicking "Borrar" correctly sets `items.status = 'deleted'` in the
database (verified directly via SQL), but the item stays visible in the feed with its status label
merely relabeled — it doesn't look like anything happened, so it reads as broken even though the
write succeeded.

## Acceptance criteria

1. **Triage moves an item between tabs, it never deletes anything from view.** Tapping any of the
   3 triage icons (see criterion 6) moves the item out of its current tab's list — "Borrar" moves
   it to the Borrados tab, not out of existence. No page reload. Every item, in every tab, keeps
   the same 3 triage icons — tapping the "Pendiente" icon on an item sitting in Borrados restores
   it, the exact same code path as any other triage action. Undo is just triage, not a separate
   feature.
   - Eval: unit test on `app.js`'s triage handler (extract the DOM-move logic into a small
     testable function if needed, same split as `feed.js`) → mock each of the 3 icon clicks from
     each of the 3 tabs → asserts the item's DOM node leaves the current tab's list and the
     in-memory view model's status updates correctly, including the Borrados→Pendiente restore
     case.
2. **Three tabs: "Pendientes" (default), "Recursos", "Borrados"** — filtered by `status='pending'`
   / `'resource'` / `'deleted'` respectively. Pendientes shows a count in its tab label (e.g.
   "Pendientes (3)").
   - Eval: unit test on the feed-filtering function in `feed.js` → fixture with mixed statuses →
     asserts each tab's filtered list and the count.
3. **Each item shows how long ago it was saved** ("hace 2 días", "hace 3 horas", "hoy"), computed
   from `created_at`.
   - Eval: unit test — fixed "now" injected, fixture timestamps → asserts the exact Spanish
     relative-time string for a few boundary cases (minutes, hours, days, weeks).
4. **Link previews**: when an item's `link` points to a page with Open Graph tags
   (`og:title`, `og:description`, `og:image`), those are fetched once at capture time (in the
   Telegram webhook, right after replying "Guardado.") and stored on the item; the feed renders a
   card with the preview image, title, and description instead of a bare URL. A link with no OG
   tags, or a fetch that fails/times out, falls back to today's plain clickable link — never
   blocks or breaks capture.
   - Eval (fetch/parse logic): unit test — mock HTML responses (with full OG tags, partial tags,
     no tags, a timeout/network error) → asserts the parsed `{title, description, image}` is
     correct or `null` per case, and that a parse failure never throws past the capture flow.
   - Eval (schema): migration adds `preview_title`, `preview_description`,
     `preview_image_url` (all nullable) to `items` — asserts via `supabase db diff` equivalent
     check or a migration-presence test, agent's call on exact mechanism.
   - Eval (render): unit test on the feed's render function → fixture item with preview fields set
     → asserts a preview card is built; fixture item with all preview fields null → asserts the
     plain-link fallback is built instead.
5. **Every card follows one Instagram-post-like shape, full width, single column**: the visual
   (preview image, item's own photo, or — for a plain link with no image — a neutral placeholder
   block) fills the top of the card edge-to-edge; below it, the title/description (or the bare URL
   if no preview) and the "hace X" timestamp in small muted text; at the bottom, a row of 3 icon
   buttons (no text labels) for the triage actions. One shared card component renders all three
   content kinds (link-with-preview, link-without-preview, image) with only the middle content
   block differing — not three unrelated layouts.
   - Eval: covered by the same render-function unit tests as criterion 4 — asserts the same card
     structure is produced for each of the three content kinds, differing only in the content
     slot.
6. **The whole page is restyled with GAPING's actual tokens**, inlined here so the agent needs no
   external access:

   **Colors** (light theme only for this spec — dark theme is out of scope, see below):
   `surface:#f9fafb` (page background) · `surface-card:#ffffff` (card background) ·
   `border:#e5e7eb` · `ink:#1f2937` (headings/primary text) · `ink-body:#4b5563` (body text) ·
   `ink-muted:#6b7280` (secondary text, metadata, the "hace X" timestamp) · `brand:#42767f` (links,
   the active tab, the "restore to Pendiente" icon) · `brand-deep:#2f5860` (highest-weight brand
   anchor, used sparingly) · `eje-impacto:#10b981` (the "Guardar como recurso" icon — the closest
   semantic fit in this palette to a positive/confirm color) · `brand-tint:rgba(66,118,127,0.08)`
   (subtle background for the active tab). **No red/danger token exists in GAPING** — the
   "Borrar" icon stays neutral (`ink-muted`, same visual weight as the other two icons until
   hovered/pressed), never an invented red. Do not use `ink-faint` for anything under 18px
   (GAPING's own audit note: it fails contrast below that size) — use `ink-muted` instead for the
   timestamp and tab labels.

   **Typography**: `'Space Grotesk', system-ui, sans-serif` for headings (h1 `56px/1.1/700`, h2
   `36px/1.15/700`, h3 `22px/1.2/700` — h3 fits the "save2grow" page title here), `'Inter',
   system-ui, sans-serif` for body (`body`: `16px/1.65/400` for descriptions, `caption`:
   `13px/1.4/500` for the "hace X" timestamp and tab labels). Load both from Google Fonts.

   **Spacing**: `space-4:16px` (icon row padding), `space-6:24px` (card internal padding below the
   image), `space-8:32px` (gaps between cards in the feed).

   **Radius**: `radius-lg:12px` (cards — the system's base radius), `radius-sm:8px` (tab
   buttons).

   **Shadow**: `shadow-card: 0 4px 12px -2px rgba(31,41,55,0.08)` (default card elevation),
   `shadow-card-hover: 0 12px 32px -8px rgba(31,41,55,0.16)` (on hover).

   **Icons**: simple inline SVG line icons (no icon font, no new dependency) — a heart or leaf
   shape for "Guardar como recurso", a trash/bin shape for "Borrar", a clock or bookmark shape for
   "Pendiente". Each with a visible `aria-label` naming the action in Spanish (icon-only buttons
   still need an accessible name).

   - Eval: this criterion is generative/visual — rubric, not a deterministic check. A human (Alis,
     in the manual smoke test) confirms: the feed reads as a single column of full-width cards
     with the image/preview on top, icon row at the bottom (not text buttons), page background is
     off-white, cards are white with a visible soft shadow and rounded corners, the page title
     uses the display font, body text uses Inter, and nothing is red. The agent's own check before
     handing off: grep the CSS for the exact hex values above (present) and the literal string
     `red` or any `#f00`/`#ff0000`-family value (absent); grep the HTML/JS for text-label triage
     buttons from spec 003 (e.g. the literal strings "Borrar", "Guardar como recurso" as visible
     button text rather than `aria-label` values) to confirm they were actually replaced, not left
     duplicated alongside the new icons.
7. **No AI calls anywhere in this scope** (unchanged hard constraint).
   - Eval: existing grep check, extended to any new files this spec adds.
8. **Manual smoke test**: Alis reloads the local feed, confirms triage moves items between tabs
   (including restoring one from Borrados), confirms the feed reads as a card-per-item column with
   icon actions, forwards a new link with known Open Graph tags (e.g. a real news article) to the
   bot and confirms its preview card renders correctly, and confirms the visual rubric in
   criterion 6.
   - Checklist in `learnings/004-smoke-test.md`.

## Decisions

**Closed before delegating:**
- DECIDED by Alis (Gate 1, 2026-10-26): three tabs — Pendientes / Recursos / Borrados — nothing is
  ever hidden from her permanently; "Borrar" is reversible via the same triage mechanism.
- DECIDED by Alis (Gate 1, 2026-10-26): visual direction inspired by a social-feed post layout
  (image-first card, icon-only actions, single column) — the interaction pattern, not Instagram's
  actual branding, colors or product.
- DECIDED by Alis (Gate 1, 2026-10-26): use the GAPING design system (tokens inlined above) for
  all styling in this spec, not a generic/ad-hoc palette.
- DECIDED (Gate 1, 2026-10-26, this session acting on the design system's own content): light
  theme only — GAPING defines a dark theme too, but nothing about dark mode was asked for, and
  adding it doubles every styling decision for no stated need. Out of scope below, not forgotten.

**Delegated to the implementing agent, with criterion:**
- Exact mechanism for fetching Open Graph tags (regex over the raw HTML vs. a tiny parser) —
  criterion: zero npm dependencies if reasonably achievable (this repo's established pattern); if
  genuinely impractical without a parsing library, name the one dependency and why plain regex
  over `<meta>` tags isn't reliable enough, and record it as a decision rather than silently
  breaking the zero-dependency pattern.
- Timeout value for the OG-tag fetch — criterion: short enough that capture still feels instant to
  Alis (a few seconds at most), long enough to not fail on a normal slow page.
- Exact SVG paths for the 3 icons — criterion: simple, recognizable line-icon shapes (as described
  above), consistent stroke width with each other; no icon library dependency.
- Placeholder visual for a plain link with no Open Graph image — criterion: a neutral block using
  `surface`/`border` tokens, not a broken-image icon or empty space.

**Stopping conditions:**
- Any site that returns meaningfully different content to this fetcher than to a real browser
  (bot-blocking) is an acceptable "falls back to plain link" case, not something to work around
  with spoofed headers or other evasion — if the agent finds itself reaching for that, it stops
  and asks instead, since that's a judgment call about this product's conduct, not a technical
  default.
- If GAPING's token values above don't cleanly cover some UI element the implementation needs
  (nothing stated here fits), the agent does not invent a token-like value — it asks, rather than
  guessing a color/size that looks plausible but isn't actually from the system.

## Effects that escape the system

A real HTTP request to whatever URL Alis forwards during the manual smoke test (criterion 8),
fetching its public page content — same exposure as opening the link in a browser, nothing beyond
that. No other external effect.

## Out of scope, with reactivation condition

- Dark theme (GAPING defines one; not built here) → only if Alis asks for it specifically; this
  product has no dark-mode toggle or system-preference detection yet either.
- A permanent hard-delete (actually removing a row) → not part of this product's design; "Borrar"
  has always meant "soft delete, reversible" since this spec, and no one has asked for true
  deletion.
- Public hosting (Vercel), the rest of the Fase 0/1+ roadmap (`context/scope.md`) → unchanged.
- Highlights/pattern-detection across saved content (mentioned earlier as a Fase 3+ idea) → still
  there, untouched by this spec; link previews here are per-item metadata, not cross-item
  analysis.

## Evidence (filled in by the implementing agent, 2026-10-26)

All automated evals pass — `evals/run.sh` output below (also `tests/og-preview.test.js`,
`tests/webhook-handler.test.js`, `tests/web-feed.test.js` directly: `node --test` → 55 tests, 0
failures):

```
PASS 004.1-4 unit tests (triage-visibility, tabs/counts, relative time, OG fetch/parse, card render)
PASS 004.4 migration adds preview_title/preview_description/preview_image_url to items
PASS 004.6 GAPING hex tokens present, no invented red/danger color value
PASS 004.6 triage actions are icon-only buttons, not spec 003's text-label buttons
PASS 004.7 no AI/LLM import in supabase/functions, web, or src
13 pass · 0 fail  (all specs 001-004 combined)
```

Per criterion:

1. **Triage moves between tabs (never deletes from view).** `web/js/feed.js#remainsInTab`
   (unit tested, all 3×3 tab × decision combinations including Borrados→Pendiente restore —
   `tests/web-feed.test.js`); `web/js/app.js`'s click handler calls it to decide DOM removal.
2. **3 tabs, Pendientes default, counts.** `web/js/feed.js#TABS`/`filterByTab`/`countsByTab`,
   unit tested.
3. **Relative time.** `web/js/feed.js#relativeTime`, unit tested with a fixed `now` and boundary
   fixtures (see `decisions.md` for the bucketing scheme, a delegated decision).
4. **Link previews.** Fetch/parse: `supabase/functions/_shared/og-preview.js`, unit tested
   (full/partial/no tags, non-2xx, network error, timeout — all resolve correctly or `null`,
   never throw). Schema: `supabase/migrations/0005_link_previews.sql` (static check,
   `spec004_preview_schema`). Render: `web/js/feed.js#buildCard`, unit tested for the preview
   card and the plain-link fallback.
5. **One shared card shape.** `buildCard` produces the same `{kind, visual, heading, body, href,
   timestamp}` structure for all 3 content kinds — verified by the same render tests as
   criterion 4.
6. **GAPING styling.** `web/css/style.css` tokens — automated: `spec004_gaping_tokens` (exact hex
   values present, no invented red/danger value) and `spec004_triage_icons_not_text_buttons`
   (spec 003's text-label buttons gone). Visual rubric itself (card layout, fonts, colors reading
   right) — manually verified in-session via a same-origin fixture page rendering `buildCard`'s
   output through the real `web/js/app.js`/`style.css` logic in the browser pane (screenshot
   evidence reviewed during implementation, not committed to the repo); still needs Alis's own
   confirmation against the live feed per criterion 8.
7. **No AI calls.** `spec004_no_ai_calls`, extended grep over `supabase/functions`, `web`, `src`.
8. **Manual smoke test.** Not run by this agent — needs a live deploy (migration pushed, webhook
   redeployed, local server restarted) and a real forwarded link. Checklist:
   `learnings/004-smoke-test.md`, status **not yet run**.

**Open after this agent's work**: criterion 8's live checklist in
`learnings/004-smoke-test.md`, which also carries the live confirmation of criterion 6's visual
rubric against the real deployed page (the in-session browser check above used fixture data, not
a live Supabase session). Branch: `worktree-agent-a62d19c63ca8354d9`, ready for Gate 2
(`scripts/merge-if-green.sh`).
