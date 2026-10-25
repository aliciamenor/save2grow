# save2grow — Architecture (as-built)

> Describes what is built, never what is planned — what is missing lives in `specs/`.

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
- **Database**: Supabase Postgres, schema in `supabase/migrations/0001_init.sql` — `objectives`,
  `items`, `captures` (a link staged between being received and attached to an objective),
  `pending_actions` (one outstanding "name the new objective" prompt per chat).
- No `@supabase/supabase-js`, no Telegram SDK, no AI/LLM SDK anywhere: all three integrations
  (Supabase PostgREST, Telegram Bot API) are thin `fetch`-based wrappers in
  `supabase/functions/_shared/db.js` and `supabase/functions/_shared/telegram.js`. This keeps the
  dependency graph at zero npm packages, which is also what makes criterion 6 (no AI calls) true
  by construction rather than by a case-by-case audit.

### Core logic (testable without live credentials)

- `supabase/functions/_shared/webhook-handler.js` — `handleUpdate(update, {db, telegram,
  onSenderId})`: criteria 1 (prompt with objective buttons), 2 (save on selection), 3 (new
  objective two-message flow), 5 (triage). Takes its collaborators as plain objects so tests pass
  in-memory fakes instead of a real Supabase/Telegram connection.
- `supabase/functions/_shared/push-handler.js` — `buildDailyPush(db)` / `runDailyPush(db,
  telegram)`: criterion 4 (oldest-first, capped at 3 per objective, 3 triage buttons per item).
- The two Edge Function `index.ts` files are thin wiring only: read env vars, call the shared
  logic, map to an HTTP response. No business logic lives there.

### Flow

1. A message containing a URL creates a `captures` row and replies with one inline button per
   existing objective (for that chat) plus "+ nuevo objetivo".
2. Tapping an objective button reads the capture, inserts the `items` row
   (`link, objective_id, chat_id, status='pending', created_at`), and discards the capture.
3. Tapping "+ nuevo objetivo" stores a `pending_actions` row and asks for a name; the chat's next
   message creates the objective, attaches the item to it, and clears both the capture and the
   pending action.
4. The daily push (cron-triggered) selects, per objective, the oldest 3 `pending` items and sends
   one Telegram message per item with the 3 triage buttons (Borrar / Guardar como recurso /
   Pendiente), each button's `callback_data` carrying the item id and the decision.
5. Tapping a triage button updates `items.status` to `deleted` / `resource` / stays `pending`.
   Nothing caps how many items can be `pending` at once — the push is a nudge, never a block.

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
  test runner (`node --test`), zero extra dependencies. Evidence: `evals/run.sh:14-30`, run output
  below.
- `evals/run.sh` — criteria 1-5 via the unit test suite, criterion 6 via
  `grep -rE "anthropic|openai|@anthropic-ai" supabase/functions src`.
- Criterion 7 (live end-to-end smoke test) is manual by design (needs a live bot token and Alis's
  own Telegram account) — checklist in `learnings/001-smoke-test.md`, to be filled in after
  deploy.

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
