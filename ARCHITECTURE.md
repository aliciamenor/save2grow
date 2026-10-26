# save2grow — Architecture (as-built)

> Describes what is built, never what is planned — what is missing lives in `specs/`.
>
> **Spec 002 rolled back part of spec 001's capture flow.** The objective prompt, the
> existing/new-objective buttons, and the `objectives`/`captures`/`pending_actions` tables are
> gone from the live code. Read "Spec 001" below only for what is still true (runtime,
> zero-dependency pattern, owner whitelist, cron DST handling); its "Core logic" and "Flow"
> subsections describe the pre-rollback capture behavior and are superseded by "Spec 002" below.

## Spec 001 — Core loop: capture, prioritized push, exit triage

### Runtime

- **Supabase Edge Functions** (Deno) for both HTTP entry points — chosen per the spec's delegated
  decision (fewest moving parts, Supabase is already the DB; no blocker appeared):
  - `supabase/functions/telegram-webhook/index.ts` — the Telegram bot webhook.
  - `supabase/functions/daily-push/index.ts` — invoked by the scheduler, not by Telegram.
- **GitHub Actions cron** (`.github/workflows/daily-push.yml`) calls `daily-push` over HTTPS with
  the service-role key as bearer auth. Europe/Madrid shifts between CET (UTC+1) and CEST (UTC+2),
  so the workflow fires at both 06:00 and 07:00 UTC and gates the actual call on the real
  Madrid-local hour computed at run time (`TZ=Europe/Madrid date +%H`), rather than hardcoding one
  UTC offset that would drift twice a year.
- No `@supabase/supabase-js`, no Telegram SDK, no AI/LLM SDK anywhere: all integrations (Supabase
  PostgREST + Storage, Telegram Bot API) are thin `fetch`-based wrappers in
  `supabase/functions/_shared/db.js` and `supabase/functions/_shared/telegram.js`. This keeps the
  dependency graph at zero npm packages, which is also what makes the "no AI calls" criterion true
  by construction rather than by a case-by-case audit.

### Owner whitelist — enforced

Alis confirmed her Telegram numeric user ID (2026-10-25). `telegram-webhook/index.ts` reads
`OWNER_TELEGRAM_ID` from the environment and silently drops (`200 ok`, no processing) any update
whose sender id doesn't match. Every sender id is still logged regardless
(`console.log("telegram sender id: ...")`, visible via `supabase functions logs
telegram-webhook`), so a future second user shows up before anyone adds them to an allowlist.
Needs a 5th secret/env var, `OWNER_TELEGRAM_ID`, set alongside the other four before this is
useful live — see the deploy steps below.

### Tests

- `tests/webhook-handler.test.js`, `tests/push-handler.test.js`, `tests/fakes.js` — Node's built-in
  test runner (`node --test`), zero extra dependencies.
- `evals/run.sh` — one function per criterion, called at the bottom of the file; run output is
  the evidence.
- Criterion 7 (live end-to-end smoke test) is manual by design (needs a live bot token and Alis's
  own Telegram account) — checklist in `learnings/001-smoke-test.md`, filled in after deploy.

### Deploying (not run by this agent — no push/merge, no live secrets here)

```
supabase link --project-ref <ref>
supabase db push
supabase functions deploy telegram-webhook
supabase functions deploy daily-push
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-webhook"
```

The four secrets (`TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) already exist as GitHub repository secrets; the Edge Functions read
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `TELEGRAM_BOT_TOKEN` from their own Supabase
function env (set separately via `supabase secrets set`, mirroring the same values) — plus a 5th,
`OWNER_TELEGRAM_ID` (set only as a secret — not written here), for the whitelist above.

## Spec 002 — Simplified capture: drop the objective prompt, accept images

### Database

Schema in `supabase/migrations/0001_init.sql` + `0002_simplified_capture.sql`. Live tables: a
single `items` table —

```
items (id, chat_id, link <nullable>, image_path <nullable>, status, created_at)
  check (link is not null or image_path is not null)
```

`objective_id`, `objectives`, `captures`, `pending_actions` are dropped, not left unused (see
`decisions.md`, 2026-10-26). A private Supabase Storage bucket, `item-images`
(`public = false`), holds captured photo bytes; nothing in this codebase ever makes it public —
`_shared/db.js#getSignedUrl` is the only read path.

### Core logic (testable without live credentials)

- `supabase/functions/_shared/webhook-handler.js` — `handleUpdate(update, {db, telegram,
  onSenderId})`:
  - A text message containing a URL (criterion 1): inserts an `items` row
    (`link, chat_id, status='pending'`) directly and replies `"Guardado."` with no
    `reply_markup` at all.
  - A message with a `photo` array (criterion 2): takes the largest size (last element), calls
    `telegram.getFile` for its `file_path`, downloads the bytes with `telegram.downloadFile`,
    uploads them via `db.uploadImage` to the `item-images` bucket at
    `<chat_id>/<timestamp>-<file_id>.jpg`, inserts an `items` row
    (`image_path, chat_id, status='pending'`), and replies the same `"Guardado."`.
  - A `triage:<item_id>:<decision>` callback (criterion 4, unchanged from spec 001): updates
    `items.status` to `deleted` / `resource` / stays `pending`. Works identically for a link or an
    image item — triage never inspects which one it is.
  - No `obj:`, `newobj:` or `awaiting_objective_name` handling anywhere (criterion 6).
- `supabase/functions/_shared/push-handler.js` — `buildDailyPush(db)` / `runDailyPush(db,
  telegram)` (criterion 3): selects the oldest 3 `pending` items **overall** (`db.getPendingItems`
  — no more per-objective grouping, since objective is out of scope). For each item: a link item
  sends a text message (`telegram.sendMessage`) with the link as the body; an image item resolves
  a signed URL (`db.getSignedUrl`) and sends it as a photo (`telegram.sendPhoto`). Both carry the
  same 3 triage buttons (Borrar / Guardar como recurso / Pendiente).
- The two Edge Function `index.ts` files are unchanged wiring: read env vars, call the shared
  logic, map to an HTTP response.

### Flow

1. A message containing a URL inserts an `items` row directly (`status='pending'`) and replies
   `"Guardado."` — no buttons, no prompt.
2. A message with a photo downloads the largest size, uploads it to the private `item-images`
   bucket, inserts an `items` row referencing the stored path, and replies the same `"Guardado."`.
3. The daily push (cron-triggered, unchanged schedule) selects the oldest 3 `pending` items overall
   and sends one Telegram message per item (text for a link, photo for an image) with the 3 triage
   buttons, each button's `callback_data` carrying the item id and the decision.
4. Tapping a triage button updates `items.status` to `deleted` / `resource` / stays `pending`,
   exactly as in spec 001, regardless of whether the item is a link or an image.

### Tests

- Same two test files as spec 001 (`tests/webhook-handler.test.js`, `tests/push-handler.test.js`),
  rewritten for the new behavior; `tests/fakes.js` gained `uploadImage`/`getSignedUrl` on the fake
  db and `getFile`/`downloadFile`/`sendPhoto` on the fake Telegram client.
- `evals/run.sh` — `spec002_unit_tests`, `spec002_no_ai_calls`, `spec002_objective_ui_removed`.
- Criterion 7 (live smoke test) is manual by design — checklist in `learnings/002-smoke-test.md`,
  filled in by Alis after deploy.

### Deploying

Same steps as spec 001 above, plus `supabase db push` to apply
`0002_simplified_capture.sql` (drops the objective tables/column, adds `image_path`, creates the
`item-images` bucket). No new secrets — image upload/signing reuses the existing
`SUPABASE_SERVICE_ROLE_KEY`.

## Spec 003 — Local feed with magic-link auth

### What this adds

The first real UI and the first real auth: a local-only static page under `web/` where Alis logs
in with a Supabase magic-link email and sees every saved `items` row — links and images — newest
first, with the same 3 triage actions (Borrar / Guardar como recurso / Pendiente) available
inline. No public hosting yet (closed decision, delegated to Vercel later, same code).

### Frontend (zero npm dependencies, same pattern as the rest of the repo)

- `web/index.html` — the whole page: a login form (email + "Enviar enlace") and a feed section,
  hidden/shown by auth state. Root element is `<body id="app">` (what `evals/serve-check.sh`
  asserts on). Loads Supabase's JS client from a pinned CDN URL
  (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js`), not
  bundled — no build step, no `npm install`.
- `web/js/config.js` — `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase's own *publishable*
  values — safe to ship to a browser by design; identity and access are enforced by RLS, not by
  keeping this file secret) and `REDIRECT_URL`. `SUPABASE_ANON_KEY` ships as a placeholder; see
  "Deploying" below.
- `web/js/feed.js` — pure, DOM-free logic, unit tested with a fake Supabase client
  (`tests/web-fakes.js`, `tests/web-feed.test.js`):
  - `fetchFeed(supabase)` (criterion 4): `items` ordered `created_at` descending; an image item
    (`image_path` set) resolves a signed URL via `supabase.storage.from('item-images')
    .createSignedUrl(path, 3600)` (1 hour — delegated decision, matches the expiry already used
    by the Telegram daily push); a link item uses `items.link` directly. Never a public URL.
  - `triageItem(supabase, itemId, decision)` (criterion 5): maps `delete`/`resource`/`pending` to
    `items.status` and issues `.from('items').update({status}).eq('id', itemId)` — same 3
    decisions and same resulting statuses as the Telegram push's inline keyboard.
  - `applyTriageResult(viewModels, itemId, newStatus)`: pure in-memory list update, so the page
    can patch one item's status text without a full re-render or page reload.
- `web/js/app.js` — DOM wiring only (login form submit, `onAuthStateChange`, rendering the list,
  wiring the 3 buttons to `onTriage`). Not unit tested, same split as `index.ts` vs
  `_shared/*.js` in the Telegram bot: the testable logic lives in `feed.js`, the wiring doesn't.
  `signInWithOtp({email})` failures and successes both render a single plain line
  (`"Revisa tu email."` / a generic retry message) — never a raw error or stack trace (criterion
  2).
- `web/css/style.css` — minimal styling (delegated decision: legible and usable, no design
  system; this is explicitly not the eventual Vercel polish pass).

### RLS — the security-critical piece (criterion 6)

`supabase/migrations/0003_local_feed_auth.sql` enables row-level security on `items` and adds a
`select`/`update` policy for the `authenticated` role (no `insert`/`delete` policy — denied by
default — capture still only happens through the Telegram bot's service-role key, unaffected by
RLS). It adds one more `select` policy on `storage.objects` scoped to the `item-images` bucket, so
the logged-in page can call `createSignedUrl` as itself.

Every policy's `using` clause is:

```sql
auth.jwt() ->> 'email' = (select value from app_config where key = 'allowed_owner_email')
```

**Not** `auth.role() = 'authenticated'` alone — a stranger who requests their own magic link and
logs in successfully gets `authenticated`, but their email never matches the one allowed value,
so they see zero rows and can update nothing (closed decision, Gate 1, 2026-10-26).

The allowed email is never a literal in this repo (stopping condition honored, same pattern as
`OWNER_TELEGRAM_ID` in spec 001 — see `decisions.md`, 2026-10-25, and the 2026-10-26 entry for
this spec). **Correction, 2026-10-26**: the original design read it from a Postgres session
setting (`current_setting('app.allowed_owner_email', true)`), set via `alter database ... set`.
Supabase's managed Postgres denies that statement — not even the linked project's own connection
has the privilege. `supabase/migrations/0004_app_config_table.sql` replaces it with a small
`app_config(key, value)` table instead (RLS-enabled, readable by any authenticated user — the one
row it holds is the same email every other policy already compares against, so reading it back
leaks nothing new). See `decisions.md` for the full entry.

### Tests

- `tests/web-fakes.js`, `tests/web-feed.test.js` — same `node --test` runner as every other test
  file in this repo, covering criteria 4 and 5 against `web/js/feed.js`.
- `evals/serve-check.sh` — starts `python3 -m http.server` inside `web/`, curls it, asserts HTTP
  200 and the root element, kills the server (criterion 1).
- `evals/run.sh` — `spec003_serve_check`, `spec003_unit_tests`, `spec003_rls_policy` (a static
  check of the migration's SQL — see the comment in `evals/run.sh` for why this is structural,
  not a live cross-user connection: no local Postgres/Docker and no live Supabase credentials are
  available to the implementing agent, the same constraint that makes criteria 2/3/8 manual-only),
  `spec003_no_ai_calls`.
- Criteria 2, 3, 8 (the real email round-trip, session persistence after clicking the link, and
  the full end-to-end run) are manual by design — checklist in `learnings/003-smoke-test.md`,
  which also carries the live version of criterion 6's cross-user check.

### Deploying

```
supabase db push                              # applies 0003_local_feed_auth.sql + 0004_app_config_table.sql
supabase functions deploy telegram-webhook    # unchanged, redeploy only if spec 001/002 code moved
supabase functions deploy daily-push          # same
```

Then, outside the repo (not run by the implementing agent — same as every secret in this
product):

1. **Insert the allowed owner email into `app_config`.** Via the CLI (`supabase db query
   --linked`) or the SQL editor, once per database, with the real value substituted in (never
   committed):
   ```sql
   insert into app_config (key, value) values ('allowed_owner_email', '<the real email>')
   on conflict (key) do update set value = excluded.value;
   ```
   This is the one piece of config the RLS policies in `0003_local_feed_auth.sql` /
   `0004_app_config_table.sql` depend on — without this row, every policy denies everyone,
   including Alis.
2. **Register the local redirect URL.** Supabase dashboard → Authentication → URL Configuration →
   add `http://localhost:8787/` to "Redirect URLs" (must match `web/js/config.js`'s
   `REDIRECT_URL` exactly, including the trailing slash). Without this, Supabase rejects the
   magic-link redirect with an error instead of logging Alis in.
3. **Fill in the publishable config.** Open `web/js/config.js` and replace
   `SUPABASE_ANON_KEY`'s placeholder with the project's "anon public" key (Project Settings →
   API). `SUPABASE_URL` is already set to this project's URL.
4. **Run the page locally:**
   ```
   cd web && python3 -m http.server 8787
   ```
   then open `http://localhost:8787/` in a browser. Port 8787 is the one documented and tested
   port — if Alis uses a different port, step 2's redirect URL and `REDIRECT_URL` in
   `config.js` must both change to match.

## Spec 004 — Feed UX overhaul: Instagram-style cards, 3 tabs, link previews, GAPING styling

### What this fixes and adds

Fixes the live bug confirmed after spec 003's deploy: "Borrar" correctly wrote `status='deleted'`
but the item stayed visible, merely relabeled. Spec 004 restructures triage into 3 real tabs
(Pendientes / Recursos / Borrados) where any of the 3 triage icons just moves the item between
tabs — nothing is ever hidden forever, so "Borrar" now visibly does something and is reversible
the exact same way as any other triage action. It also adds Open Graph link previews fetched at
capture time, and restyles the whole page with Alis's GAPING design tokens (light theme only).

### Database

`supabase/migrations/0005_link_previews.sql` adds 3 nullable columns to `items`:
`preview_title`, `preview_description`, `preview_image_url`. All three stay null for an image
item, a link with no OG tags, or a failed/timed-out fetch.

### Link previews (criterion 4)

`supabase/functions/_shared/og-preview.js` — pure fetch + parse, same collaborator-injection
shape as the rest of `_shared/`:

- `parseOgTags(html)`: regex over `<meta property="og:…" content="…">` (either attribute order),
  zero HTML-parsing dependency (delegated decision, see `decisions.md`). Never throws; a
  malformed fragment just yields `{title: null, description: null, image: null}`.
- `fetchOgPreview(url, {fetchImpl, timeoutMs})`: fetches with an `AbortController`-backed
  timeout (`OG_FETCH_TIMEOUT_MS = 4000`), parses the HTML, and resolves `null` — never
  throws — on a non-2xx response, a network error, a timeout, or a page with none of the 3 OG
  tags. `fetchImpl` defaults to the global `fetch`, swapped for a mock in tests.

`supabase/functions/_shared/webhook-handler.js`'s link-save path now takes an optional
`ctx.fetchOgPreview`: right after the existing `"Guardado."` reply, it fetches the preview for
the matched URL and, if any field came back non-null, writes it via the new
`db.js#updateItemPreview(itemId, {title, description, image})`. Wrapped in its own try/catch as
a second line of defense (`og-preview.js` already resolves `null` instead of throwing) — a
preview failure can never surface past capture. Omitting `ctx.fetchOgPreview` entirely (older
callers) skips the step with no error. `supabase/functions/telegram-webhook/index.ts` wires the
real `fetchOgPreview` import into `ctx`.

### Frontend — tabs, cards, relative time (criteria 1, 2, 3, 5)

`web/js/feed.js` (pure, DOM-free, unit tested) gained:

- `TABS` / `filterByTab(viewModels, tabKey)` / `countsByTab(viewModels)` (criterion 2):
  Pendientes is first (the default tab); counts are read off the same view models as the
  filtered lists, so they can never disagree.
- `relativeTime(createdAt, now)` (criterion 3): elapsed-duration buckets, delegated decision
  recorded in `decisions.md` — under a minute reads as `"hoy"`, then `"hace N minutos"`,
  `"hace N horas"`, `"hace N días"`, `"hace N semanas"`.
- `buildCard(viewModel, now)` (criteria 4, 5): one pure function builds the same
  `{kind, visual, heading, body, href, timestamp}` shape for all 3 content kinds
  (`link-preview`, `link-plain`, `image`) — only the `visual`/`heading`/`body` slots differ, so
  `app.js` renders one shared card component, not three unrelated layouts. `visual.type` is
  `"image"` or `"placeholder"` (the neutral block for a plain link with no OG image — delegated
  decision: `surface`/`border` tokens, not a broken-image icon).
- `remainsInTab(newStatus, currentTabKey)` (criterion 1): the one piece of the triage-click
  decision that is DOM-adjacent, extracted here (same split as the rest of this file) so it is
  unit tested without a DOM — `app.js`'s click handler calls it right after `applyTriageResult`
  to decide whether to remove the item's card from the current tab's list. All 3×3
  tab-and-decision combinations are exercised, including the Borrados→Pendiente restore case
  (`tests/web-feed.test.js`).
- `fetchFeed` now also resolves each link item's `preview` (`null`, or
  `{title, description, image}` from the 3 new columns).

`web/js/app.js` (DOM wiring, not unit tested — same convention as the rest of this file and
`index.ts`) renders the 3 tabs, builds each visible card from `buildCard`'s output, and wires the
3 icon-only triage buttons (trash / heart / clock, inline SVG, no icon-library dependency —
delegated decision). On a triage click: calls `triageItem` + `applyTriageResult` as before, then
`remainsInTab` — if false, removes just that card's DOM node (`li.remove()`), no full re-render,
no page reload.

### GAPING styling (criterion 6)

`web/css/style.css` — every token from the spec's inlined palette as a CSS custom property under
`:root` (light theme only; dark theme out of scope — see the spec's "Out of scope" section).
`web/index.html` loads Space Grotesk (headings) and Inter (body) from Google Fonts. The 3 triage
icons: trash (`icon-delete`, `ink-muted` — GAPING has no danger token, so "Borrar" is never red),
heart (`icon-resource`, `eje-impacto` green), clock (`icon-pending`, `brand` teal), each with an
`aria-label` naming the action in Spanish.

### Tests

- `tests/og-preview.test.js` — `parseOgTags`/`fetchOgPreview` against mock HTML responses: full
  tags, partial tags, no tags, a non-2xx response, a network error, and a timeout (criterion 4,
  fetch/parse eval).
- `tests/webhook-handler.test.js` gained 5 cases for the preview wiring: a link fetches and
  stores its preview, a `null` result writes nothing, a throwing fetcher never breaks capture, a
  photo message never calls the fetcher, and omitting `ctx.fetchOgPreview` is still safe
  (back-compat with spec 001–003's existing tests, which don't pass it).
- `tests/web-feed.test.js` gained cases for `filterByTab`/`countsByTab`, `relativeTime`'s
  boundary cases, `buildCard`'s 3 content kinds (plus the preview-text-without-image fallback to
  `placeholder`), `fetchFeed`'s new `preview` field, and all 9 triage-from-every-tab combinations
  against `remainsInTab` (criterion 1).
- `evals/run.sh` — `spec004_unit_tests`, `spec004_preview_schema` (static migration-presence
  check, same reasoning as `spec003_rls_policy`: no local Postgres/Docker or live Supabase
  credentials available to this agent), `spec004_gaping_tokens` (greps `web/css/style.css` for
  the exact hex values and for any invented red/danger CSS value — narrowly, not a
  whole-repo substring match, since "REDIRECT_URL"/"required" both contain the letters "red"),
  `spec004_triage_icons_not_text_buttons` (confirms no `button.textContent` in `app.js` is still
  set to spec 003's 3 text-label strings), `spec004_no_ai_calls`.
- Criterion 8 (live manual smoke test) is manual by design, same reasoning as every prior spec's
  live-only criteria — checklist in `learnings/004-smoke-test.md`.

### Deploying

```
supabase db push                              # applies 0005_link_previews.sql
supabase functions deploy telegram-webhook    # picks up the OG-preview wiring
supabase functions deploy daily-push          # unchanged, redeploy only if its code moved
```

Then restart the local server so it serves the new `web/` files:

```
cd web && python3 -m http.server 8787
```

No new secrets, no new config-table rows — link previews use the same service-role key the
webhook already writes with, and the GAPING restyle is static CSS/HTML/JS with no new env var.

## Spec 005 — Don't save a link twice

### What this adds

Forwarding a link that's already saved — in any tab, including Borrados — no longer creates a
second `items` row. The bot replies naming where the existing item currently sits instead of the
normal "Guardado." confirmation.

### Duplicate check (criteria 1, 2, 3)

`supabase/functions/_shared/db.js#findItemByLink(link)` (delegated decision: a plain `select`
before insert, not a unique constraint + conflict handling — simplest fit for this file's
existing `get`-wrapper pattern, no new dependency): queries `items?link=eq.<link>&limit=1` with
no `status` filter, so an item in any status counts as "already saved" (closed decision, Gate 1,
2026-10-26). Returns the row or `null`.

`supabase/functions/_shared/webhook-handler.js`'s link-save path calls it first, with the same
trimmed message text used as the `link` value today (criterion 1's "trimmed URL string" is this
file's existing link field, which is the whole trimmed message text, not just the matched URL
substring — unchanged from spec 002). On a hit: sends
`"Ya lo tienes guardado — está en <Pendientes|Recursos|Borrados>."` (via the new
`TAB_LABEL_BY_STATUS` map and `duplicateReplyText`), returns `{action: "duplicate", item}`, skips
`insertItem` and skips the OG-preview fetch entirely — no new row means nothing to attach a
preview to. On a miss: falls through to the unchanged insert + "Guardado." + preview flow.

The photo-handling branch is untouched (criterion 3) — `findItemByLink` is called only inside the
link branch; detecting a duplicate image needs comparing file bytes/hashes, out of scope here
(see the spec's "Out of scope" section).

### Tests

- `tests/webhook-handler.test.js` gained 4 cases: an exact duplicate skips the insert and replies
  with the Pendientes label; the reply names the correct tab for all 3 statuses
  (pending/resource/deleted); a non-matching link still saves normally (no false positive); a
  duplicate never calls `fetchOgPreview`. Spec 002's existing photo tests pass unmodified
  (criterion 3, implicit).
- `tests/fakes.js`'s fake db gained `findItemByLink`, matching on `link` string equality against
  its in-memory `state.items`, same case-sensitive exact-match semantics as the real PostgREST
  query.
- `evals/run.sh` — `spec005_unit_tests`, `spec005_photo_path_untouched` (structural check that
  `findItemByLink` isn't called inside the photo branch), `spec005_no_ai_calls`.
- Criterion 5 (live manual smoke test) is manual by design, same reasoning as every prior spec's
  live-only criteria — checklist in `learnings/005-smoke-test.md`.

### Deploying

No migration, no new secret, no new dependency — this spec only changes
`supabase/functions/_shared/db.js` and `supabase/functions/_shared/webhook-handler.js`:

```
supabase functions deploy telegram-webhook    # picks up the duplicate check
```

`daily-push` is unaffected and does not need redeploying.

## Spec 006 — YouTube previews via oEmbed

### What this adds

YouTube blocks `og-preview.js`'s generic Open Graph scraper for non-browser requests (spec 004's
documented, accepted fallback case) — confirmed live. A YouTube link always fell back to the
plain-link card. This spec adds a YouTube-specific path that uses YouTube's own public,
documented oEmbed endpoint instead, tried before the generic OG fetch.

### YouTube oEmbed (criteria 1, 2)

`supabase/functions/_shared/youtube-oembed.js`:

- `isYouTubeUrl(url)` (delegated decision, criterion: cover the common real-world forms without
  over-matching): a regex anchored right after the protocol (optional `www.`/`m.` prefix) —
  `youtube.com/watch?v=` (with or without other query params before `v=`) or `youtu.be/` — so a
  URL that merely contains "youtube" as a substring elsewhere (path, query, a different domain)
  never matches.
- `fetchYouTubeOembed(url, {fetchImpl, timeoutMs})`: fetches
  `https://www.youtube.com/oembed?url=<encoded url>&format=json` (`YOUTUBE_OEMBED_TIMEOUT_MS =
  4000`, same `AbortController` pattern as `og-preview.js`) and maps the JSON response to
  `{title, description, image}` — `title` from the response's `title`, `image` from
  `thumbnail_url`, `description` always `null` (oEmbed doesn't provide one, never fabricated).
  Never throws — resolves `null` on a non-2xx response, a network error, a timeout, or a
  response with no `title`, the same "falls back silently to the plain-link card" contract as
  `fetchOgPreview` (criterion 2).

`supabase/functions/_shared/webhook-handler.js`'s link-save path now takes an optional
`ctx.fetchYouTubeOembed` alongside the existing `ctx.fetchOgPreview`: for the matched URL, if
`isYouTubeUrl` is true and `fetchYouTubeOembed` is supplied, it is called instead of
`fetchOgPreview` — never both, and a failing/throwing oEmbed call never falls through to the
generic OG fetch (YouTube blocks that anyway; the failure resolves to no preview, same as every
other failure case). A non-YouTube URL is untouched and goes through `fetchOgPreview` exactly as
before. The whole fetch stays wrapped in the same try/catch as spec 004, so a preview failure can
never surface past capture. `supabase/functions/telegram-webhook/index.ts` wires the real
`fetchYouTubeOembed` import into `ctx`, next to `fetchOgPreview`.

### Tests

- `tests/youtube-oembed.test.js` — `isYouTubeUrl` against the 3 common forms plus
  substring-over-match cases (`example.com/youtube.com/watch`, `notyoutube.com`); `fetchYouTubeOembed`
  against a mocked oEmbed JSON response (`youtube.com/watch` and `youtu.be/` forms), the exact
  encoded endpoint URL requested, a non-2xx response, a network error, a timeout, and a response
  with no `title`.
- `tests/webhook-handler.test.js` gained 5 cases: a YouTube link calls `fetchYouTubeOembed` and
  never `fetchOgPreview`; a `youtu.be` short link routes the same way; a non-YouTube URL still
  goes through `fetchOgPreview` untouched; a failing/null `fetchYouTubeOembed` writes no preview
  and never falls through to `fetchOgPreview`; a throwing `fetchYouTubeOembed` never breaks
  capture.
- `evals/run.sh` — `spec006_unit_tests`, `spec006_no_ai_calls`.
- Criterion 4 (live manual smoke test) is manual by design, same reasoning as every prior spec's
  live-only criteria — checklist in `learnings/006-smoke-test.md`.

### Deploying

No migration, no new secret, no new dependency — this spec only adds
`supabase/functions/_shared/youtube-oembed.js` and changes
`supabase/functions/_shared/webhook-handler.js` + `supabase/functions/telegram-webhook/index.ts`:

```
supabase functions deploy telegram-webhook    # picks up the YouTube oEmbed path
```

`daily-push` is unaffected and does not need redeploying.
