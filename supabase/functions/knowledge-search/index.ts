import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MISTRAL_API = "https://api.mistral.ai/v1";
const EMBED_MODEL = "mistral-embed";
const CHAT_MODEL  = "mistral-small-latest";

type SourceType = "board_resolution" | "processed_document" | "company_mandate";

interface SearchResult {
  id: string;
  source: SourceType;
  rank: number;
  title: string;
  subtitle: string;
  snippet: string;
  metadata: Record<string, string | null>;
  created_at: string;
  searchMode: "semantic" | "keyword";
}

// ── Embedding ─────────────────────────────────────────────────────────────────
async function getQueryEmbedding(query: string, apiKey: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${MISTRAL_API}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBED_MODEL, inputs: [query] }),
    });
    if (!resp.ok) return null;
    return (await resp.json()).data?.[0]?.embedding ?? null;
  } catch { return null; }
}

// ── Unified DB row → SearchResult mappers ─────────────────────────────────────
function mapUnifiedRow(row: any, mode: "semantic" | "keyword"): SearchResult {
  const meta: Record<string, string | null> = {};
  if (row.meta && typeof row.meta === "object") {
    for (const [k, v] of Object.entries(row.meta)) {
      meta[k] = v != null ? String(v) : null;
    }
  }
  return {
    id:         row.id,
    source:     row.source as SourceType,
    rank:       mode === "semantic" ? (row.similarity ?? 0) : (row.rank ?? 0) * 0.6,
    title:      row.title ?? "",
    subtitle:   row.subtitle ?? "",
    snippet:    row.snippet ?? "",
    metadata:   meta,
    created_at: row.created_at ?? "",
    searchMode: mode,
  };
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
function rrfMerge(semantic: SearchResult[], keyword: SearchResult[], k = 60): SearchResult[] {
  const scores = new Map<string, { result: SearchResult; score: number }>();
  const add = (list: SearchResult[], w: number) =>
    list.forEach((r, i) => {
      const rrf = w / (k + i + 1);
      const ex  = scores.get(r.id);
      if (ex) { ex.score += rrf; if (r.searchMode === "semantic") ex.result = r; }
      else scores.set(r.id, { result: r, score: rrf });
    });
  add(semantic, 0.65);
  add(keyword,  0.35);
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, rank: Math.min(1, score * k) }));
}

// ── RAG context builder ───────────────────────────────────────────────────────
function buildContext(results: SearchResult[]): string {
  return results.slice(0, 8).map((r, i) => {
    const meta = Object.entries(r.metadata)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(" | ");
    return `[${i + 1}] ${r.title} (id: ${r.id}, type: ${r.source})\n    ${meta}\n    ${r.snippet}`;
  }).join("\n\n");
}

const SYSTEM_PROMPT = `You are a banking compliance assistant with expertise in board resolutions, company mandates, and corporate banking documentation.

Answer the user's question using ONLY the retrieved documents provided. Be precise and factual.

CRITICAL: When referencing a document, use this exact markdown link syntax:
[Document Title](ks://<id>/<source_type>)
where <id> is the document's UUID and <source_type> is one of: board_resolution, processed_document, company_mandate.

Example: "According to [HSBC Board Resolution](ks://uuid-here/board_resolution), John Smith is authorized..."

Format your answer clearly using markdown. If the documents don't contain enough information to answer, say so clearly. Do not invent facts.`;

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { query, limit = 20, sources, stream = false } = await req.json();

    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase   = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey     = Deno.env.get("MISTRAL_API_KEY")!;
    const sanitized  = query.trim().replace(/['"\\]/g, " ");
    const sources_: SourceType[] = sources ?? ["board_resolution", "processed_document", "company_mandate"];

    // ── Run embedding + keyword search in parallel ──────────────────────────
    const [embedding, kwRaw] = await Promise.all([
      getQueryEmbedding(sanitized, apiKey),
      supabase.rpc("search_knowledge_keyword", {
        query_text:    sanitized,
        source_filter: sources_,
        result_limit:  limit,
      }),
    ]);

    const kwResults: SearchResult[] = (kwRaw.data ?? []).map((r: any) => mapUnifiedRow(r, "keyword"));

    // ── Semantic search (only if embedding succeeded) ───────────────────────
    let semResults: SearchResult[] = [];
    if (embedding) {
      const { data: semRaw } = await supabase.rpc("search_knowledge_semantic", {
        query_embedding: JSON.stringify(embedding),
        source_filter:   sources_,
        result_limit:    limit,
        min_similarity:  0.25,
      });
      semResults = (semRaw ?? []).map((r: any) => mapUnifiedRow(r, "semantic"));
    }

    // ── Merge ───────────────────────────────────────────────────────────────
    let allResults: SearchResult[];
    let searchMode: "semantic" | "hybrid" | "keyword";

    if (semResults.length > 0 && kwResults.length > 0) {
      allResults = rrfMerge(semResults, kwResults);
      searchMode = "hybrid";
    } else if (semResults.length > 0) {
      allResults = semResults.sort((a, b) => b.rank - a.rank);
      searchMode = "semantic";
    } else {
      allResults = kwResults.sort((a, b) => b.rank - a.rank);
      searchMode = "keyword";
    }

    const topResults = allResults.slice(0, limit);

    // ── Non-streaming ───────────────────────────────────────────────────────
    if (!stream) {
      return new Response(
        JSON.stringify({ results: topResults, query, searchMode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Streaming SSE ───────────────────────────────────────────────────────
    const readable = new ReadableStream({
      async start(controller) {
        const enc  = new TextEncoder();
        const emit = (event: string, data: unknown) =>
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

        try {
          emit("results", { results: topResults, searchMode, query });

          if (topResults.length === 0) {
            emit("done", { references: [] });
            controller.close();
            return;
          }

          const chatResp = await fetch(`${MISTRAL_API}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: CHAT_MODEL,
              stream: true,
              max_tokens: 900,
              temperature: 0.15,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user",   content: `Question: ${sanitized}\n\nRetrieved documents:\n${buildContext(topResults)}` },
              ],
            }),
          });

          if (!chatResp.ok || !chatResp.body) {
            emit("error", { message: `LLM error: ${chatResp.status}` });
            emit("done",  { references: topResults.slice(0, 5) });
            controller.close();
            return;
          }

          const reader  = chatResp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;
              try {
                const text = JSON.parse(payload).choices?.[0]?.delta?.content;
                if (text) emit("chunk", { text });
              } catch { /* ignore malformed chunks */ }
            }
          }

          emit("done", { references: topResults.slice(0, 5) });
        } catch (err) {
          emit("error", { message: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type":    "text/event-stream",
        "Cache-Control":   "no-cache",
        "X-Accel-Buffering":"no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
