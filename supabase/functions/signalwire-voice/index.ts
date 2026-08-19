import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('SIGNALWIRE_WEBHOOK_SECRET') || '';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function xmlEscape(value: string) {
  return value.replace(/[<>&'\"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','\"':'&quot;'}[c] || c));
}
function xml(body: string, status = 200) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}
async function payload(req: Request) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await req.json().catch(() => ({}));
  const fd = await req.formData().catch(() => null);
  if (!fd) return {};
  const out: Record<string,string> = {};
  for (const [k,v] of fd.entries()) out[k] = String(v);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  if (!WEBHOOK_SECRET) return new Response('Webhook secret not configured', { status: 503 });
  if (url.searchParams.get('token') !== WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });

  const data: any = req.method === 'GET' ? Object.fromEntries(url.searchParams.entries()) : await payload(req);
  const event = url.searchParams.get('event') || 'inbound';

  try {
    if (event === 'status') {
      const parentCallSid = url.searchParams.get('parent') || data.ParentCallSid || data.CallSid;
      const callStatus = String(data.CallStatus || data.DialCallStatus || '').toLowerCase();
      if (!parentCallSid) return new Response('Missing CallSid', { status: 400 });

      if (callStatus === 'answered' || callStatus === 'in-progress' || callStatus === 'in_progress') {
        const { error } = await supabase.rpc('update_signalwire_call_state', {
          p_provider_call_id: parentCallSid,
          p_status: 'answered',
          p_provider_payload: data,
        });
        if (error) throw error;
      } else if (['completed','busy','failed','no-answer','canceled'].includes(callStatus)) {
        const { error } = await supabase.rpc('finalize_call_usage', {
          p_provider_call_id: parentCallSid,
          p_final_status: callStatus,
          p_provider_payload: data,
        });
        if (error && !String(error.message || '').includes('Live call not found')) throw error;
      }
      return new Response('OK', { status: 200 });
    }

    const callSid = String(data.CallSid || data.call_sid || '');
    const to = String(data.To || data.to || '');
    const from = String(data.From || data.from || '');
    if (!callSid || !to) return xml('<Say>Unable to route this call.</Say><Hangup/>');

    const { data: rows, error } = await supabase.rpc('reserve_inbound_call', {
      p_provider_call_id: callSid,
      p_dialed_number: to,
      p_caller_number: from,
      p_provider_payload: data,
    });
    if (error) {
      console.log('route_rejected', error.message, { callSid, to, from });
      const reason = String(error.message || '');
      const message = reason.includes('No minutes') ? 'This account is temporarily unavailable.' : 'All agents are busy. Please try again later.';
      return xml(`<Say>${xmlEscape(message)}</Say><Hangup/>`);
    }
    const route = Array.isArray(rows) ? rows[0] : rows;
    if (!route?.destination_phone) return xml('<Say>No forwarding destination is available.</Say><Hangup/>');

    const callback = `${SUPABASE_URL}/functions/v1/signalwire-voice?event=status&parent=${encodeURIComponent(callSid)}&token=${encodeURIComponent(WEBHOOK_SECRET)}`;
    const destination = xmlEscape(String(route.destination_phone));
    const callbackXml = xmlEscape(callback);
    console.log('route_reserved', { callSid, campaign: route.campaign_name, destination: route.destination_label || destination });
    return xml(`<Dial timeout="45"><Number statusCallback="${callbackXml}" statusCallbackMethod="POST" statusCallbackEvent="answered completed">${destination}</Number></Dial>`);
  } catch (error) {
    console.error('signalwire_voice_error', error);
    return xml('<Say>We are unable to complete your call right now.</Say><Hangup/>', 200);
  }
});
