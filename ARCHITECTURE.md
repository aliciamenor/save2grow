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
