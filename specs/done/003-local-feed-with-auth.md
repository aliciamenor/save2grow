---
status: implementada
depends_on: []
---

# 003 — Local feed with magic-link auth

A local web page (no public hosting yet) where Alis logs in with a magic-link email and sees
everything she's saved — links and images — with the same 3-way triage available inline, instead
of only through Telegram's daily push.

**Type**: feature · **Flow**: requirements-first

## Prior state

`main` at `e74156b` (spec 002 merged and deployed). `items` table has no `user_id` column and no
RLS policies — it's read/written only by the Edge Functions using the service-role key, which
bypasses RLS entirely. No frontend exists yet.

## Acceptance criteria

1. **A local page is servable with zero extra tooling.** `python3 -m http.server` (or equivalent,
   already a hard requirement of this product's toolchain per the brain's own `CLAUDE.md`) run
   inside a `web/` folder serves `index.html` at `http://localhost:<port>`. No npm install step, no
   build step — plain HTML/CSS/JS, Supabase's JS client loaded from a CDN `<script>` tag, consistent
   with this repo's zero-npm-dependency pattern (`decisions.md`, 2026-10-25).
   - Eval: a smoke script (`evals/serve-check.sh` or similar) starts the server, curls
     `localhost:<port>`, asserts HTTP 200 and that the response contains the page's expected root
     element id, then kills the server. Fully scriptable, no live Supabase needed for this one.
2. **Entering an email and submitting sends a magic link**, via Supabase Auth
   (`signInWithOtp({email})`). The page shows a plain confirmation ("revisa tu email") after
   submitting — no stack traces, no raw API responses shown to the user.
   - Eval: can't be scripted without live Supabase Auth (needs a real email round-trip) — covered
     by the manual smoke test (criterion 8).
3. **Clicking the link in the email logs her into the local page**, and the session persists across
   a page reload (Supabase JS client's default local session storage).
   - Eval: manual smoke test only (criterion 8) — same reason as criterion 2.
4. **Once logged in, the feed lists everything saved**, newest first: links render as clickable
   text, images render inline using a short-lived signed URL from the private `item-images` bucket
   (never a public URL). Each item shows its current status (`pending` / `resource` / `deleted`).
   - Eval: unit test against the page's data-fetching/render function with a fake Supabase client
     (mocked `.from('items').select()` and `.storage.createSignedUrl()`) → asserts the rendered
     list matches the fixture, in the right order, with the right content per item kind.
5. **Each item has the same 3 triage buttons as the Telegram push** (Borrar / Guardar como recurso
   / Pendiente). Clicking one updates `items.status` in the database and the item's displayed
   status updates without a full page reload.
   - Eval: unit test — mock a button click → asserts the correct Supabase update call
     (`.from('items').update({status}).eq('id', ...)`)  and the in-memory/DOM state change.
6. **RLS restricts every read and write on `items` and the storage bucket to one specific
   authenticated identity — Alis's email — not "any logged-in user."** A stranger who requests
   their own magic link and logs in successfully sees an empty feed and can write nothing, because
   the policy checks `auth.jwt() ->> 'email'` against the one allowed value, not just
   `auth.role() = 'authenticated'`.
   - Eval: SQL eval — connect as a second, different authenticated test user (fixture) → assert
     `select` and `update` against `items` return zero rows / are rejected, while the Edge
     Functions' service-role access (unaffected by RLS) still works.
7. **No AI calls anywhere in this scope** (unchanged hard constraint).
   - Eval: existing grep check in `evals/run.sh`, extended to cover `web/`.
8. **Manual smoke test** (not scriptable — needs a real email and a real magic link): Alis starts
   the local server, requests a magic link, clicks it, confirms she's logged in, confirms her real
   items (including the image from spec 002's test) render correctly, and triages one item from the
   page, confirming the status change in the database.
   - Checklist in `learnings/003-smoke-test.md`, filled in by Alis (or the supervising session,
     narrating what it observed on her behalf) after deploy.

## Decisions

**Closed before delegating:**
- DECIDED by Alis (Gate 1, 2026-10-26): local-first (no public hosting) for this spec — Vercel or
  similar comes later, once she wants to open it from her phone or show it to someone else. Same
  code, deployed later, not rebuilt.
- DECIDED by Alis (Gate 1, 2026-10-26): magic-link auth (Supabase Auth), not an unprotected URL —
  this repo is public, so no "chapuza temporal" shortcut on who can read her data.
- DECIDED (Gate 1, 2026-10-26, this session acting on the security requirement already agreed):
  RLS must check the specific allowed email, not just "any authenticated user" — an open
  magic-link signup with role-only RLS would let a stranger log in as themselves and still read
  Alis's rows if the policy didn't check identity.

**Delegated to the implementing agent, with criterion:**
- The exact Supabase Auth redirect URL configuration for localhost (which port, how the callback
  is handled client-side) — criterion: pick one port, document it clearly in `ARCHITECTURE.md` and
  `learnings/003-smoke-test.md` so Alis knows exactly what URL to open; register it in the
  project's Auth settings as part of this spec's deploy steps (documented, not run by the agent —
  same pattern as spec 001/002's Supabase deploy steps).
- Exact signed-URL expiry time for images — criterion: long enough that a normal browsing session
  doesn't hit expired links mid-scroll (e.g. an hour), short enough that a copied/leaked URL goes
  stale soon after.
- Minimal styling — criterion: legible and usable, no design system needed for a local single-user
  tool; this is explicitly not a portfolio-polish pass, that comes once this is on Vercel.

**Stopping conditions:**
- The allowed email for the RLS policy and the magic-link login is not yet given in this spec —
  the agent does **not** guess or default it. It writes the RLS policy and any config against an
  env var / placeholder (e.g. `ALLOWED_OWNER_EMAIL`), never a literal email string committed to the
  repo, and stops to ask for the real value if it needs it to write a working migration rather than
  a templated one.
- Any approach that would require storing the email or any credential in a committed file (as
  opposed to a secret/env var) stops and asks — same rule that already applied to the Telegram
  owner ID in spec 001.

## Effects that escape the system

A real email sent to Alis's real inbox during the manual smoke test (the magic link itself) — no
containment needed, it's her own inbox. No other external effect.

## Evidence

`evals/run.sh` (run from the repo root, 2026-10-26):

```
PASS 003.1 web/ serves index.html via python3 -m http.server, no build step
PASS 003.4-5 unit tests (feed render order/content/status, triage update + in-memory state)
PASS 003.6 RLS policy checks the specific allowed identity (env-backed), not role-only, no literal email
PASS 003.7 no AI/LLM import in supabase/functions, web, or src
8 pass · 0 fail
```

- Criterion 1 → `spec003_serve_check` (`evals/serve-check.sh`): starts `python3 -m http.server`
  inside `web/`, curls `http://localhost:8787/`, asserts HTTP 200 and the root `id="app"`.
- Criteria 4, 5 → `spec003_unit_tests` (`node --test`, picking up `tests/web-feed.test.js`):
  10 tests, all passing — feed order/content/status per item kind (link vs. image, via a fake
  Supabase client's `createSignedUrl`), each of the 3 triage decisions' update call, and the
  pure in-memory status patch.
- Criterion 6 → `spec003_rls_policy`, a **static** check of
  `supabase/migrations/0003_local_feed_auth.sql`: asserts RLS is enabled on `items`, every policy
  compares `auth.jwt() ->> 'email'` against `current_setting('app.allowed_owner_email', true)`
  (not role-only), and no quoted string containing `@` (no literal email) appears anywhere in the
  file. This is structural, not a live cross-user connection — no local Postgres/Docker and no
  live Supabase credentials exist in the implementing agent's environment, the same constraint
  that makes criteria 2/3/8 manual. The live version of this exact check (a stranger's own magic
  link logging in and seeing zero rows) is added to `learnings/003-smoke-test.md`'s checklist.
- Criterion 7 → `spec003_no_ai_calls`: existing grep check, extended to `web/`.
- Criteria 2, 3, 8 → manual, see `learnings/003-smoke-test.md` (not yet run — needs the deploy
  steps in `ARCHITECTURE.md`, "Spec 003 — Deploying", applied first by the supervising session).

**Stopping condition honored**: the allowed owner email (`ALLOWED_OWNER_EMAIL`) is not written
anywhere in this repo. The RLS policy reads it from the Postgres session setting
`app.allowed_owner_email`, set once per database outside this repo — see `ARCHITECTURE.md` and
`decisions.md` (2026-10-26, "RLS checks the allowed email via a Postgres session setting, never a
literal").

## Out of scope, with reactivation condition

- Public hosting (Vercel) → whenever Alis wants to open this from her phone or show someone else;
  same code, a deploy step, not a rebuild.
- Visual polish / design pass → once this moves to Vercel as something worth showing, not before.
- Filtering/sorting the feed beyond "newest first, status visible" → only if real usage shows the
  plain list becomes hard to scan.
- Everything already out of scope for the whole Fase 0 in `context/scope.md` of the brain
  (classification, time-budgeting, RAG, highlights, discovery, monetization) — unchanged.
