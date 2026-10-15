-- supabase/migrations/20261015000000_accounts.sql
-- Accounts for Provenance. Design: docs/superpowers/specs/2026-10-15-accounts-design.md
-- Row-level security is ON for every table. Policies use (select auth.uid()) so Postgres
-- evaluates it once per statement, not once per row.

-- ── profiles ─────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique
             check (char_length(username) between 3 and 24 and username ~ '^[a-z0-9_]+$'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- There is no insert policy: the trigger below inserts each profile. Only `username` can
-- change; the grants at the end of this file allow that one column.

create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.profiles (user_id, username)
    values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  exception when not_null_violation or check_violation or unique_violation then
    -- A missing, invalid or taken name gets a placeholder, so a sign-up for a NEW address
    -- answers exactly like a sign-up for an existing one and nobody can probe which
    -- addresses have an account. The person chooses a real name after confirming (M2).
    insert into public.profiles (user_id, username)
    values (new.id, 'u_' || left(replace(new.id::text, '-', ''), 22));
  end;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Every new auth user gets a profile row, so no account exists without one. A missing,
-- invalid or taken username gets a placeholder (see handle_new_user), never an error.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.username_available(name text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(
    char_length(username_available.name) between 3 and 24
      and lower(username_available.name) ~ '^[a-z0-9_]+$'
      and not exists (
        select 1 from public.profiles p where p.username = lower(username_available.name)
      ),
    false);
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ── user_state ───────────────────────────────────────────────────────────────
create table public.user_state (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null constraint user_state_key_allowed check (key in (
               'tn.watchlist.v1',
               'tn.map.pins.v1',
               'tn.events.assets.v1',
               'tn.mkalerts.v1',
               'tn.console.v1',
               'tn.console.boards.v1',
               'tn.console.presets.v1',
               'tn.console.activePreset.v1',
               'tn.console.sceneChrome.v1',
               'tn.inspector.v1',
               'tn.variant.v1',
               'tn.scope.v1',
               'tn.events.alerting.v1',
               'tn.notify.rules.v1',
               'tn.notifications.v1',
               'tn.keymap.v1',
               'tn.lang.v1',
               'tn.hud.v1',
               'tn.camslot.prefs.v1'
             )),
  version    int not null check (version >= 1),
  value      jsonb not null check (pg_column_size(value) <= 65536),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

create policy "user_state: own rows" on public.user_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The server sets the time, and an old client cannot overwrite a newer schema version.
create function public.user_state_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.version < old.version then
    raise exception 'version downgrade refused' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_state_guard
  before insert or update on public.user_state
  for each row execute function public.user_state_guard();

-- ── activity_days ────────────────────────────────────────────────────────────
create table public.activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default ((now() at time zone 'utc')::date),
  primary key (user_id, day)
);

alter table public.activity_days enable row level security;

create policy "activity_days: read own" on public.activity_days
  for select to authenticated using (user_id = (select auth.uid()));

-- Today (UTC) only: a client cannot back-date or forge a history.
create policy "activity_days: add today" on public.activity_days
  for insert to authenticated
  with check (user_id = (select auth.uid()) and day = (now() at time zone 'utc')::date);

-- ── Explicit grants ──────────────────────────────────────────────────────────
-- The file first revokes everything from the three API roles, so it gives the same result
-- whether "Automatically expose new tables" is on or off (both projects have it off). Then it
-- grants exactly what each role needs. Row-level security narrows each browser grant to the
-- caller's own rows. anon gets nothing on any table; it can only call username_available().
revoke all on public.profiles, public.user_state, public.activity_days
  from anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;
grant select, insert, update, delete on public.user_state to authenticated;
grant select, insert on public.activity_days to authenticated;
-- service_role (the secret key, server and scripts only) bypasses row-level security but
-- still needs table privileges. It gets READ only: scripts/check-account-rls.mjs reads the
-- tables to check the result of each forbidden write.
-- Deleting a user goes through the Auth admin API, and the foreign-key cascade runs as the
-- table owner, so no delete grant is needed.
grant usage on schema public to service_role;
grant select on public.profiles, public.user_state, public.activity_days to service_role;
