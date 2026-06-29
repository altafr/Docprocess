import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getApiKey(keyName: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("api_settings")
    .select("value")
    .eq("key", keyName)
    .maybeSingle();

  if (error || !data) {
    console.error(`Failed to fetch ${keyName}:`, error);
    return null;
  }

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
  model: string | null;
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
  } catch (e) {
    console.error("logUsage failed:", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { question, market, journey, context } = await req.json();

    if (!question) {
      return new Response(
        JSON.stringify({ error: "Question is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiKey = await getApiKey("OPENROUTER_API_KEY");
    const model = await getApiKey("LLM_MODEL");

    if (!apiKey) {
      await logUsage({ functionName: "procedure-qa", model: null, promptTokens: 0, completionTokens: 0, promptPreview: question, responsePreview: "", durationMs: 0, status: "error", errorMessage: "OpenRouter API key not configured" });
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!model) {
      await logUsage({ functionName: "procedure-qa", model: null, promptTokens: 0, completionTokens: 0, promptPreview: question, responsePreview: "", durationMs: 0, status: "error", errorMessage: "LLM model not configured" });
      return new Response(
        JSON.stringify({ error: "LLM model not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const marketContext = market ? `Market: ${market}\n` : "";
    const journeyContext = journey ? `Journey: ${journey}\n` : "";
    const additionalContext = context ? `Additional Context: ${context}\n\n` : "";

    const prompt = `${marketContext}${journeyContext}${additionalContext}Question: ${question}\n\nPlease provide a detailed answer about banking procedures. Format your response in markdown with clear headings, bullet points, and sections where appropriate.`;

    const startTime = Date.now();
    const promptTokens = Math.ceil(prompt.length / 4);

    console.log("Calling OpenRouter API with model:", model);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://banking-assistant.com",
        "X-Title": "Banking AI Assistant",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    if (!response.ok) {
      let errorMessage = "API request failed";
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      } catch (_e) {
        try { errorMessage = await response.text() || errorMessage; } catch (_e2) {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
      }
      console.error("OpenRouter API error:", errorMessage);
      await logUsage({ functionName: "procedure-qa", model, promptTokens, completionTokens: 0, promptPreview: question, responsePreview: "", durationMs: Date.now() - startTime, status: "error", errorMessage });
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let responseText = "";
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = response.body?.getReader();
          if (!reader) { controller.close(); return; }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;
              if (trimmed.startsWith("data: ")) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    responseText += content;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch (e) {
                  console.error("Parse error:", e);
                }
              }
            }
          }

          logUsage({
            functionName: "procedure-qa",
            model,
            promptTokens,
            completionTokens: Math.ceil(responseText.length / 4),
            promptPreview: question,
            responsePreview: responseText,
            durationMs: Date.now() - startTime,
            status: "success",
          });

          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
