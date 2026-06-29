import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  OPENROUTER_API_KEY: "OpenRouter API key for AI model access",
  REPLICATE_API_TOKEN: "Replicate API token for OCR and image processing",
  NEXT_PUBLIC_SUPABASE_URL: "Supabase project URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "Supabase anonymous key for client-side access",
  SUPABASE_SERVICE_ROLE_KEY: "Supabase service role key for server-side access",
};

async function getServiceRoleKey(): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("api_settings")
    .select("value")
    .eq("key", "SUPABASE_SERVICE_ROLE_KEY")
    .maybeSingle();

  if (error || !data) {
    console.error("Failed to fetch service role key:", error);
    return null;
  }

  return data.value;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method === "POST") {
      const body = await req.json();
      const results = [];

      const serviceRoleKey = await getServiceRoleKey();

      if (!serviceRoleKey) {
        return new Response(
          JSON.stringify({ error: "Database not configured" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      for (const [key, value] of Object.entries(body)) {
        if (value && typeof value === "string" && value.trim()) {
          const description = SETTING_DESCRIPTIONS[key] || "";

          const { error } = await supabaseAdmin.from("api_settings").upsert({
            key,
            value,
            description,
            updated_at: new Date().toISOString(),
          });

          results.push({ key, success: !error });

          if (error) {
            console.error(`Error setting ${key}:`, error);
          }
        }
      }

      if (results.length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid settings provided" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const allSucceeded = results.every((r) => r.success);

      if (!allSucceeded) {
        return new Response(
          JSON.stringify({ error: "Failed to save some settings", results }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ message: "Settings saved successfully", results }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
