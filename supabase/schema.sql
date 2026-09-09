-- Frida invites — run once in the Supabase SQL editor.
-- Project: ccryphtpmhepxtfeggpa
--
-- Model:
--   invites     one row per invited person (name, their user number, their code)
--   app_config  the TestFlight link
--   admins      which auth users may manage the above
--
-- The public site never reads these tables directly. It calls open_invite(),
-- which returns a single person's details only on an exact code match.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables ---

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.app_config (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null check (length(btrim(name)) between 1 and 120),
  ordinal    integer not null check (ordinal > 0),
  code       text    not null unique check (code ~ '^[A-Z0-9]{6,32}$'),
  created_at timestamptz not null default now()
);

create index if not exists invites_created_at_idx on public.invites (created_at desc);

alter table public.admins     enable row level security;
alter table public.app_config enable row level security;
alter table public.invites    enable row level security;

-- ------------------------------------------------------------ privileges ---
-- anon reaches this data only through open_invite() below.

revoke all on public.admins     from anon, authenticated;
revoke all on public.app_config from anon, authenticated;
revoke all on public.invites    from anon, authenticated;

grant select                         on public.admins     to authenticated;
grant select, insert, update         on public.app_config to authenticated;
grant select, insert, update, delete on public.invites    to authenticated;

-- ---------------------------------------------------------------- policies --

-- An admin may read their own membership row; that is what is_admin() checks.
drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
  for select to authenticated
  using ( (select auth.uid()) = user_id );

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

drop policy if exists invites_admin_all on public.invites;
create policy invites_admin_all on public.invites
  for all to authenticated
  using      ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

drop policy if exists config_admin_read on public.app_config;
create policy config_admin_read on public.app_config
  for select to authenticated
  using ( (select public.is_admin()) );

drop policy if exists config_admin_write on public.app_config;
create policy config_admin_write on public.app_config
  for all to authenticated
  using      ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

-- ------------------------------------------------------- public endpoint ---
-- SECURITY DEFINER on purpose: this is the one door anon may open, and it
-- only ever returns the single row whose code was supplied.

drop function if exists public.open_invite(text);
create function public.open_invite(p_code text)
returns table (name text, ordinal integer, url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
begin
  if length(v_code) < 6 then
    return;                        -- too short to be a code; reveal nothing
  end if;

  return query
    select i.name,
           i.ordinal,
           coalesce((select c.value from public.app_config c where c.key = 'testflight_url'), '')
      from public.invites i
     where i.code = v_code;
end;
$$;

revoke all     on function public.open_invite(text) from public;
grant  execute on function public.open_invite(text) to anon, authenticated;

-- ------------------------------------------------------------------ seed ---

insert into public.app_config (key, value) values
  ('testflight_url', 'https://testflight.apple.com/join/kH82MMnp')
on conflict (key) do nothing;

-- ----------------------------------------------------------------- admin ---
-- After creating your user (Authentication → Users → Add user), grant it
-- access by running:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
