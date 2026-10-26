# 003-local-feed-with-auth — manual smoke test (criteria 2, 3, 8; plus the live half of 6)

Not run by the implementing agent: needs a real email round-trip (spec 003, criteria 2/3 — same
reasoning as spec 001/002's "not scriptable without live credentials") and a live Supabase
project with the deploy steps below already applied. Fill in after deploy.

**Before starting**, three things must already be true — see `ARCHITECTURE.md`, "Spec 003 —
Deploying":

1. `supabase db push` has applied `supabase/migrations/0003_local_feed_auth.sql`.
2. The `app.allowed_owner_email` Postgres setting has been set to the real
   `ALLOWED_OWNER_EMAIL` value (outside this repo — never committed).
3. `http://localhost:8787/` is registered as a redirect URL in the Supabase dashboard
   (Authentication → URL Configuration), and `web/js/config.js`'s `SUPABASE_ANON_KEY`
   placeholder has been replaced with the project's real anon public key.

## Checklist

- [ ] `cd web && python3 -m http.server 8787`, open `http://localhost:8787/` → login form
      shown, no feed, no console errors.
- [ ] Enter Alis's real email, submit → page shows exactly "Revisa tu email." (criterion 2), no
      stack trace, no raw Supabase error, even if you check the browser console.
- [ ] Open the email, click the magic link → lands back on `http://localhost:8787/` logged in,
      feed section visible, login form hidden (criterion 3).
- [ ] Reload the page (plain browser refresh) → still logged in, no second login prompt
      (criterion 3, session persistence).
- [ ] Feed shows every real saved item, newest first: the link items render as clickable text,
      the image item from spec 002's smoke test renders inline as an actual image (not a broken
      link or a raw storage path) — confirms the signed URL resolves and the bucket stays
      private (criterion 4).
- [ ] Every item shows its current status (`pending` / `resource` / `deleted`) in plain text.
- [ ] Tap "Borrar" on one item → its status updates on the page immediately, without a visible
      full page reload; check Supabase `items` → that row's `status` is now `deleted`
      (criterion 5).
- [ ] Tap "Guardar como recurso" on a different item → same check, `status = 'resource'`.
- [ ] Tap "Pendiente" on a third item → same check, `status` stays/returns to `'pending'`.
- [ ] **Stranger check (live half of criterion 6):** from a different browser profile (or
      incognito), request a magic link for a *different* real email address you control, click
      it, land on the same local page logged in as that stranger → the feed is empty and no
      triage button produces any visible effect (its own `items.update` call should return zero
      rows affected — check Supabase logs or the browser network tab for a `0`-row response, not
      an error). This is the part of criterion 6 the static `evals/run.sh` check
      (`spec003_rls_policy`) cannot cover, since it only inspects the SQL text, not a live
      cross-user session.
- [ ] Confirm nothing in `supabase functions logs` shows the Edge Functions (Telegram bot)
      breaking after `0003_local_feed_auth.sql` landed — service-role writes should be completely
      unaffected by the new RLS.

Result: **not yet run** — pass/fail per step to be filled in by Alis (or the supervising session,
narrating what it observed on her behalf) after deploy.
