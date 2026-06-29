import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getApiKey(keyName: string): Promise<string | null> {
  const envValue = Deno.env.get(keyName);
  if (envValue) return envValue;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const db = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await db
    .from("api_settings")
    .select("value")
    .eq("key", keyName)
    .maybeSingle();
  if (error || !data) return null;
  return data.value;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "mistral-ocr-latest":   { input: 2.00, output: 6.00 },
  "mistral-small-latest": { input: 0.10, output: 0.30 },
  "pixtral-12b-2409":     { input: 0.15, output: 0.60 },
};

function computeCost(model: string | null, promptTokens: number, completionTokens: number): number {
  const pricing = model ? MODEL_PRICING[model] : null;
  if (!pricing) return 0;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

async function logUsage(params: {
  functionName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  promptPreview: string;
  responsePreview: string;
  durationMs: number;
  status: "success" | "error";
  errorMessage?: string;
}): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const db = createClient(supabaseUrl, serviceKey);
    await db.from("llm_usage_logs").insert({
      function_name: params.functionName,
      model: params.model,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.promptTokens + params.completionTokens,
      prompt_preview: params.promptPreview.slice(0, 1000),
      response_preview: params.responsePreview.slice(0, 1000),
      duration_ms: params.durationMs,
      status: params.status,
      error_message: params.errorMessage?.slice(0, 500),
      cost_usd: computeCost(params.model, params.promptTokens, params.completionTokens),
    });
  } catch (_e) {
    // non-critical
  }
}

interface ResolutionSummary {
  date: string | null;
  type: string | null;
  purpose: string | null;
  keyDecisions: string[];
  authorizedPersons: string[];
  signatories: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const start = Date.now();

  try {
    const body = await req.json();
    const company: string = body.company || "Unknown Company";
    const resolutions: ResolutionSummary[] = Array.isArray(body.resolutions) ? body.resolutions : [];

    if (!resolutions.length) {
      return new Response(
        JSON.stringify({ error: "No resolutions provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = await getApiKey("MISTRAL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Mistral API key not configured in settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Derive date range
    const sortedDates = resolutions.map((r) => r.date).filter(Boolean).sort() as string[];
    const firstDate = sortedDates[0] || "unknown";
    const lastDate = sortedDates[sortedDates.length - 1] || "unknown";

    // Unique authorized persons across all resolutions
    const allAuthorized = [
      ...new Set(resolutions.flatMap((r) => r.authorizedPersons ?? []).filter(Boolean)),
    ];

    // Build chronological history text
    const historyLines = [...resolutions]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .map((r, i) => {
        const desc = r.purpose || r.keyDecisions?.[0] || "No description available";
        return `${i + 1}. [${r.date || "Unknown date"}] ${r.type || "Other"} — ${desc}`;
      })
      .join("\n");

    const authorizedNote = allAuthorized.length > 0
      ? `\nPersons authorized across resolutions: ${allAuthorized.join(", ")}`
      : "";

    const prompt = `You are a senior banking compliance analyst reviewing board resolutions for a corporate client.

Company: ${company}
Total resolutions: ${resolutions.length}
Period: ${firstDate} to ${lastDate}${authorizedNote}

Resolution history (most recent first):
${historyLines}

Write a professional analysis in exactly 3 paragraphs separated by blank lines:

Paragraph 1 — Governance overview: What governance activity has this company undertaken? What does the pattern suggest (routine maintenance, restructuring, regulatory compliance, leadership transition, expansion)?

Paragraph 2 — Key patterns: Types of resolutions used, timing and frequency, any notable changes or rotation in authorized persons or signatories across resolutions.

Paragraph 3 — Banking implications: What should relationship managers or banking operations teams note, verify, or be aware of based on this resolution history?

Rules: 3–4 sentences per paragraph. Be factual and precise. Do not speculate beyond what the data supports. Use professional banking language.`;

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 700,
      }),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      const errText = await response.text();
      await logUsage({ functionName: "analyze-company", model: "mistral-small-latest", promptTokens: 0, completionTokens: 0, promptPreview: prompt, responsePreview: errText, durationMs, status: "error", errorMessage: errText });
      return new Response(
        JSON.stringify({ error: `AI service error: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await response.json();
    const analysis = result.choices?.[0]?.message?.content?.trim() || "No analysis generated.";

    await logUsage({
      functionName: "analyze-company",
      model: "mistral-small-latest",
      promptTokens: result.usage?.prompt_tokens ?? 0,
      completionTokens: result.usage?.completion_tokens ?? 0,
      promptPreview: prompt,
      responsePreview: analysis,
      durationMs,
      status: "success",
    });

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    await logUsage({ functionName: "analyze-company", model: "mistral-small-latest", promptTokens: 0, completionTokens: 0, promptPreview: "", responsePreview: "", durationMs, status: "error", errorMessage: err?.message });
    return new Response(
      JSON.stringify({ error: err?.message || "Analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
