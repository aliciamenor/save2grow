-- Spec 002 — Simplified capture: drop the objective prompt, accept images.
--
-- Rolls back spec 001's objective-selection schema (criterion 6, delegated decision in
-- specs/done/002-simplified-capture-with-images.md): objective selection returns in Fase 1,
-- rebuilt deliberately against whatever this spec leaves behind, not patched back in now. The
-- tables/column are dropped rather than left nullable-and-unused, so the live schema stays
-- honest — nothing here looks required or looks live without being written to by anything in
-- this scope. Fase 1 adds its own `objectives` table and FK fresh, against real usage data.
--
-- `items.link` becomes nullable and `items.image_path` is added, since a captured item is now
-- either a link or an image (criterion 1, 2).

-- `pending_actions` referenced `captures`, so it goes first.
drop table if exists pending_actions;
drop table if exists captures;

alter table items drop column if exists objective_id;
drop index if exists items_objective_status_created_idx;

alter table items alter column link drop not null;
alter table items add column if not exists image_path text;

alter table items add constraint items_link_or_image_present
  check (link is not null or image_path is not null);

create index if not exists items_status_created_idx on items (status, created_at);

drop table if exists objectives;

-- Private bucket for captured photos (delegated decision: private + signed URLs, since no auth
-- exists yet to gate a public bucket — spec 003 adds the first real auth). Images are only ever
-- read through a signed URL generated server-side (see `_shared/db.js#getSignedUrl`), never a
-- public path.
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', false)
on conflict (id) do nothing;
