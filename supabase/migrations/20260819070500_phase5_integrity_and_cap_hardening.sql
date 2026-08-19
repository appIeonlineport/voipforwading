-- Remove redundant/ambiguous legacy campaign RPCs.
drop function if exists public.customer_manage_campaign(uuid,text,boolean,text,integer,uuid);
drop function if exists public.customer_save_campaign(uuid,text,text,integer,boolean,uuid[],jsonb);

update public.forwarding_destinations
set phone_number = '+' || regexp_replace(phone_number, '[^0-9]', '', 'g')
where phone_number is not null
  and regexp_replace(phone_number, '[^0-9]', '', 'g') <> ''
  and left(phone_number,1) <> '+';

create unique index if not exists forwarding_destinations_campaign_phone_uidx
  on public.forwarding_destinations(campaign_id, phone_number);

create or replace function public.customer_save_campaign(
  p_campaign_id uuid default null,
  p_name text default null,
  p_routing_mode text default 'first_available',
  p_max_concurrent_calls integer default 1,
  p_enabled boolean default true,
  p_number_ids uuid[] default '{}',
  p_destinations jsonb default '[]'::jsonb,
  p_call_cap integer default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user_id uuid := auth.uid(); v_profile public.profiles; v_campaign_id uuid; v_number_id uuid;
  v_item jsonb; v_phone text; v_digits text; v_label text; v_priority integer; v_dest_enabled boolean;
  v_dest_cc integer; v_dest_cap integer; v_dest_id uuid; v_keep_phones text[] := '{}'::text[];
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.profiles where id=v_user_id and role='customer';
  if v_profile.id is null or v_profile.status <> 'active' then raise exception 'Active customer account required'; end if;
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'Campaign name is required'; end if;
  if p_routing_mode not in ('first_available','round_robin') then raise exception 'Simultaneous routing is not enabled yet'; end if;
  if p_max_concurrent_calls is null or p_max_concurrent_calls < 1 then raise exception 'Campaign Max CC must be at least 1'; end if;
  if p_max_concurrent_calls > v_profile.max_concurrent_calls then raise exception 'Campaign Max CC exceeds account limit'; end if;
  if p_call_cap is not null and p_call_cap < 1 then raise exception 'Campaign CAP must be at least 1'; end if;
  if coalesce(array_length(p_number_ids,1),0) < 1 then raise exception 'Select at least one assigned TFN'; end if;
  foreach v_number_id in array p_number_ids loop
    if not exists(select 1 from public.assigned_numbers where id=v_number_id and user_id=v_user_id and enabled=true) then
      raise exception 'One or more TFNs are not assigned to this customer';
    end if;
    if coalesce(p_enabled,true) and exists(
      select 1 from public.campaign_numbers cn join public.campaigns c on c.id=cn.campaign_id
      where cn.number_id=v_number_id and c.user_id=v_user_id and c.enabled=true
        and (p_campaign_id is null or c.id<>p_campaign_id)
    ) then raise exception 'A selected TFN is already attached to another active campaign'; end if;
  end loop;
  if jsonb_typeof(p_destinations) <> 'array' or jsonb_array_length(p_destinations) < 1 then raise exception 'Add at least one forwarding destination'; end if;

  if p_campaign_id is null then
    insert into public.campaigns(user_id,name,enabled,routing_mode,max_concurrent_calls,call_cap,updated_at)
    values(v_user_id,trim(p_name),coalesce(p_enabled,true),p_routing_mode,p_max_concurrent_calls,p_call_cap,now()) returning id into v_campaign_id;
  else
    if exists(select 1 from public.live_calls where campaign_id=p_campaign_id) then raise exception 'Campaign has a live call. Wait for it to finish before editing'; end if;
    update public.campaigns set name=trim(p_name),enabled=coalesce(p_enabled,true),routing_mode=p_routing_mode,
      max_concurrent_calls=p_max_concurrent_calls,call_cap=p_call_cap,updated_at=now()
    where id=p_campaign_id and user_id=v_user_id returning id into v_campaign_id;
    if v_campaign_id is null then raise exception 'Campaign not found'; end if;
  end if;

  delete from public.campaign_numbers where campaign_id=v_campaign_id;
  foreach v_number_id in array p_number_ids loop insert into public.campaign_numbers(campaign_id,number_id) values(v_campaign_id,v_number_id); end loop;

  for v_item in select value from jsonb_array_elements(p_destinations) loop
    v_digits := regexp_replace(coalesce(v_item->>'phone_number',''), '[^0-9]', '', 'g');
    if length(v_digits) < 7 or length(v_digits) > 15 then raise exception 'Invalid forwarding destination number'; end if;
    v_phone := '+' || v_digits; v_keep_phones := array_append(v_keep_phones,v_phone);
    v_label := nullif(trim(coalesce(v_item->>'label','')),'');
    v_priority := greatest(1,coalesce(nullif(v_item->>'priority','')::integer,1));
    v_dest_enabled := coalesce(nullif(v_item->>'enabled','')::boolean,true);
    v_dest_cc := greatest(1,coalesce(nullif(v_item->>'max_concurrent_calls','')::integer,1));
    v_dest_cap := nullif(v_item->>'call_cap','')::integer;
    if v_dest_cap is not null and v_dest_cap < 1 then raise exception 'Destination CAP must be at least 1'; end if;
    if v_dest_cc > p_max_concurrent_calls then raise exception 'Destination CC cannot exceed campaign CC'; end if;
    v_dest_id := null;
    update public.forwarding_destinations set phone_number=v_phone,label=v_label,priority=v_priority,enabled=v_dest_enabled,
      max_concurrent_calls=v_dest_cc,call_cap=v_dest_cap,updated_at=now()
    where campaign_id=v_campaign_id and regexp_replace(phone_number,'[^0-9]','','g')=v_digits returning id into v_dest_id;
    if v_dest_id is null then
      insert into public.forwarding_destinations(campaign_id,phone_number,label,priority,enabled,max_concurrent_calls,call_cap,updated_at)
      values(v_campaign_id,v_phone,v_label,v_priority,v_dest_enabled,v_dest_cc,v_dest_cap,now());
    end if;
  end loop;
  delete from public.forwarding_destinations d where d.campaign_id=v_campaign_id and not (d.phone_number = any(v_keep_phones));
  return v_campaign_id;
end; $$;
revoke all on function public.customer_save_campaign(uuid,text,text,integer,boolean,uuid[],jsonb,integer) from public, anon;
grant execute on function public.customer_save_campaign(uuid,text,text,integer,boolean,uuid[],jsonb,integer) to authenticated;

create or replace function public.customer_delete_campaign(p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.live_calls where campaign_id=p_campaign_id and user_id=auth.uid()) then raise exception 'Campaign has a live call. Wait for it to finish before deleting'; end if;
  delete from public.campaigns where id=p_campaign_id and user_id=auth.uid();
  if not found then raise exception 'Campaign not found'; end if;
  return true;
end; $$;

create or replace function public.admin_manage_did(
  p_id uuid default null,p_phone_number text default null,p_provider text default 'signalwire',p_label text default null,p_user_id uuid default null,p_enabled boolean default true
) returns public.assigned_numbers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.assigned_numbers; v_old public.assigned_numbers; v_digits text; v_phone text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  v_digits:=regexp_replace(coalesce(p_phone_number,''),'[^0-9]','','g');
  if length(v_digits)<7 or length(v_digits)>15 then raise exception 'Valid phone number is required'; end if;
  v_phone:='+'||v_digits;
  if p_user_id is not null and not exists(select 1 from public.profiles where id=p_user_id and role='customer') then raise exception 'Customer not found'; end if;
  if p_id is not null then
    select * into v_old from public.assigned_numbers where id=p_id;
    if v_old.id is null then raise exception 'DID not found'; end if;
    if exists(select 1 from public.campaign_numbers where number_id=p_id)
       and (v_old.user_id is distinct from p_user_id or regexp_replace(v_old.phone_number,'[^0-9]','','g')<>v_digits) then
      raise exception 'DID is attached to a campaign. Detach it before reassigning or changing the number';
    end if;
  end if;
  if p_id is null then
    insert into public.assigned_numbers(user_id,phone_number,provider,label,enabled,updated_at)
    values(p_user_id,v_phone,coalesce(nullif(trim(p_provider),''),'signalwire'),nullif(trim(p_label),''),coalesce(p_enabled,true),now()) returning * into v_row;
  else
    update public.assigned_numbers set user_id=p_user_id,phone_number=v_phone,provider=coalesce(nullif(trim(p_provider),''),'signalwire'),
      label=nullif(trim(p_label),''),enabled=coalesce(p_enabled,true),updated_at=now() where id=p_id returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function public.finalize_call_usage(p_provider_call_id text,p_final_status text,p_ended_at timestamptz default now(),p_provider_payload jsonb default '{}'::jsonb)
returns table(user_id uuid,connected_seconds bigint,remaining_seconds bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_call public.live_calls%rowtype; v_connected bigint:=0; v_balance bigint:=0; v_count_as_completed boolean:=false;
begin
  select * into v_call from public.live_calls where provider_call_id=p_provider_call_id for update;
  if not found then raise exception 'Live call not found'; end if;
  if v_call.answered_at is not null then v_connected:=greatest(0,floor(extract(epoch from (p_ended_at-v_call.answered_at)))::bigint); end if;
  v_count_as_completed:=v_call.answered_at is not null;
  insert into public.minute_wallets(user_id) values(v_call.user_id) on conflict(user_id) do nothing;
  update public.minute_wallets mw set remaining_seconds=greatest(0,mw.remaining_seconds-v_connected),total_used_seconds=mw.total_used_seconds+v_connected,updated_at=now()
    where mw.user_id=v_call.user_id returning mw.remaining_seconds into v_balance;
  insert into public.cdr(provider_call_id,user_id,campaign_id,number_id,destination_id,caller_number,dialed_number,forwarded_to,final_status,started_at,answered_at,ended_at,connected_seconds,billed_seconds,provider_payload)
  values(v_call.provider_call_id,v_call.user_id,v_call.campaign_id,v_call.number_id,v_call.destination_id,v_call.caller_number,v_call.dialed_number,v_call.forwarded_to,p_final_status,v_call.started_at,v_call.answered_at,p_ended_at,v_connected,v_connected,coalesce(p_provider_payload,'{}'::jsonb))
  on conflict(provider_call_id) do update set final_status=excluded.final_status,ended_at=excluded.ended_at,connected_seconds=excluded.connected_seconds,billed_seconds=excluded.billed_seconds,provider_payload=excluded.provider_payload;
  if v_connected>0 then insert into public.minute_transactions(user_id,type,seconds,balance_after_seconds,reference,note)
    values(v_call.user_id,'call_usage',-v_connected,v_balance,'call:'||coalesce(v_call.provider_call_id,''),'Call usage'); end if;
  if v_count_as_completed then
    if v_call.destination_id is not null then update public.forwarding_destinations set completed_calls=completed_calls+1,updated_at=now() where id=v_call.destination_id; end if;
    if v_call.campaign_id is not null then update public.campaigns set completed_calls=completed_calls+1,updated_at=now() where id=v_call.campaign_id; end if;
  end if;
  delete from public.live_calls where id=v_call.id;
  return query select v_call.user_id,v_connected,v_balance;
end; $$;
revoke all on function public.finalize_call_usage(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_call_usage(text,text,timestamptz,jsonb) to service_role;

create or replace function public.reserve_inbound_call(p_provider_call_id text,p_dialed_number text,p_caller_number text,p_provider_payload jsonb default '{}'::jsonb)
returns table(live_call_id uuid,user_id uuid,campaign_id uuid,number_id uuid,destination_id uuid,destination_phone text,destination_label text,campaign_name text,routing_mode text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_number public.assigned_numbers%rowtype; v_profile public.profiles%rowtype; v_wallet public.minute_wallets%rowtype; v_campaign public.campaigns%rowtype; v_destination public.forwarding_destinations%rowtype; v_live_id uuid; v_normalized text:=regexp_replace(coalesce(p_dialed_number,''),'[^0-9]','','g');
begin
  if coalesce(trim(p_provider_call_id),'')='' then raise exception 'Provider CallSid required'; end if;
  select * into v_number from public.assigned_numbers n where n.enabled=true and n.user_id is not null and regexp_replace(n.phone_number,'[^0-9]','','g')=v_normalized limit 1;
  if v_number.id is null then raise exception 'DID not assigned'; end if;
  select * into v_profile from public.profiles p where p.id=v_number.user_id and p.role='customer' and p.status='active';
  if v_profile.id is null then raise exception 'Customer unavailable'; end if;
  select * into v_wallet from public.minute_wallets w where w.user_id=v_profile.id for update;
  if v_wallet.user_id is null or v_wallet.remaining_seconds<=0 then raise exception 'No minutes remaining'; end if;
  select c.* into v_campaign from public.campaigns c join public.campaign_numbers cn on cn.campaign_id=c.id
    where cn.number_id=v_number.id and c.user_id=v_profile.id and c.enabled=true and (c.call_cap is null or c.completed_calls<c.call_cap)
    order by c.updated_at desc,c.created_at asc limit 1 for update of c;
  if v_campaign.id is null then raise exception 'No active campaign'; end if;
  if v_campaign.routing_mode='simultaneous' then raise exception 'Simultaneous routing not enabled'; end if;
  if (select count(*) from public.live_calls l where l.campaign_id=v_campaign.id and l.status in ('ringing','answered'))>=least(v_campaign.max_concurrent_calls,v_profile.max_concurrent_calls) then raise exception 'Campaign CC busy'; end if;
  select d.* into v_destination from public.forwarding_destinations d
    where d.campaign_id=v_campaign.id and d.enabled=true and (d.call_cap is null or d.completed_calls<d.call_cap)
      and (select count(*) from public.live_calls l where l.destination_id=d.id and l.status in ('ringing','answered'))<d.max_concurrent_calls
    order by case when v_campaign.routing_mode='round_robin' then d.completed_calls else 0 end asc,d.priority asc,d.created_at asc
    limit 1 for update skip locked;
  if v_destination.id is null then raise exception 'No destination available'; end if;
  insert into public.live_calls(provider_call_id,user_id,campaign_id,number_id,destination_id,caller_number,dialed_number,forwarded_to,status,provider_payload)
  values(p_provider_call_id,v_profile.id,v_campaign.id,v_number.id,v_destination.id,p_caller_number,p_dialed_number,v_destination.phone_number,'ringing',coalesce(p_provider_payload,'{}'::jsonb))
  on conflict(provider_call_id) do update set last_event_at=now(),provider_payload=excluded.provider_payload returning id into v_live_id;
  return query select v_live_id,v_profile.id,v_campaign.id,v_number.id,v_destination.id,v_destination.phone_number,v_destination.label,v_campaign.name,v_campaign.routing_mode;
end; $$;
revoke all on function public.reserve_inbound_call(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_inbound_call(text,text,text,jsonb) to service_role;

drop policy if exists campaigns_owner_all on public.campaigns;
create policy campaigns_owner_read on public.campaigns for select using (user_id=auth.uid() or public.is_admin());
drop policy if exists campaign_numbers_owner_all on public.campaign_numbers;
create policy campaign_numbers_owner_read on public.campaign_numbers for select using (exists(select 1 from public.campaigns c where c.id=campaign_numbers.campaign_id and (c.user_id=auth.uid() or public.is_admin())));
drop policy if exists destinations_owner_all on public.forwarding_destinations;
create policy destinations_owner_read on public.forwarding_destinations for select using (exists(select 1 from public.campaigns c where c.id=forwarding_destinations.campaign_id and (c.user_id=auth.uid() or public.is_admin())));
