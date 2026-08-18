import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.slice(7);
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,role,status")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !adminProfile || adminProfile.role !== "admin" || adminProfile.status !== "active") {
      return json({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const fullName = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const maxCC = Math.max(0, Math.min(100, Number(body.max_concurrent_calls ?? 2)));
    const initialMinutes = Math.max(0, Number(body.initial_minutes ?? 0));

    if (!fullName) return json({ error: "Full name is required" }, 400);
    if (!email || !email.includes("@")) return json({ error: "Valid email is required" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!Number.isFinite(initialMinutes)) return json({ error: "Invalid initial minutes" }, 400);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) return json({ error: createError?.message || "Could not create user" }, 400);

    const userId = created.user.id;
    const { error: profileUpsertError } = await adminClient.from("profiles").upsert({
      id: userId,
      email,
      full_name: fullName,
      role: "customer",
      status: "active",
      max_concurrent_calls: maxCC,
      updated_at: new Date().toISOString(),
    });

    if (profileUpsertError) {
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: "Profile setup failed: " + profileUpsertError.message }, 500);
    }

    const seconds = Math.round(initialMinutes * 60);
    const { error: walletError } = await adminClient.from("minute_wallets").upsert({
      user_id: userId,
      remaining_seconds: seconds,
      total_added_seconds: seconds,
      total_used_seconds: 0,
      updated_at: new Date().toISOString(),
    });

    if (walletError) return json({ error: "User created but wallet setup failed: " + walletError.message }, 500);

    return json({
      success: true,
      user: {
        id: userId,
        email,
        full_name: fullName,
        role: "customer",
        status: "active",
        max_concurrent_calls: maxCC,
        initial_minutes: initialMinutes,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
