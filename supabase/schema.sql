-- Smart Q database schema for Supabase.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Review it with a developer before using it with real customers.

create extension if not exists pgcrypto;

-- 1. Profiles: one row per signed in user -----------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','shopkeeper')),
  name text,
  contact text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Users may change only name and contact. Role changes happen in functions below.
revoke update on public.profiles from authenticated, anon;
grant update (name, contact) on public.profiles to authenticated;

-- 2. Subscriptions: the 3 day free trial is stored on the server -------------
create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'trial' check (status in ('trial','active','canceled','expired')),
  trial_ends_at timestamptz not null default (now() + interval '3 days'),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions read own" on public.subscriptions;
create policy "subscriptions read own" on public.subscriptions for select to authenticated using (user_id = auth.uid());
-- No insert or update policies: only the server (payment webhook, service role) changes plans.

-- Create the profile and the trial when someone signs up. Role is never read from user input.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, contact)
  values (new.id, split_part(coalesce(new.email, new.phone, ''), '@', 1), coalesce(new.email, new.phone))
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 3. Shops --------------------------------------------------------------------
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  type text not null default 'Shop',
  code text not null unique,
  lat double precision,
  lng double precision,
  avg_service_min int not null default 3 check (avg_service_min between 1 and 60),
  is_open boolean not null default true,
  last_token int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.shops enable row level security;
drop policy if exists "shops read all" on public.shops;
create policy "shops read all" on public.shops for select to authenticated using (true);
drop policy if exists "shops update own" on public.shops;
create policy "shops update own" on public.shops for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke update on public.shops from authenticated, anon;
grant update (name, type, lat, lng, avg_service_min, is_open) on public.shops to authenticated;

-- A signed in user becomes a shopkeeper by creating a shop through this function.
create or replace function public.create_my_shop(p_name text)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s public.shops; c text; tries int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.shops where owner_id = auth.uid()) then
    select * into s from public.shops where owner_id = auth.uid() limit 1; return s;
  end if;
  loop
    c := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=OIl01', ''), 1, 4));
    exit when length(c) = 4 and not exists (select 1 from public.shops where code = c);
    tries := tries + 1; if tries > 50 then raise exception 'could not make a shop code'; end if;
  end loop;
  update public.profiles set role = 'shopkeeper' where id = auth.uid();
  insert into public.shops (owner_id, name, code) values (auth.uid(), trim(p_name), c) returning * into s;
  return s;
end $$;

-- 4. Tickets ------------------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  token_number int not null,
  status text not null default 'waiting' check (status in ('waiting','serving','done','left','skipped')),
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  done_at timestamptz,
  unique (shop_id, token_number)
);
create index if not exists tickets_shop_status on public.tickets (shop_id, status, token_number);
create unique index if not exists one_active_ticket_per_customer on public.tickets (customer_id) where status in ('waiting','serving');
alter table public.tickets enable row level security;
drop policy if exists "tickets customer read own" on public.tickets;
create policy "tickets customer read own" on public.tickets for select to authenticated using (customer_id = auth.uid());
drop policy if exists "tickets shop read own shop" on public.tickets;
create policy "tickets shop read own shop" on public.tickets for select to authenticated
  using (exists (select 1 from public.shops s where s.id = tickets.shop_id and s.owner_id = auth.uid()));
-- No insert or update policies: tickets change only through the functions below.

create or replace function public.join_queue(p_code text)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare s public.shops; t public.tickets;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into s from public.shops where code = upper(trim(p_code)) for update;
  if not found then raise exception 'shop not found'; end if;
  if not s.is_open then raise exception 'queue is paused'; end if;
  if exists (select 1 from public.tickets where customer_id = auth.uid() and status in ('waiting','serving')) then
    raise exception 'you already have an active ticket';
  end if;
  update public.shops set last_token = last_token + 1 where id = s.id returning * into s;
  insert into public.tickets (shop_id, customer_id, token_number) values (s.id, auth.uid(), s.last_token) returning * into t;
  return t;
end $$;

create or replace function public.leave_queue()
returns void language sql security definer set search_path = public as $$
  update public.tickets set status = 'left', done_at = now()
  where customer_id = auth.uid() and status in ('waiting','serving');
$$;

create or replace function public.call_next(p_shop uuid)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare t public.tickets;
begin
  if not exists (select 1 from public.shops where id = p_shop and owner_id = auth.uid()) then raise exception 'not your shop'; end if;
  update public.tickets set status = 'done', done_at = now() where shop_id = p_shop and status = 'serving';
  select * into t from public.tickets where shop_id = p_shop and status = 'waiting' order by token_number limit 1 for update skip locked;
  if found then
    update public.tickets set status = 'serving', called_at = now() where id = t.id returning * into t;
  end if;
  return t;
end $$;

-- 5. Saved shops --------------------------------------------------------------
create table if not exists public.saved_shops (
  user_id uuid not null references public.profiles(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  primary key (user_id, shop_id)
);
alter table public.saved_shops enable row level security;
drop policy if exists "saved own" on public.saved_shops;
create policy "saved own" on public.saved_shops for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 6. Delete my account (used by Security & Privacy > Delete my data) ---------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- 7. Function permissions: only signed in users may call them -----------------
revoke all on function public.create_my_shop(text), public.join_queue(text), public.leave_queue(),
  public.call_next(uuid), public.delete_my_account() from public, anon;
grant execute on function public.create_my_shop(text), public.join_queue(text), public.leave_queue(),
  public.call_next(uuid), public.delete_my_account() to authenticated;

-- 8. Realtime: let shop and customer screens hear about ticket changes --------
do $$ begin
  alter publication supabase_realtime add table public.tickets;
exception when duplicate_object then null; end $$;
