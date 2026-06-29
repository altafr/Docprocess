import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MISTRAL_API_URL = "https://api.mistral.ai/v1/embeddings";
const EMBED_MODEL     = "mistral-embed";
const BATCH_SIZE      = 64;   // items per Mistral request (well within token limits)
const MAX_CONCURRENCY = 4;    // parallel Mistral requests in-flight per table

type SourceTable = "board_resolutions" | "processed_documents" | "company_mandates";

// Columns fetched per table — only what buildEmbedText actually needs
const TABLE_COLUMNS: Record<SourceTable, string> = {
  board_resolutions:   "id, company_name, resolution_type, resolution_number, document_name, purpose_summary, full_text",
  processed_documents: "id, file_name, category, summary",
  company_mandates:    "id, company_name, director_name, title, signing_arrangement, authorized_products, notes",
};

function buildEmbedText(row: any, table: SourceTable): string {
  switch (table) {
    case "board_resolutions":
      return [
        row.company_name,
        row.resolution_type,
        row.resolution_number,
        row.document_name,
        row.purpose_summary,
        (row.full_text as string | null)?.slice(0, 1500),
      ].filter(Boolean).join("\n");

    case "processed_documents":
      return [
        row.file_name,
        row.category,
        (row.summary as string | null)?.slice(0, 1500),
      ].filter(Boolean).join("\n");

    case "company_mandates":
      return [
        `${row.company_name ?? ""} — ${row.director_name ?? ""}`,
        row.title,
        `Signing: ${row.signing_arrangement ?? ""}`,
        Array.isArray(row.authorized_products)
          ? `Products: ${row.authorized_products.join(", ")}`
          : "",
        row.notes,
      ].filter(Boolean).join("\n");
  }
}

async function generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const resp = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, inputs: texts }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Mistral embed error ${resp.status}: ${body}`);
  }
  const json = await resp.json();
  return json.data.map((d: any) => d.embedding as number[]);
}

// Run async tasks with bounded concurrency — avoids rate-limit spikes
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const active: Promise<void>[] = [];
  for (const item of items) {
    const p: Promise<void> = fn(item).finally(() => {
      active.splice(active.indexOf(p), 1);
    });
    active.push(p);
    if (active.length >= limit) await Promise.race(active);
  }
  await Promise.all(active);
}

interface TableResult {
  table: SourceTable;
  embedded: number;
  skipped: number;
  errors: string[];
}

async function embedTable(
  supabase: ReturnType<typeof createClient>,
  table: SourceTable,
  apiKey: string,
  forceAll: boolean,
): Promise<TableResult> {
  let q = supabase.from(table).select(TABLE_COLUMNS[table]);
  if (!forceAll) q = q.is("embedding", null);

  const { data: rows, error } = await q;
  if (error) throw new Error(`Fetch ${table}: ${error.message}`);
  if (!rows || rows.length === 0) return { table, embedded: 0, skipped: 0, errors: [] };

  // Chunk into batches
  const batches: { rows: any[]; texts: string[] }[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    batches.push({ rows: slice, texts: slice.map((r) => buildEmbedText(r, table)) });
  }

  let embedded = 0;
  const errors: string[] = [];

  await withConcurrency(batches, MAX_CONCURRENCY, async (batch) => {
    try {
      const embeddings = await generateEmbeddings(batch.texts, apiKey);

      // Single DB round-trip for the whole batch via bulk_update_embeddings RPC
      const { error: rpcErr } = await supabase.rpc("bulk_update_embeddings", {
        p_table:      table,
        p_ids:        batch.rows.map((r) => r.id),
        p_embeddings: embeddings.map((e) => JSON.stringify(e)),
      });

      if (rpcErr) {
        errors.push(`Batch (${batch.rows.length} rows): ${rpcErr.message}`);
      } else {
        embedded += batch.rows.length;
      }
    } catch (err: any) {
      errors.push(`Batch error: ${err.message}`);
    }
  });

  return { table, embedded, skipped: rows.length - embedded - errors.length, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { sources, force = false } = body;

    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) throw new Error("MISTRAL_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tables: SourceTable[] = sources ?? [
      "board_resolutions",
      "processed_documents",
      "company_mandates",
    ];

    // All three tables are processed in parallel
    const results = await Promise.all(
      tables.map((t) => embedTable(supabase, t, apiKey, Boolean(force)))
    );

    const totalEmbedded = results.reduce((s, r) => s + r.embedded, 0);

    return new Response(
      JSON.stringify({ success: true, totalEmbedded, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
