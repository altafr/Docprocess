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

// ── FTS query preparation ─────────────────────────────────────────────────────
// PostgreSQL FTS uses AND by default. Conversational filler words like "please"
// and "show" are NOT English stop words, so they become required AND terms that
// never appear in documents and kill all results. Strip them before FTS;
// keep the original natural-language text for the embedding call.
const FILLER_WORDS = new Set([
  'please', 'show', 'me', 'list', 'find', 'search', 'get', 'give', 'display',
  'fetch', 'retrieve', 'tell', 'look', 'what', 'which', 'who', 'when',
  'where', 'how', 'why', 'can', 'could', 'will', 'would', 'should',
  'shall', 'been', 'being', 'does', 'did', 'is', 'are', 'was', 'were',
]);

function prepareFTSQuery(query: string): string {
  const words = query.split(/\s+/).filter(Boolean);
  const filtered = words.filter(w => !FILLER_WORDS.has(w.toLowerCase()));
  return (filtered.length > 0 ? filtered : words).join(' ');
}

// ── Embedding — 7-second hard timeout ────────────────────────────────────────
async function getQueryEmbedding(query: string, apiKey: string): Promise<number[] | null> {
  if (!apiKey) return null;
  try {
    const ac  = new AbortController();
    const tid = setTimeout(() => ac.abort(), 7_000);
    try {
      const resp = await fetch(`${MISTRAL_API}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: EMBED_MODEL, inputs: [query] }),
        signal: ac.signal,
      });
      if (!resp.ok) return null;
      return (await resp.json()).data?.[0]?.embedding ?? null;
    } finally {
      clearTimeout(tid);
    }
  } catch { return null; }
}

// ── DB row → SearchResult ─────────────────────────────────────────────────────
function mapUnifiedRow(row: any, mode: "semantic" | "keyword"): SearchResult {
  const meta: Record<string, string | null> = {};
  if (row.meta && typeof row.meta === "object") {
    for (const [k, v] of Object.entries(row.meta)) meta[k] = v != null ? String(v) : null;
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

function mergeResults(
  sem: SearchResult[],
  kw: SearchResult[],
): { results: SearchResult[]; mode: "semantic" | "hybrid" | "keyword" } {
  if (sem.length > 0 && kw.length > 0) return { results: rrfMerge(sem, kw),                  mode: "hybrid"   };
  if (sem.length > 0)                  return { results: sem.sort((a, b) => b.rank - a.rank), mode: "semantic" };
  return                                      { results: kw.sort((a, b) => b.rank - a.rank),  mode: "keyword"  };
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

// ── Shared search logic ───────────────────────────────────────────────────────
async function runSearch(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  sanitized: string,
  sources_: SourceType[],
  limit: number,
): Promise<{ results: SearchResult[]; mode: "semantic" | "hybrid" | "keyword" }> {
  const [embedding, kwRaw] = await Promise.all([
    getQueryEmbedding(sanitized, apiKey),
    supabase.rpc("search_knowledge_keyword", {
      query_text:    prepareFTSQuery(sanitized),  // strip filler words for AND-based FTS
      source_filter: sources_,
      result_limit:  limit,
    }),
  ]);
  const kwResults: SearchResult[] = (kwRaw.data ?? []).map((r: any) => mapUnifiedRow(r, "keyword"));

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

  const { results, mode } = mergeResults(semResults, kwResults);
  return { results: results.slice(0, limit), mode };
}

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

    const supabase  = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey    = Deno.env.get("MISTRAL_API_KEY") ?? "";
    const sanitized = query.trim().replace(/['"\\]/g, " ");
    const sources_: SourceType[] = sources ?? ["board_resolution", "processed_document", "company_mandate"];

    // ── Non-streaming ───────────────────────────────────────────────────────────
    if (!stream) {
      const { results, mode } = await runSearch(supabase, apiKey, sanitized, sources_, limit);
      return new Response(
        JSON.stringify({ results, query, searchMode: mode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Streaming SSE ───────────────────────────────────────────────────────────
    // Return the Response IMMEDIATELY so the client receives HTTP 200 + event-stream
    // headers right away and transitions to streaming state. All DB/LLM work happens
    // inside start() and flows out as SSE events.
    const enc = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        // Swallow enqueue errors from client disconnects mid-stream
        const emit = (event: string, data: unknown) => {
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch { /* client disconnected */ }
        };

        let topResults: SearchResult[] = [];

        try {
          // ── Database searches ──────────────────────────────────────────────────
          const { results, mode: searchMode } = await runSearch(supabase, apiKey, sanitized, sources_, limit);
          topResults = results;

          emit("results", { results: topResults, searchMode, query });

          if (topResults.length === 0) {
            emit("done", { references: [] });
            return;
          }

          // ── LLM answer generation ──────────────────────────────────────────────
          const chatAc  = new AbortController();
          const chatTid = setTimeout(() => chatAc.abort(), 20_000);

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
            signal: chatAc.signal,
          });
          clearTimeout(chatTid);

          if (!chatResp.ok || !chatResp.body) {
            emit("error", { message: `LLM error ${chatResp.status}: ${chatResp.statusText}` });
            emit("done",  { references: topResults.slice(0, 5) });
            return;
          }

          const reader  = chatResp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (true) {
            // Rolling 15-second per-chunk timeout — prevents silent mid-stream stalls
            let chunkTimer: ReturnType<typeof setTimeout>;
            const timeout = new Promise<never>((_, reject) => {
              chunkTimer = setTimeout(() => reject(new Error("LLM stream timeout")), 15_000);
            });

            const { done, value } = await Promise.race([reader.read(), timeout])
              .finally(() => clearTimeout(chunkTimer!));

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
              } catch { /* ignore malformed SSE chunks */ }
            }
          }

          emit("done", { references: topResults.slice(0, 5) });

        } catch (err) {
          // Always emit done so the client can unblock, even on error
          emit("error", { message: String(err) });
          emit("done",  { references: topResults.slice(0, 5) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache",
        "X-Accel-Buffering": "no",
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
