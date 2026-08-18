create or replace function public.admin_update_customer(
  p_user_id uuid,
  p_status text default null,
  p_max_concurrent_calls integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_status is not null and p_status not in ('active','blocked','suspended') then
    raise exception 'Invalid account status';
  end if;

  if p_max_concurrent_calls is not null and p_max_concurrent_calls < 0 then
    raise exception 'Max CC cannot be negative';
  end if;

  update public.profiles
  set status = coalesce(p_status, status),
      max_concurrent_calls = coalesce(p_max_concurrent_calls, max_concurrent_calls),
      updated_at = now()
  where id = p_user_id and role = 'customer'
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Customer not found';
  end if;

  return v_profile;
end;
$$;

grant execute on function public.admin_update_customer(uuid,text,integer) to authenticated;
