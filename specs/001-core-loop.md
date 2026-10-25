---
status: pendiente
depends_on: []
---

# 001 — Core loop: capture, prioritized push, exit triage

Builds the Telegram bot for Save2Grow Fase 0: forward a link, tag it to a self-created objective,
get a small prioritized push daily, and close each item with a triage decision. No AI, no hard
WIP block, no classification beyond the objective itself.

**Type**: feature · **Flow**: requirements-first

## Prior state

Newborn repo (`b5f52a8`, "the repo is born"). No code exists yet.

## Acceptance criteria

1. **Forwarding a link creates a pending item.** Sending any message containing a URL to the bot
   replies with inline buttons: one per existing objective + "+ nuevo objetivo".
   - Eval: unit test — mock Telegram update with a URL → asserts the reply payload contains one
     button per objective in the DB fixture + the "+ nuevo objetivo" button.
2. **Selecting an objective saves the item.** Tapping an existing objective button inserts a row
   (link, objective_id, status=`pending`, created_at) in Supabase.
   - Eval: unit test — mock callback_query for an existing objective → asserts the exact row
     inserted via the Supabase client mock.
3. **Creating a new objective on the fly works.** Tapping "+ nuevo objetivo" prompts for a name;
   the next message from that chat creates the objective and attaches the pending item to it.
   - Eval: unit test — mock the two-message exchange → asserts a new objective row + the item
     attached to its id.
4. **Daily push sends a small prioritized set per objective.** A scheduled job (GitHub Actions
   cron, 08:00 Europe/Madrid — DECIDED by Alis, Gate 1, 2026-10-25) selects pending items (oldest
   first within each objective, cap 3 per objective) and sends one Telegram message per item with
   3 triage buttons: Borrar / Guardar como recurso / Pendiente.
   - Eval: unit test — fixture with >3 pending items in one objective → asserts only the oldest 3
     are selected and the Telegram send payload has the 3 buttons.
5. **Triage updates the item's status, nothing blocks capture.** Tapping Borrar sets
   status=`deleted`; Guardar como recurso sets status=`resource`; Pendiente leaves it `pending`
   (stays in the queue, no cap enforced on how much can be pending at once).
   - Eval: unit test per button → asserts the resulting status in the mocked update call.
6. **No AI calls anywhere in this scope.** Grep across the implementation for any LLM/AI SDK
   import.
   - Eval: `grep -rE "anthropic|openai|@anthropic-ai" src/` (or equivalent) returns no matches.
7. **End-to-end manual smoke test** (not scriptable without a live bot token in CI): Alis forwards
   a real link to the live bot, selects/creates an objective, confirms the row appears in Supabase,
   and confirms the next day's push arrives with working triage buttons.
   - Checklist, run once after deploy by Alis; result recorded in `learnings/` with pass/fail per
     step.

## Decisions

**Closed before delegating:**
- DECIDED by Alis (Gate 1, 2026-10-25): daily push at 08:00 Europe/Madrid.
- DECIDED by Alis (Gate 1, 2026-10-22): Telegram as the capture channel, not WhatsApp — because
  WhatsApp Business API needs Meta approval and per-message cost; Telegram's Bot API is free and
  instant to set up.
- DECIDED by Alis (Gate 1, 2026-10-22): objectives are user-created, not a fixed system list.
- DECIDED by Alis (Gate 1, 2026-10-22): no hard WIP block — the push is a nudge, never blocks
  capture.
- DECIDED by Alis (Gate 1, 2026-10-22): independent of any of Alis's other personal tools — no
  integration with anything she had before this product.

**Delegated to the implementing agent, with criterion:**
- Exact serverless runtime (Supabase Edge Function vs. a plain Node script triggered by the
  Telegram webhook) — criterion: whichever keeps the stack to the fewest moving parts, given
  Supabase is already the DB; prefer Supabase Edge Functions unless a concrete blocker appears.
- Exact DB schema/column names — criterion: must support everything in the 7 criteria above and
  nothing beyond it; no columns for classification, time-budgeting, or RAG (out of scope below).

**Stopping conditions — the agent does not decide, it asks:**
- Alis's Telegram user ID is not confirmed yet. The agent does **not** invent or guess an ID, and
  does **not** silently skip the whitelist requirement forever: it implements the bot to log the
  sender's numeric ID on every incoming message (visible in the function's logs), ships without
  enforcing the filter, and stops with an explicit note asking Alis to confirm her ID so the filter
  can be turned on in a fast-follow commit.
- Any ambiguity between criteria 4 and 5 (e.g. what happens to an item mid-push if it's triaged by
  Alis before the push logic reads it) stops and asks rather than guessing a resolution order.

## Effects that escape the system

Real Telegram messages sent to Alis's own account during the manual smoke test (criterion 7). No
containment needed — it's her own bot and her own account, not a third party. No other external
effect (no payments, no emails, no messages to anyone else).

## Out of scope, with reactivation condition

- Clasificación por tipo de contenido, estado permanente/obsoleto más allá del triaje de 3 estados
  ya cubierto → entra en la Fase 1, cuando la Fase 0 lleve 1-2 semanas de uso real con el % de
  triaje subiendo frente a la línea base de Alis.
- Empaquetado de consumo por minutos, chat RAG, highlights, descubrimiento de contenido nuevo,
  monetización, multi-usuario real → fases posteriores del roadmap ya esbozado, cada una con su
  propia condición de reactivación en `context/scope.md` del brain.
