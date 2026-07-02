-- ============================================================================
-- texasroadtripbingo — schema, guards, RLS, realtime
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Then run seed.sql (after putting real first names in it).
--
-- Security model (be honest with yourself about this):
-- All four devices share the publishable (anon) key and there is no auth, so
-- the database CANNOT tell players apart. What it CAN enforce is shape:
--   * no deletes, ever
--   * no self-confirmation (CHECK)
--   * confirmations are write-once (trigger)
--   * server owns the game-logic timestamps (column grants + trigger)
--   * core claim columns are immutable after insert (column grants + trigger)
-- Which player a device says it is remains the honor system — fine for a
-- family of four, not fine for strangers. Don't reuse this schema publicly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 30),
  role       text not null check (role in ('kid', 'parent')),
  team       text check (team in ('girls', 'parents')),
  created_at timestamptz not null default now()
);

create table public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  emoji      text not null default '🎯',
  points     int  not null check (points between 1 and 100),
  claim_rule text not null default 'per_player_per_day'
             check (claim_rule in ('per_player_per_day', 'first_per_day', 'once_per_trip')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.claims (
  -- id is generated on the CLIENT so offline claims can be queued and later
  -- upserted idempotently: a retried flush hits the same pk and is a no-op.
  id                uuid primary key,
  item_id           uuid not null references public.items(id),
  claimer_id        uuid not null references public.players(id),
  claimed_at        timestamptz not null,              -- client clock: display only
  synced_at         timestamptz not null default now(),-- server clock: ALL game logic
  game_day          date not null,                     -- device-local date at claim time
  confirmer_id      uuid references public.players(id),
  confirmed_at      timestamptz,                       -- client clock: display only
  confirm_synced_at timestamptz,                       -- server clock, set by trigger
  status_override   text check (status_override in ('confirmed', 'denied')), -- admin
  points_adjustment int not null default 0 check (points_adjustment between -100 and 100),
  admin_note        text check (admin_note is null or char_length(admin_note) <= 200),
  -- The core rule of the game, enforced where it can't be dodged:
  constraint no_self_confirm check (confirmer_id is null or confirmer_id <> claimer_id)
);

-- Deliberate deviation from CLAUDE.md's "3 tables max" (see PLAN.md D7):
-- the per-day mode has to persist and sync somewhere.
create table public.days (
  game_day date primary key,
  mode     text not null default 'ffa' check (mode in ('ffa', 'teams')),
  set_by   uuid references public.players(id)
);

-- Reconciliation fetches filter on synced_at after every reconnect/wake.
create index claims_synced_at_idx on public.claims (synced_at);
create index claims_game_day_idx  on public.claims (game_day);

-- ---------------------------------------------------------------------------
-- Trigger: server owns confirm_synced_at; confirmations write-once;
-- core claim columns immutable after insert.
-- ---------------------------------------------------------------------------

create or replace function public.claims_update_guard()
returns trigger
language plpgsql
as $$
begin
  -- Core columns never change after insert. Column-level grants already block
  -- anon from updating these; the trigger backstops any path around them.
  if new.item_id    is distinct from old.item_id
  or new.claimer_id is distinct from old.claimer_id
  or new.claimed_at is distinct from old.claimed_at
  or new.synced_at  is distinct from old.synced_at
  or new.game_day   is distinct from old.game_day then
    raise exception 'claim core columns are immutable';
  end if;

  -- Confirmations are write-once: once set, confirmer can never change.
  if old.confirmer_id is not null
     and new.confirmer_id is distinct from old.confirmer_id then
    raise exception 'confirmation already recorded';
  end if;

  -- Server stamps the confirmation arrival time; ignore anything the client sent.
  if old.confirmer_id is null and new.confirmer_id is not null then
    new.confirm_synced_at := now();
  else
    new.confirm_synced_at := old.confirm_synced_at;
  end if;

  return new;
end;
$$;

create trigger claims_update_guard
  before update on public.claims
  for each row execute function public.claims_update_guard();

-- ---------------------------------------------------------------------------
-- RLS + grants
-- RLS gives coarse row permission; column-level grants do the fine slicing
-- (RLS cannot restrict columns). anon = the publishable key's role.
-- ---------------------------------------------------------------------------

alter table public.players enable row level security;
alter table public.items   enable row level security;
alter table public.claims  enable row level security;
alter table public.days    enable row level security;

create policy players_select on public.players for select to anon using (true);
create policy players_insert on public.players for insert to anon with check (true);
create policy players_update on public.players for update to anon using (true) with check (true);

create policy items_select on public.items for select to anon using (true);
create policy items_insert on public.items for insert to anon with check (true);
create policy items_update on public.items for update to anon using (true) with check (true);

create policy claims_select on public.claims for select to anon using (true);
create policy claims_insert on public.claims for insert to anon with check (true);
create policy claims_update on public.claims for update to anon using (true) with check (true);

create policy days_select on public.days for select to anon using (true);
create policy days_insert on public.days for insert to anon with check (true);
create policy days_update on public.days for update to anon using (true) with check (true);

-- No DELETE policy on anything → deletes are impossible with the anon key.

revoke all on public.players, public.items, public.claims, public.days from anon;

grant select on public.players, public.items, public.claims, public.days to anon;

grant insert (name, role, team)                    on public.players to anon;
grant update (name, team)                          on public.players to anon;

grant insert (name, emoji, points, claim_rule)     on public.items to anon;
grant update (name, emoji, points, claim_rule, active) on public.items to anon;

-- Insert: client may NOT supply synced_at / confirm fields — server defaults rule.
grant insert (id, item_id, claimer_id, claimed_at, game_day)
  on public.claims to anon;
-- Update: only confirmation + admin columns are writable at all.
grant update (confirmer_id, confirmed_at, status_override, points_adjustment, admin_note)
  on public.claims to anon;

grant insert (game_day, mode, set_by) on public.days to anon;
grant update (mode, set_by)           on public.days to anon;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast inserts/updates on all four tables.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.claims;
alter publication supabase_realtime add table public.days;
