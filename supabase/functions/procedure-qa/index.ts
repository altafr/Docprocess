import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getApiKey(keyName: string): Promise<string | null> {
  const envValue = Deno.env.get(keyName);
  if (envValue) return envValue;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data } = await supabase.from("api_settings").select("value").eq("key", keyName).maybeSingle();
  return data?.value ?? null;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "mistral-small-latest": { input: 0.10, output: 0.30 },
};

function computeCost(model: string | null, p: number, c: number): number {
  const pricing = model ? MODEL_PRICING[model] : null;
  return pricing ? (p * pricing.input + c * pricing.output) / 1_000_000 : 0;
}

async function logUsage(params: {
  model: string | null; promptTokens: number; completionTokens: number;
  promptPreview: string; responsePreview: string; durationMs: number;
  status: "success" | "error"; errorMessage?: string;
}): Promise<void> {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await db.from("llm_usage_logs").insert({
      function_name: "procedure-qa",
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
  } catch { /* non-blocking */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json();

    // Support both single-question (legacy) and multi-turn messages format
    const market:   string = body.market   ?? "";
    const journey:  string = body.journey  ?? "";
    const messages: { role: "user" | "assistant"; content: string }[] =
      body.messages ?? [{ role: "user", content: body.question ?? "" }];

    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (!lastUser.trim()) {
      return new Response(JSON.stringify({ error: "Question is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [apiKey, model] = await Promise.all([
      getApiKey("OPENROUTER_API_KEY"),
      getApiKey("LLM_MODEL"),
    ]);

    if (!apiKey || !model) {
      const msg = !apiKey ? "OpenRouter API key not configured" : "LLM model not configured";
      await logUsage({ model: null, promptTokens: 0, completionTokens: 0, promptPreview: lastUser, responsePreview: "", durationMs: 0, status: "error", errorMessage: msg });
      return new Response(JSON.stringify({ error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const systemContent = [
      "You are a banking procedures expert assistant for HSBC Commercial Banking.",
      "Provide precise, authoritative answers about banking procedures, policies, and regulatory requirements.",
      market  ? `Market: ${market}`  : "",
      journey ? `Journey: ${journey}` : "",
      "Format responses in clear markdown with headings and bullet points where appropriate.",
      "Be concise but thorough. If you don't have specific information, say so clearly.",
    ].filter(Boolean).join("\n");

    const chatMessages = [
      { role: "system", content: systemContent },
      ...messages,
    ];

    const startTime   = Date.now();
    const promptTokens = Math.ceil(JSON.stringify(chatMessages).length / 4);

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://banking-assistant.com",
        "X-Title": "Banking AI Assistant",
      },
      body: JSON.stringify({ model, messages: chatMessages, stream: true }),
    });

    if (!upstream.ok) {
      let errorMessage = `HTTP ${upstream.status}`;
      try { errorMessage = (await upstream.json()).error?.message ?? errorMessage; } catch { /* */ }
      await logUsage({ model, promptTokens, completionTokens: 0, promptPreview: lastUser, responsePreview: "", durationMs: Date.now() - startTime, status: "error", errorMessage });
      return new Response(JSON.stringify({ error: errorMessage }),
        { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let fullText = "";
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader  = upstream.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;
              if (trimmed.startsWith("data: ")) {
                try {
                  const content = JSON.parse(trimmed.slice(6)).choices?.[0]?.delta?.content;
                  if (content) {
                    fullText += content;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch { /* ignore */ }
              }
            }
          }

          logUsage({
            model,
            promptTokens,
            completionTokens: Math.ceil(fullText.length / 4),
            promptPreview: lastUser,
            responsePreview: fullText,
            durationMs: Date.now() - startTime,
            status: "success",
          });

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
