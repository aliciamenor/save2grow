-- Spec 003 — Local feed with magic-link auth.
--
-- Adds the first real RLS on `items` and on the private `item-images` bucket (criterion 6).
-- Closed decision (specs/done/003-local-feed-with-auth.md, Gate 1 2026-10-26): the policy must
-- check the one specific allowed identity, not `auth.role() = 'authenticated'` alone — a
-- stranger who requests their own magic link and logs in successfully must see zero rows and
-- write nothing.
--
-- Stopping condition honored: the allowed email is never a literal in this file (or anywhere
-- else in this repo). It is read at query time from the Postgres session setting
-- `app.allowed_owner_email`, set once per database by the supervising session from the
-- `ALLOWED_OWNER_EMAIL` secret — see ARCHITECTURE.md, "Spec 003 — Deploying". Same pattern as
-- `OWNER_TELEGRAM_ID` in spec 001 (decisions.md, 2026-10-25): the real value lives only outside
-- this repo, never committed.
--
-- The Edge Functions keep writing with the service-role key, which bypasses RLS entirely —
-- capture still happens only through the Telegram bot, unaffected by anything below.

alter table items enable row level security;

-- No insert/delete policy for `authenticated`: with RLS enabled and no policy for an operation,
-- that operation is denied by default for that role. The web feed only ever reads and triages
-- (updates `status`); it never creates or removes rows.

create policy "owner reads own items"
  on items for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = current_setting('app.allowed_owner_email', true)
  );

create policy "owner updates own items"
  on items for update
  to authenticated
  using (
    auth.jwt() ->> 'email' = current_setting('app.allowed_owner_email', true)
  )
  with check (
    auth.jwt() ->> 'email' = current_setting('app.allowed_owner_email', true)
  );

-- `storage.objects` already has RLS enabled by default on every Supabase project (it cannot be
-- turned off), so only the policy is added here. The bucket itself stays private (spec 002); this
-- policy is what lets the logged-in web feed call `createSignedUrl` as itself instead of needing
-- the service-role key client-side.
create policy "owner reads own item images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'item-images'
    and auth.jwt() ->> 'email' = current_setting('app.allowed_owner_email', true)
  );
