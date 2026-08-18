grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant select on public.minute_wallets to authenticated;
grant select on public.minute_transactions to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.assigned_numbers to authenticated;
grant select, insert, update, delete on public.campaign_numbers to authenticated;
grant select, insert, update, delete on public.forwarding_destinations to authenticated;
grant select on public.live_calls to authenticated;
grant select on public.cdr to authenticated;

grant execute on function public.admin_adjust_minutes(uuid,numeric,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.minute_wallets enable row level security;
alter table public.minute_transactions enable row level security;
alter table public.campaigns enable row level security;
alter table public.assigned_numbers enable row level security;
alter table public.campaign_numbers enable row level security;
alter table public.forwarding_destinations enable row level security;
alter table public.live_calls enable row level security;
alter table public.cdr enable row level security;

-- Keep anonymous browser users locked out of application tables.
revoke all on public.profiles from anon;
revoke all on public.minute_wallets from anon;
revoke all on public.minute_transactions from anon;
revoke all on public.campaigns from anon;
revoke all on public.assigned_numbers from anon;
revoke all on public.campaign_numbers from anon;
revoke all on public.forwarding_destinations from anon;
revoke all on public.live_calls from anon;
revoke all on public.cdr from anon;
