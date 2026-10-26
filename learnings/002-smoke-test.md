# 002-simplified-capture-with-images — manual smoke test (criterion 7)

Not run by the implementing agent: needs a live bot token and Alis's own Telegram account
(spec 002, criterion 7 — same honesty as spec 001's criterion 7, "not scriptable without live
credentials"). Fill in after deploy.

Also needed before this is live: `supabase db push` to apply
`supabase/migrations/0002_simplified_capture.sql` (drops `objective_id`/`objectives`/
`captures`/`pending_actions`, adds `items.image_path`, creates the private `item-images`
Storage bucket) and redeploy both Edge Functions — see `ARCHITECTURE.md`, "Spec 002 — Deploying".

## Checklist

- [ ] Forward a real link to the live bot → reply is exactly "Guardado.", no buttons.
- [ ] Check Supabase `items` → a new row with the right `link`, `status='pending'`, no
      `objective_id` column at all (dropped).
- [ ] Forward a real photo to the live bot → reply is exactly "Guardado.", no buttons.
- [ ] Check Supabase `items` → a new row with `image_path` set, `link` null, `status='pending'`.
- [ ] Check Supabase Storage → the uploaded file exists under the `item-images` bucket at that
      path, and the bucket itself is **not** public (confirm in the dashboard or by trying the
      object's public URL directly and getting denied).
- [ ] Wait for (or trigger via `workflow_dispatch`) the next day's push at 08:00 Europe/Madrid →
      one message per pending item arrives: the link item as text, the photo item as an actual
      photo (not a broken link), both with the 3 triage buttons.
- [ ] Tap each of the 3 triage buttons on different items (including the image item) → status
      updates in Supabase accordingly (deleted / resource / stays pending), nothing blocks sending
      a new link or photo afterwards.
- [ ] Confirm no `objectives`/`captures`/`pending_actions` tables are queried anywhere in
      `supabase functions logs` during this test (nothing left half-wired).

Result: **not yet run** — pass/fail per step to be filled in by Alis after deploy.
