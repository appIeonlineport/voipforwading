revoke execute on function public.admin_adjust_minutes(uuid,numeric,text) from public, anon;
grant execute on function public.admin_adjust_minutes(uuid,numeric,text) to authenticated;

revoke execute on function public.admin_update_customer(uuid,text,integer) from public, anon;
grant execute on function public.admin_update_customer(uuid,text,integer) to authenticated;
