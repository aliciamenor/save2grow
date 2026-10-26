-- Fix for spec 003's deploy: `alter database ... set app.allowed_owner_email` requires
-- superuser, which Supabase's managed Postgres does not grant even on the linked project's own
-- connection. Replaces the custom GUC with a small config table instead — a standard pattern on
-- managed Postgres where ALTER DATABASE/ROLE SET is restricted. Same security property as before:
-- the real email is never a literal in any committed file, only inserted at deploy time by the
-- supervising session.

create table if not exists app_config (
  key text primary key,
  value text not null
);

alter table app_config enable row level security;

-- Readable by any authenticated user — this only ever holds the one allowed email used to gate
-- `items` and the image bucket below; leaking that single string to a logged-in stranger is not
-- a meaningful exposure (it can't be used to read anyone's data, it's what EVERY OTHER policy
-- compares against). No insert/update/delete policy: this table is deploy-time config, not
-- something the app ever writes.
create policy "authenticated can read app_config"
  on app_config for select
  to authenticated
  using (true);

drop policy if exists "owner reads own items" on items;
create policy "owner reads own items"
  on items for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = (select value from app_config where key = 'allowed_owner_email')
  );

drop policy if exists "owner updates own items" on items;
create policy "owner updates own items"
  on items for update
  to authenticated
  using (
    auth.jwt() ->> 'email' = (select value from app_config where key = 'allowed_owner_email')
  )
  with check (
    auth.jwt() ->> 'email' = (select value from app_config where key = 'allowed_owner_email')
  );

drop policy if exists "owner reads own item images" on storage.objects;
create policy "owner reads own item images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'item-images'
    and auth.jwt() ->> 'email' = (select value from app_config where key = 'allowed_owner_email')
  );
