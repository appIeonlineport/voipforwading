import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOOTSTRAP_ADMIN_EMAIL = "rockysalespvt@gmail.com";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) return json({ error: "Server configuration missing" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.slice(7);
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const callerEmail = String(authData.user.email || "").trim().toLowerCase();
    const { data: adminProfile } = await adminClient
      .from("profiles")
      .select("id,role,status")
      .eq("id", authData.user.id)
      .maybeSingle();

    const isAdmin = (adminProfile?.role === "admin" && adminProfile?.status === "active") || callerEmail === BOOTSTRAP_ADMIN_EMAIL;
    if (!isAdmin) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id || "").trim();
    const password = String(body.password || "");

    if (!userId) return json({ error: "Customer is required" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (password.length > 128) return json({ error: "Password is too long" }, 400);

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id,email,role")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) return json({ error: "Customer lookup failed" }, 500);
    if (!targetProfile || targetProfile.role !== "customer") return json({ error: "Customer account not found" }, 404);

    const { data: updated, error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password });
    if (updateError || !updated.user) return json({ error: updateError?.message || "Password update failed" }, 400);

    return json({ success: true, user_id: userId, email: targetProfile.email || updated.user.email || null });
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
