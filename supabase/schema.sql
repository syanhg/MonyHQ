-- Frida invites — run once in the Supabase SQL editor.
-- Project: ccryphtpmhepxtfeggpa
--
-- Model:
--   invites     one row per invited person (name, their user number, their code)
--   app_config  the TestFlight link and the shared letter body
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

create or replace function public.open_invite(p_code text)
returns table (name text, ordinal integer, url text, letter text)
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
           coalesce((select c.value from public.app_config c where c.key = 'testflight_url'), ''),
           coalesce((select c.value from public.app_config c where c.key = 'letter_body'), '')
      from public.invites i
     where i.code = v_code;
end;
$$;

revoke all     on function public.open_invite(text) from public;
grant  execute on function public.open_invite(text) to anon, authenticated;

-- ------------------------------------------------------------------ seed ---

insert into public.app_config (key, value) values
  ('testflight_url', 'https://testflight.apple.com/join/kH82MMnp'),
  ('letter_body', '<p>Hi, I&rsquo;m the founder of Frida.</p>

<p>First of all, thank you so much for being here. This is my first app launch, so I&rsquo;m currently experiencing the very special combination of excitement and nervousness.</p>

<p>I&rsquo;m a huge fan of minimal interfaces and personal agents like Poke and Instinct. Frida definitely takes inspiration from that direction, but we&rsquo;re trying to carve out our own path rather than just making &ldquo;Poke, but with a different font.&rdquo;</p>

<p>There are also areas where, frankly, we&rsquo;re not quite there yet, especially browser capabilities and agentic payments. We know. We see it. The comparison is not exactly flattering.</p>

<p>But here&rsquo;s what I can promise.</p>

<p>Frida will get dramatically better, week by week. Think x5, not 5%. There will be rough edges, weird moments, and probably a few things that make you wonder what I was thinking.</p>

<p>So if you don&rsquo;t love it at first, please give us a few chances before you delete it.</p>

<p>We&rsquo;ll keep building until you fall in love.</p>

<p>And if you still delete it after that&hellip; ouch.</p>

<p>Genuinely, thank you for being one of my first users.</p>

<div class="signoff">
<p class="signoff-name">Alex Yang</p>
<p class="signoff-title">Founder, MonyCompany Inc</p>
</div>

<hr>

<p>Your invitation is below. It opens in the TestFlight app.</p>

<p><a class="tf-button" href="{{url}}" target="_blank" rel="noopener"><img src="/assets/testflight.png" alt=""><span>Open TestFlight</span></a></p>

<p><small>If the button does nothing, copy this link into Safari on your iPhone:<br><code>{{url}}</code></small></p>')
on conflict (key) do nothing;

-- ----------------------------------------------------------------- admin ---
-- After creating your user (Authentication → Users → Add user), grant it
-- access by running:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
