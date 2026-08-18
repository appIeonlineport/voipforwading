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
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_minutes is null or p_minutes = 0 then
    raise exception 'Minutes must be non-zero';
  end if;

  v_delta := round(p_minutes * 60)::bigint;

  insert into public.minute_wallets(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.minute_wallets as mw
  set remaining_seconds = greatest(0, mw.remaining_seconds + v_delta),
      total_added_seconds = mw.total_added_seconds + greatest(v_delta, 0),
      updated_at = now()
  where mw.user_id = p_user_id
  returning mw.remaining_seconds into v_balance;

  insert into public.minute_transactions(
    user_id, type, seconds, balance_after_seconds,
    reference, note, created_by
  )
  values (
    p_user_id,
    case when v_delta > 0 then 'admin_credit' else 'admin_debit' end,
    v_delta,
    v_balance,
    'admin_adjustment',
    p_note,
    auth.uid()
  );

  return query
  select v_balance, round(v_balance::numeric / 60, 2);
end;
$$;

grant execute on function public.admin_adjust_minutes(uuid,numeric,text) to authenticated;
