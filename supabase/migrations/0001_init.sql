-- Spec 001 — Core loop: capture, prioritized push, exit triage.
-- Schema covers exactly the 7 acceptance criteria and nothing beyond: no columns for
-- classification, time-budgeting or RAG (see "Delegated to the implementing agent" in
-- specs/001-core-loop.md).

create table if not exists objectives (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id bigint generated always as identity primary key,
  objective_id bigint not null references objectives (id),
  chat_id bigint not null,
  link text not null,
  status text not null default 'pending' check (status in ('pending', 'deleted', 'resource')),
  created_at timestamptz not null default now()
);

create index if not exists items_objective_status_created_idx
  on items (objective_id, status, created_at);

-- Staging row for a link that has been received but not yet attached to an objective (between
-- criterion 1's prompt and criterion 2/3's selection).
create table if not exists captures (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  link text not null,
  created_at timestamptz not null default now()
);

-- One outstanding "name the new objective" prompt per chat (criterion 3, step 2).
create table if not exists pending_actions (
  chat_id bigint primary key,
  kind text not null check (kind in ('awaiting_objective_name')),
  capture_id bigint not null references captures (id),
  created_at timestamptz not null default now()
);
