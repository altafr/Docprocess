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
    const json = await resp.json();
    return json.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

// ── Semantic search ───────────────────────────────────────────────────────────
async function semanticSearch(
  supabase: ReturnType<typeof createClient>,
  sources: SourceType[],
  embedding: number[],
  limit: number
): Promise<SearchResult[]> {
  const vp = JSON.stringify(embedding);
  const rpc = async (fn: string, source: SourceType) => {
    const { data } = await supabase.rpc(fn, { query_embedding: vp, result_limit: limit, min_similarity: 0.25 });
    return (data ?? []) as any[];
  };

  const rows = await Promise.all([
    sources.includes("board_resolution")   ? rpc("search_board_resolutions_semantic",   "board_resolution")   : Promise.resolve([]),
    sources.includes("processed_document") ? rpc("search_processed_documents_semantic", "processed_document") : Promise.resolve([]),
    sources.includes("company_mandate")    ? rpc("search_company_mandates_semantic",    "company_mandate")    : Promise.resolve([]),
  ]);

  return rows.flat().map((row, _i, _arr) => mapSemanticRow(row));
}

function mapSemanticRow(row: any): SearchResult {
  const source: SourceType = row.director_name !== undefined ? "company_mandate"
    : row.file_name !== undefined ? "processed_document"
    : "board_resolution";
  return {
    id: row.id,
    source,
    rank: row.similarity ?? 0,
    title: source === "board_resolution" ? (row.document_name || row.resolution_type || "Board Resolution")
         : source === "processed_document" ? row.file_name
         : row.director_name,
    subtitle: source === "board_resolution"
      ? [row.company_name, row.resolution_number, row.resolution_date].filter(Boolean).join(" · ")
      : source === "processed_document" ? (row.category ?? "Uncategorised")
      : [row.company_name, row.title].filter(Boolean).join(" · "),
    snippet: source === "board_resolution" ? (row.purpose_summary || row.full_text?.slice(0, 300) || "")
           : source === "processed_document" ? (row.summary?.slice(0, 300) || "")
           : (row.notes || `${row.signing_arrangement ?? ""} signing`).trim(),
    metadata: source === "board_resolution"
      ? { company_name: row.company_name ?? null, resolution_type: row.resolution_type ?? null, resolution_date: row.resolution_date ?? null, effective_date: row.effective_date ?? null, expiry_date: row.expiry_date ?? null }
      : source === "processed_document"
      ? { category: row.category ?? null, file_size: row.file_size ? `${Math.round(row.file_size / 1024)} KB` : null }
      : { company_name: row.company_name, signing_arrangement: row.signing_arrangement ?? null, effective_date: row.effective_date ?? null, expiry_date: row.expiry_date ?? null },
    created_at: row.created_at ?? row.processed_at ?? "",
    searchMode: "semantic",
  };
}

// ── Keyword (FTS) search ──────────────────────────────────────────────────────
async function keywordSearch(
  supabase: ReturnType<typeof createClient>,
  sources: SourceType[],
  sanitized: string,
  limit: number
): Promise<SearchResult[]> {
  const rpc = async (fn: string) => {
    const { data } = await supabase.rpc(fn, { query_text: sanitized, result_limit: limit });
    return (data ?? []) as any[];
  };

  const [br, pd, cm] = await Promise.all([
    sources.includes("board_resolution")   ? rpc("search_board_resolutions")   : Promise.resolve([]),
    sources.includes("processed_document") ? rpc("search_processed_documents") : Promise.resolve([]),
    sources.includes("company_mandate")    ? rpc("search_company_mandates")    : Promise.resolve([]),
  ]);

  const mapBr = (row: any): SearchResult => ({
    id: row.id, source: "board_resolution", rank: (row.rank ?? 0) * 0.6,
    title: row.document_name || row.resolution_type || "Board Resolution",
    subtitle: [row.company_name, row.resolution_number, row.resolution_date].filter(Boolean).join(" · "),
    snippet: row.purpose_summary || row.full_text?.slice(0, 300) || "",
    metadata: { company_name: row.company_name ?? null, resolution_type: row.resolution_type ?? null, resolution_date: row.resolution_date ?? null, effective_date: row.effective_date ?? null, expiry_date: row.expiry_date ?? null },
    created_at: row.created_at, searchMode: "keyword",
  });
  const mapPd = (row: any): SearchResult => ({
    id: row.id, source: "processed_document", rank: (row.rank ?? 0) * 0.6,
    title: row.file_name, subtitle: row.category ?? "Uncategorised",
    snippet: row.summary?.slice(0, 300) || "",
    metadata: { category: row.category ?? null, file_size: row.file_size ? `${Math.round(row.file_size / 1024)} KB` : null },
    created_at: row.processed_at, searchMode: "keyword",
  });
  const mapCm = (row: any): SearchResult => ({
    id: row.id, source: "company_mandate", rank: (row.rank ?? 0) * 0.6,
    title: row.director_name,
    subtitle: [row.company_name, row.title].filter(Boolean).join(" · "),
    snippet: (row.notes || `${row.signing_arrangement ?? ""} signing`).trim(),
    metadata: { company_name: row.company_name, signing_arrangement: row.signing_arrangement ?? null, effective_date: row.effective_date ?? null, expiry_date: row.expiry_date ?? null },
    created_at: row.created_at, searchMode: "keyword",
  });

  return [...br.map(mapBr), ...pd.map(mapPd), ...cm.map(mapCm)];
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
function rrfMerge(semantic: SearchResult[], keyword: SearchResult[], k = 60): SearchResult[] {
  const scores = new Map<string, { result: SearchResult; score: number }>();
  const add = (list: SearchResult[], w: number) => list.forEach((r, i) => {
    const rrf = w / (k + i + 1);
    const ex = scores.get(r.id);
    if (ex) { ex.score += rrf; if (r.searchMode === "semantic") ex.result = r; }
    else scores.set(r.id, { result: r, score: rrf });
  });
  add(semantic, 0.65);
  add(keyword, 0.35);
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
    const body = await req.json();
    const { query, limit = 20, sources, stream = false } = body;

    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("MISTRAL_API_KEY")!;
    const sanitized = query.trim().replace(/['"\\]/g, " ");
    const enabledSources: SourceType[] = sources ?? ["board_resolution", "processed_document", "company_mandate"];

    // Run embedding + keyword search in parallel
    const [embedding, kwResults] = await Promise.all([
      getQueryEmbedding(sanitized, apiKey),
      keywordSearch(supabase, enabledSources, sanitized, limit),
    ]);

    let semResults: SearchResult[] = [];
    if (embedding) semResults = await semanticSearch(supabase, enabledSources, embedding, limit);

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

    // ── Non-streaming response ─────────────────────────────────────────────────
    if (!stream) {
      return new Response(
        JSON.stringify({ results: topResults, query, searchMode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Streaming SSE response ─────────────────────────────────────────────────
    const readable = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (event: string, data: unknown) =>
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

        try {
          // 1. Emit search results immediately
          emit("results", { results: topResults, searchMode, query });

          if (topResults.length === 0) {
            emit("done", { references: [] });
            controller.close();
            return;
          }

          // 2. Stream LLM answer
          const context = buildContext(topResults);
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
                { role: "user", content: `Question: ${sanitized}\n\nRetrieved documents:\n${context}` },
              ],
            }),
          });

          if (!chatResp.ok || !chatResp.body) {
            emit("error", { message: `LLM error: ${chatResp.status}` });
            emit("done", { references: topResults.slice(0, 5) });
            controller.close();
            return;
          }

          const reader = chatResp.body.getReader();
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
                const parsed = JSON.parse(payload);
                const text = parsed.choices?.[0]?.delta?.content;
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
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
