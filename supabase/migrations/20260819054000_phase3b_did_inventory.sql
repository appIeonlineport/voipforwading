alter table public.assigned_numbers
  alter column user_id drop not null;

insert into public.assigned_numbers(
  user_id,
  phone_number,
  provider,
  label,
  enabled
)
values (
  null,
  '+18022165132',
  'signalwire',
  'SignalWire Trial DID',
  true
)
on conflict (phone_number) do nothing;
