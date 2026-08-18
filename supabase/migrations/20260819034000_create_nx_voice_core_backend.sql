create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'customer' check (role in ('admin','customer')),
  status text not null default 'active' check (status in ('active','blocked','suspended')),
  max_concurrent_calls integer not null default 2 check (max_concurrent_calls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.minute_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  remaining_seconds bigint not null default 0 check (remaining_seconds >= 0),
  total_added_seconds bigint not null default 0 check (total_added_seconds >= 0),
  total_used_seconds bigint not null default 0 check (total_used_seconds >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.minute_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('admin_credit','admin_debit','call_usage','refund','adjustment')),
  seconds bigint not null,
  balance_after_seconds bigint not null check (balance_after_seconds >= 0),
  reference text,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  routing_mode text not null default 'first_available' check (routing_mode in ('first_available','round_robin','simultaneous')),
  max_concurrent_calls integer not null default 2 check (max_concurrent_calls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assigned_numbers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_number text not null unique,
  provider text not null default 'signalwire',
  provider_number_id text,
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_numbers (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  number_id uuid not null references public.assigned_numbers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, number_id)
);

create table if not exists public.forwarding_destinations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  phone_number text not null,
  label text,
  priority integer not null default 1 check (priority > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_calls (
  id uuid primary key default gen_random_uuid(),
  provider_call_id text unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  number_id uuid references public.assigned_numbers(id) on delete set null,
  destination_id uuid references public.forwarding_destinations(id) on delete set null,
  caller_number text,
  dialed_number text,
  forwarded_to text,
  status text not null default 'ringing' check (status in ('queued','ringing','answered','completed','busy','failed','no_answer','cancelled')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  last_event_at timestamptz not null default now(),
  provider_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.cdr (
  id uuid primary key default gen_random_uuid(),
  provider_call_id text unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  number_id uuid references public.assigned_numbers(id) on delete set null,
  destination_id uuid references public.forwarding_destinations(id) on delete set null,
  caller_number text,
  dialed_number text,
  forwarded_to text,
  final_status text not null,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  connected_seconds bigint not null default 0 check (connected_seconds >= 0),
  billed_seconds bigint not null default 0 check (billed_seconds >= 0),
  created_at timestamptz not null default now(),
  provider_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_campaigns_user on public.campaigns(user_id);
create index if not exists idx_assigned_numbers_user on public.assigned_numbers(user_id);
create index if not exists idx_forwarding_destinations_campaign on public.forwarding_destinations(campaign_id);
create index if not exists idx_live_calls_user_status on public.live_calls(user_id,status);
create index if not exists idx_cdr_user_created on public.cdr(user_id,created_at desc);
create index if not exists idx_minute_transactions_user_created on public.minute_transactions(user_id,created_at desc);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id,email,full_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  insert into public.minute_wallets(user_id)
  values(new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.admin_adjust_minutes(
  p_user_id uuid,
  p_minutes numeric,
  p_note text default null
)
returns table(remaining_seconds bigint, remaining_minutes numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delta bigint;
  v_balance bigint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_minutes is null or p_minutes = 0 then raise exception 'Minutes must be non-zero'; end if;
  v_delta := round(p_minutes * 60)::bigint;

  insert into public.minute_wallets(user_id) values(p_user_id)
  on conflict (user_id) do nothing;

  update public.minute_wallets
  set remaining_seconds = greatest(0, remaining_seconds + v_delta),
      total_added_seconds = total_added_seconds + greatest(v_delta,0),
      updated_at = now()
  where user_id = p_user_id
  returning minute_wallets.remaining_seconds into v_balance;

  insert into public.minute_transactions(user_id,type,seconds,balance_after_seconds,reference,note,created_by)
  values(p_user_id,case when v_delta > 0 then 'admin_credit' else 'admin_debit' end,v_delta,v_balance,'admin_adjustment',p_note,auth.uid());

  return query select v_balance, round(v_balance::numeric / 60, 2);
end;
$$;

create or replace function public.finalize_call_usage(
  p_provider_call_id text,
  p_final_status text,
  p_ended_at timestamptz default now(),
  p_provider_payload jsonb default '{}'::jsonb
)
returns table(user_id uuid, connected_seconds bigint, remaining_seconds bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_call public.live_calls%rowtype;
  v_connected bigint := 0;
  v_balance bigint := 0;
begin
  select * into v_call from public.live_calls where provider_call_id = p_provider_call_id for update;
  if not found then raise exception 'Live call not found'; end if;

  if v_call.answered_at is not null then
    v_connected := greatest(0, floor(extract(epoch from (p_ended_at - v_call.answered_at)))::bigint);
  end if;

  insert into public.minute_wallets(user_id) values(v_call.user_id)
  on conflict (user_id) do nothing;

  update public.minute_wallets
  set remaining_seconds = greatest(0, remaining_seconds - v_connected),
      total_used_seconds = total_used_seconds + v_connected,
      updated_at = now()
  where minute_wallets.user_id = v_call.user_id
  returning minute_wallets.remaining_seconds into v_balance;

  insert into public.cdr(provider_call_id,user_id,campaign_id,number_id,destination_id,caller_number,dialed_number,forwarded_to,final_status,started_at,answered_at,ended_at,connected_seconds,billed_seconds,provider_payload)
  values(v_call.provider_call_id,v_call.user_id,v_call.campaign_id,v_call.number_id,v_call.destination_id,v_call.caller_number,v_call.dialed_number,v_call.forwarded_to,p_final_status,v_call.started_at,v_call.answered_at,p_ended_at,v_connected,v_connected,coalesce(p_provider_payload,'{}'::jsonb))
  on conflict (provider_call_id) do update set
    final_status = excluded.final_status,
    ended_at = excluded.ended_at,
    connected_seconds = excluded.connected_seconds,
    billed_seconds = excluded.billed_seconds,
    provider_payload = excluded.provider_payload;

  if v_connected > 0 then
    insert into public.minute_transactions(user_id,type,seconds,balance_after_seconds,reference,note)
    values(v_call.user_id,'call_usage',-v_connected,v_balance,'call:'||coalesce(v_call.provider_call_id,''),'Call usage');
  end if;

  delete from public.live_calls where id = v_call.id;
  return query select v_call.user_id, v_connected, v_balance;
end;
$$;

alter table public.profiles enable row level security;
alter table public.minute_wallets enable row level security;
alter table public.minute_transactions enable row level security;
alter table public.campaigns enable row level security;
alter table public.assigned_numbers enable row level security;
alter table public.campaign_numbers enable row level security;
alter table public.forwarding_destinations enable row level security;
alter table public.live_calls enable row level security;
alter table public.cdr enable row level security;

create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy wallets_self_read on public.minute_wallets for select using (user_id = auth.uid() or public.is_admin());
create policy minute_tx_self_read on public.minute_transactions for select using (user_id = auth.uid() or public.is_admin());
create policy campaigns_owner_all on public.campaigns for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy numbers_owner_read on public.assigned_numbers for select using (user_id = auth.uid() or public.is_admin());
create policy numbers_admin_write on public.assigned_numbers for all using (public.is_admin()) with check (public.is_admin());
create policy campaign_numbers_owner_all on public.campaign_numbers for all using (
  exists(select 1 from public.campaigns c where c.id = campaign_id and (c.user_id = auth.uid() or public.is_admin()))
) with check (
  exists(select 1 from public.campaigns c where c.id = campaign_id and (c.user_id = auth.uid() or public.is_admin()))
);
create policy destinations_owner_all on public.forwarding_destinations for all using (
  exists(select 1 from public.campaigns c where c.id = campaign_id and (c.user_id = auth.uid() or public.is_admin()))
) with check (
  exists(select 1 from public.campaigns c where c.id = campaign_id and (c.user_id = auth.uid() or public.is_admin()))
);
create policy live_calls_owner_read on public.live_calls for select using (user_id = auth.uid() or public.is_admin());
create policy cdr_owner_read on public.cdr for select using (user_id = auth.uid() or public.is_admin());

grant execute on function public.admin_adjust_minutes(uuid,numeric,text) to authenticated;
revoke execute on function public.finalize_call_usage(text,text,timestamptz,jsonb) from anon, authenticated;
grant execute on function public.finalize_call_usage(text,text,timestamptz,jsonb) to service_role;
