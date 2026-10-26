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
