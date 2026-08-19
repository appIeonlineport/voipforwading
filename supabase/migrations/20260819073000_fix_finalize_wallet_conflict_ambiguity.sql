create or replace function public.finalize_call_usage(
  p_provider_call_id text,
  p_final_status text,
  p_ended_at timestamptz default now(),
  p_provider_payload jsonb default '{}'::jsonb
)
returns table(user_id uuid, connected_seconds bigint, remaining_seconds bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_call public.live_calls%rowtype;
  v_connected bigint:=0;
  v_payload_duration bigint:=0;
  v_balance bigint:=0;
  v_count_as_completed boolean:=false;
  v_answered_at timestamptz;
  v_duration_text text;
begin
  select * into v_call from public.live_calls where provider_call_id=p_provider_call_id for update;
  if not found then raise exception 'Live call not found'; end if;
  v_duration_text:=coalesce(p_provider_payload->>'DialCallDuration',p_provider_payload->>'CallDuration','');
  if v_duration_text ~ '^[0-9]+$' then v_payload_duration:=greatest(0,v_duration_text::bigint); end if;
  if v_payload_duration>0 then v_connected:=v_payload_duration;
  elsif v_call.answered_at is not null then v_connected:=greatest(0,floor(extract(epoch from (p_ended_at-v_call.answered_at)))::bigint); end if;
  v_count_as_completed:=v_connected>0 or v_call.answered_at is not null;
  v_answered_at:=v_call.answered_at;
  if v_answered_at is null and v_connected>0 then v_answered_at:=p_ended_at-make_interval(secs=>v_connected::double precision); end if;

  insert into public.minute_wallets(user_id) values(v_call.user_id)
  on conflict on constraint minute_wallets_pkey do nothing;

  update public.minute_wallets mw
  set remaining_seconds=greatest(0,mw.remaining_seconds-v_connected),total_used_seconds=mw.total_used_seconds+v_connected,updated_at=now()
  where mw.user_id=v_call.user_id returning mw.remaining_seconds into v_balance;

  insert into public.cdr(provider_call_id,user_id,campaign_id,number_id,destination_id,caller_number,dialed_number,forwarded_to,final_status,started_at,answered_at,ended_at,connected_seconds,billed_seconds,provider_payload)
  values(v_call.provider_call_id,v_call.user_id,v_call.campaign_id,v_call.number_id,v_call.destination_id,v_call.caller_number,v_call.dialed_number,v_call.forwarded_to,p_final_status,v_call.started_at,v_answered_at,p_ended_at,v_connected,v_connected,coalesce(p_provider_payload,'{}'::jsonb))
  on conflict(provider_call_id) do update set final_status=excluded.final_status,answered_at=coalesce(public.cdr.answered_at,excluded.answered_at),ended_at=excluded.ended_at,connected_seconds=excluded.connected_seconds,billed_seconds=excluded.billed_seconds,provider_payload=excluded.provider_payload;

  if v_connected>0 then
    insert into public.minute_transactions(user_id,type,seconds,balance_after_seconds,reference,note)
    values(v_call.user_id,'call_usage',-v_connected,v_balance,'call:'||coalesce(v_call.provider_call_id,''),'Call usage');
  end if;
  if v_count_as_completed then
    if v_call.destination_id is not null then update public.forwarding_destinations set completed_calls=completed_calls+1,updated_at=now() where id=v_call.destination_id; end if;
    if v_call.campaign_id is not null then update public.campaigns set completed_calls=completed_calls+1,updated_at=now() where id=v_call.campaign_id; end if;
  end if;
  delete from public.live_calls where id=v_call.id;
  return query select v_call.user_id,v_connected,v_balance;
end; $$;
revoke all on function public.finalize_call_usage(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_call_usage(text,text,timestamptz,jsonb) to service_role;
