create or replace function public.customer_manage_campaign(
  p_campaign_id uuid default null,
  p_name text default null,
  p_enabled boolean default true,
  p_routing_mode text default 'first_available',
  p_max_concurrent_calls integer default 1,
  p_number_id uuid default null
)
returns public.campaigns
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_campaign public.campaigns;
  v_number public.assigned_numbers;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null or v_profile.role <> 'customer' or v_profile.status <> 'active' then raise exception 'Active customer account required'; end if;
  if nullif(trim(coalesce(p_name,'')), '') is null then raise exception 'Campaign name is required'; end if;
  if p_routing_mode not in ('first_available','round_robin','simultaneous') then raise exception 'Invalid routing mode'; end if;
  if p_max_concurrent_calls < 1 then raise exception 'Campaign Max CC must be at least 1'; end if;
  if p_max_concurrent_calls > v_profile.max_concurrent_calls then raise exception 'Campaign Max CC exceeds account limit (%)', v_profile.max_concurrent_calls; end if;
  if p_number_id is null then raise exception 'Assigned DID / TFN is required'; end if;
  select * into v_number from public.assigned_numbers where id=p_number_id and user_id=v_uid and enabled=true;
  if v_number.id is null then raise exception 'DID / TFN is not assigned to this customer or is disabled'; end if;
  if p_campaign_id is null then
    insert into public.campaigns(user_id,name,enabled,routing_mode,max_concurrent_calls)
    values(v_uid,trim(p_name),coalesce(p_enabled,true),p_routing_mode,p_max_concurrent_calls)
    returning * into v_campaign;
  else
    update public.campaigns set name=trim(p_name),enabled=coalesce(p_enabled,enabled),routing_mode=p_routing_mode,max_concurrent_calls=p_max_concurrent_calls,updated_at=now()
    where id=p_campaign_id and user_id=v_uid returning * into v_campaign;
    if v_campaign.id is null then raise exception 'Campaign not found'; end if;
    delete from public.campaign_numbers where campaign_id=v_campaign.id;
  end if;
  insert into public.campaign_numbers(campaign_id,number_id) values(v_campaign.id,v_number.id) on conflict do nothing;
  return v_campaign;
end;
$$;

create or replace function public.customer_delete_campaign(p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.campaigns where id=p_campaign_id and user_id=auth.uid();
  if not found then raise exception 'Campaign not found'; end if;
  return true;
end;
$$;

create or replace function public.customer_manage_destination(
  p_destination_id uuid default null,
  p_campaign_id uuid default null,
  p_phone_number text default null,
  p_label text default null,
  p_priority integer default 1,
  p_enabled boolean default true
)
returns public.forwarding_destinations language plpgsql security definer set search_path=public,pg_temp as $$
declare v_dest public.forwarding_destinations;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(coalesce(p_phone_number,'')), '') is null then raise exception 'Destination number is required'; end if;
  if p_priority < 1 then raise exception 'Priority must be at least 1'; end if;
  if not exists(select 1 from public.campaigns where id=p_campaign_id and user_id=auth.uid()) then raise exception 'Campaign not found'; end if;
  if p_destination_id is null then
    insert into public.forwarding_destinations(campaign_id,phone_number,label,priority,enabled)
    values(p_campaign_id,trim(p_phone_number),nullif(trim(coalesce(p_label,'')),''),p_priority,coalesce(p_enabled,true)) returning * into v_dest;
  else
    update public.forwarding_destinations d set phone_number=trim(p_phone_number),label=nullif(trim(coalesce(p_label,'')),''),priority=p_priority,enabled=coalesce(p_enabled,d.enabled),updated_at=now()
    where d.id=p_destination_id and d.campaign_id=p_campaign_id and exists(select 1 from public.campaigns c where c.id=d.campaign_id and c.user_id=auth.uid()) returning * into v_dest;
    if v_dest.id is null then raise exception 'Destination not found'; end if;
  end if;
  return v_dest;
end;
$$;

create or replace function public.customer_delete_destination(p_destination_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.forwarding_destinations d using public.campaigns c where d.id=p_destination_id and d.campaign_id=c.id and c.user_id=auth.uid();
  if not found then raise exception 'Destination not found'; end if;
  return true;
end;
$$;

revoke all on function public.customer_manage_campaign(uuid,text,boolean,text,integer,uuid) from public,anon;
revoke all on function public.customer_delete_campaign(uuid) from public,anon;
revoke all on function public.customer_manage_destination(uuid,uuid,text,text,integer,boolean) from public,anon;
revoke all on function public.customer_delete_destination(uuid) from public,anon;
grant execute on function public.customer_manage_campaign(uuid,text,boolean,text,integer,uuid) to authenticated;
grant execute on function public.customer_delete_campaign(uuid) to authenticated;
grant execute on function public.customer_manage_destination(uuid,uuid,text,text,integer,boolean) to authenticated;
grant execute on function public.customer_delete_destination(uuid) to authenticated;
