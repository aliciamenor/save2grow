---
status: pendiente
depends_on: []
---

# 002 — Simplified capture: drop the objective prompt, accept images

Removes the objective-selection step from capture (it moves to Fase 1) and adds photo capture
alongside links. Forwarding a link or a photo now saves immediately with no questions asked. The
daily push and the 3-way triage stay, just no longer grouped by objective.

**Type**: feature · **Flow**: requirements-first

## Prior state

`main` at `54d4928`. Spec 001 is live and deployed: Telegram webhook (Supabase Edge Function,
`verify_jwt = false`) captures links, prompts for an objective (existing or new), saves the item,
and a daily GitHub Actions cron pushes up to 3 pending items per objective with 3 triage buttons
(Borrar / Guardar como recurso / Pendiente). `objectives`, `items`, `captures`, `pending_actions`
tables exist in Supabase Postgres (`supabase/migrations/0001_init.sql`).

## Acceptance criteria

1. **Forwarding a link saves it immediately, no buttons, no objective prompt.** The bot replies
   with a short confirmation (e.g. "Guardado.") and nothing else.
   - Eval: unit test — mock message with a URL → asserts an `items` row is inserted directly
     (status=`pending`, no objective_id required) and the reply contains no inline_keyboard.
2. **Forwarding a photo saves it too.** The bot downloads the largest available size via
   Telegram's `getFile` + file download URL, uploads it to Supabase Storage, and inserts an
   `items` row referencing it, with the same immediate "Guardado." confirmation.
   - Eval: unit test — mock message with a `photo` array (fake file_id) → asserts
     `telegram.getFile` was called, the storage upload was called with the downloaded bytes, and
     an `items` row was inserted with the stored path/reference.
3. **The daily push still sends a small set, no longer grouped by objective.** Selects the oldest
   3 pending items overall (not per-objective, since objective is gone from this scope) and sends
   one message per item with the 3 triage buttons, same as before.
   - Eval: unit test — fixture with >3 pending items → asserts only the oldest 3 are pushed.
4. **Triage still works exactly as in spec 001**, unchanged: Borrar → `deleted`, Guardar como
   recurso → `resource`, Pendiente → stays `pending`. Works the same whether the item has a link or
   an image.
   - Eval: existing spec 001 triage unit tests still pass unmodified, plus one new case for an
     image item.
5. **No AI calls anywhere in this scope** (unchanged from spec 001).
   - Eval: `evals/run.sh`'s existing grep check still passes.
6. **The objective-selection code path (existing-objective buttons, "+ nuevo objetivo", the
   two-message new-objective flow, `pending_actions` table) is removed from the live capture
   flow, not left half-wired.** It is not deleted from the codebase history — it's a clean rollback
   of spec 001's capture UI, ready for Fase 1 to rebuild deliberately on top of the new simplified
   schema, not resurrect dead code.
   - Eval: grep for `newobj:` / `obj:` callback handling and `awaiting_objective_name` in the live
     webhook handler → none found; `pending_actions` table either dropped or left unused and
     undocumented as live (agent's call, see delegated decision below).
7. **Manual smoke test** (same honesty as spec 001's criterion 7 — not scriptable without live
   credentials): Alis forwards a real link, then a real photo, confirms both show up as rows with
   no button prompt, and confirms the next day's push arrives with triage buttons for both kinds.
   - Checklist in `learnings/002-smoke-test.md`, filled in by Alis after deploy.

## Decisions

**Closed before delegating:**
- DECIDED by Alis (Gate 1, 2026-10-26): objective selection at capture time moves out of Fase 0
  entirely — it returns in Fase 1, rebuilt against whatever schema this spec leaves behind, not
  patched back in now.
- DECIDED by Alis (Gate 1, 2026-10-26): images are in scope for Fase 0, not deferred.
- DECIDED by Alis (Gate 1, 2026-10-26, via this session acting on her stated intent): the daily
  Telegram push stays in Fase 0 — it already works, removing it isn't necessary just because a
  browsing feed (spec 003) is coming. If this reading is wrong, Alis corrects it before this spec
  is implemented.

**Delegated to the implementing agent, with criterion:**
- Whether `objective_id` on `items` becomes nullable or is dropped from the schema entirely, and
  whether `objectives`/`pending_actions` tables are dropped or left in place unused — criterion:
  whichever makes Fase 1's eventual migration cleanest to write **and** leaves the live schema
  honest (no column that looks required but never gets set, no table that looks live but isn't
  written to by anything). Record the choice in `decisions.md` either way.
- Supabase Storage bucket name and whether uploaded images are public or served through a signed
  URL — criterion: default to a private bucket with signed URLs (least exposure), since this
  repo is public and nothing about auth exists yet to gate a public bucket (spec 003 adds the
  first real auth).
- Exact confirmation text for a saved item — criterion: short, no system jargon ("objetivo",
  "captura" as internal names don't belong in what the bot says back to Alis).

**Stopping conditions:**
- If criterion 6's cleanup would also require touching `.github/workflows/daily-push.yml` beyond
  removing objective-grouping (e.g. a scheduling change) — stop and ask, that's out of this spec's
  scope.
- Any migration that would **destroy** existing rows in `items` (as opposed to adding/relaxing
  columns) stops and asks — the handful of test rows from spec 001's manual testing aren't
  precious, but a destructive migration pattern shouldn't become a habit without Alis seeing it
  once.

## Effects that escape the system

Real Telegram messages to Alis's own account during the manual smoke test (same as spec 001, no
containment needed). A real image upload to Supabase Storage during that same test — her own
storage, her own account, no third party involved.

## Out of scope, with reactivation condition

- Objective selection, grouping, and the 4-type classification → Fase 1, once this simplified
  Fase 0 has real usage data showing the push+triage loop itself works, same reactivation logic as
  the existing roadmap in `context/scope.md`.
- The browsing feed/interface → spec 003, built right after this one merges, against its final
  schema.
