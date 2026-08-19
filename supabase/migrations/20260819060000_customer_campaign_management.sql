create or replace function public.customer_save_campaign(
  p_campaign_id uuid default null,
  p_name text default null,
  p_routing_mode text default 'first_available',
  p_max_concurrent_calls integer default 1,
  p_enabled boolean default true,
  p_number_ids uuid[] default '{}',
  p_destinations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_campaign_id uuid;
  v_number_id uuid;
  v_item jsonb;
  v_phone text;
  v_label text;
  v_priority integer;
  v_dest_enabled boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_profile from public.profiles where id = v_user_id and role = 'customer';
  if v_profile.id is null or v_profile.status <> 'active' then raise exception 'Active customer account required'; end if;
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'Campaign name is required'; end if;
  if p_routing_mode not in ('first_available','round_robin','simultaneous') then raise exception 'Invalid routing mode'; end if;
  if p_max_concurrent_calls is null or p_max_concurrent_calls < 1 then raise exception 'Max CC must be at least 1'; end if;
  if p_max_concurrent_calls > v_profile.max_concurrent_calls then raise exception 'Campaign Max CC exceeds account limit'; end if;
  if coalesce(array_length(p_number_ids,1),0) < 1 then raise exception 'Select at least one assigned TFN'; end if;

  foreach v_number_id in array p_number_ids loop
    if not exists (select 1 from public.assigned_numbers where id=v_number_id and user_id=v_user_id and enabled=true) then
      raise exception 'One or more TFNs are not assigned to this customer';
    end if;
  end loop;

  if jsonb_typeof(p_destinations) <> 'array' or jsonb_array_length(p_destinations) < 1 then
    raise exception 'Add at least one forwarding destination';
  end if;

  if p_campaign_id is null then
    insert into public.campaigns(user_id,name,enabled,routing_mode,max_concurrent_calls,updated_at)
    values(v_user_id,trim(p_name),coalesce(p_enabled,true),p_routing_mode,p_max_concurrent_calls,now())
    returning id into v_campaign_id;
  else
    update public.campaigns set name=trim(p_name),enabled=coalesce(p_enabled,true),routing_mode=p_routing_mode,
      max_concurrent_calls=p_max_concurrent_calls,updated_at=now()
    where id=p_campaign_id and user_id=v_user_id returning id into v_campaign_id;
    if v_campaign_id is null then raise exception 'Campaign not found'; end if;
    delete from public.campaign_numbers where campaign_id=v_campaign_id;
    delete from public.forwarding_destinations where campaign_id=v_campaign_id;
  end if;

  foreach v_number_id in array p_number_ids loop
    insert into public.campaign_numbers(campaign_id,number_id) values(v_campaign_id,v_number_id);
  end loop;

  for v_item in select value from jsonb_array_elements(p_destinations) loop
    v_phone := trim(coalesce(v_item->>'phone_number',''));
    if length(v_phone) < 7 then raise exception 'Invalid forwarding destination number'; end if;
    v_label := nullif(trim(coalesce(v_item->>'label','')),'');
    v_priority := greatest(1,coalesce((v_item->>'priority')::integer,1));
    v_dest_enabled := coalesce((v_item->>'enabled')::boolean,true);
    insert into public.forwarding_destinations(campaign_id,phone_number,label,priority,enabled,updated_at)
    values(v_campaign_id,v_phone,v_label,v_priority,v_dest_enabled,now());
  end loop;

  return v_campaign_id;
end;
$$;

create or replace function public.customer_delete_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  delete from public.campaigns where id=p_campaign_id and user_id=v_user_id;
  return found;
end;
$$;

revoke all on function public.customer_save_campaign(uuid,text,text,integer,boolean,uuid[],jsonb) from public, anon;
revoke all on function public.customer_delete_campaign(uuid) from public, anon;
grant execute on function public.customer_save_campaign(uuid,text,text,integer,boolean,uuid[],jsonb) to authenticated;
grant execute on function public.customer_delete_campaign(uuid) to authenticated;
