-- Frontend writes must go through vetted SECURITY DEFINER RPCs.
revoke insert, update, delete, truncate, references, trigger on table public.profiles from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.minute_wallets from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.minute_transactions from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.campaigns from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.assigned_numbers from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.campaign_numbers from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.forwarding_destinations from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.live_calls from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.cdr from authenticated;

grant select on table public.profiles, public.minute_wallets, public.minute_transactions,
  public.campaigns, public.assigned_numbers, public.campaign_numbers,
  public.forwarding_destinations, public.live_calls, public.cdr to authenticated;

grant select, insert, update, delete on table public.profiles, public.minute_wallets,
  public.minute_transactions, public.campaigns, public.assigned_numbers,
  public.campaign_numbers, public.forwarding_destinations, public.live_calls, public.cdr to service_role;
