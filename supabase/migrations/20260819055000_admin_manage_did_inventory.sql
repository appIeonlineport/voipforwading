create or replace function public.admin_manage_did(
  p_id uuid default null,
  p_phone_number text default null,
  p_provider text default 'signalwire',
  p_label text default null,
  p_user_id uuid default null,
  p_enabled boolean default true
)
returns public.assigned_numbers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.assigned_numbers;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_phone_number is null or length(trim(p_phone_number)) < 7 then
    raise exception 'Valid phone number is required';
  end if;

  if p_user_id is not null and not exists (
    select 1 from public.profiles
    where id = p_user_id and role = 'customer'
  ) then
    raise exception 'Customer not found';
  end if;

  if p_id is null then
    insert into public.assigned_numbers(user_id, phone_number, provider, label, enabled, updated_at)
    values(p_user_id, trim(p_phone_number), coalesce(nullif(trim(p_provider),''),'signalwire'), nullif(trim(p_label),''), coalesce(p_enabled,true), now())
    returning * into v_row;
  else
    update public.assigned_numbers
    set user_id = p_user_id,
        phone_number = trim(p_phone_number),
        provider = coalesce(nullif(trim(p_provider),''),'signalwire'),
        label = nullif(trim(p_label),''),
        enabled = coalesce(p_enabled,true),
        updated_at = now()
    where id = p_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'DID not found';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_delete_did(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if exists (select 1 from public.campaign_numbers where number_id = p_id) then
    raise exception 'DID is attached to a campaign';
  end if;

  delete from public.assigned_numbers where id = p_id;
  return found;
end;
$$;

revoke all on function public.admin_manage_did(uuid,text,text,text,uuid,boolean) from public, anon;
revoke all on function public.admin_delete_did(uuid) from public, anon;
grant execute on function public.admin_manage_did(uuid,text,text,text,uuid,boolean) to authenticated;
grant execute on function public.admin_delete_did(uuid) to authenticated;
