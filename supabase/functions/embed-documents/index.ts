import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MISTRAL_API_URL = "https://api.mistral.ai/v1/embeddings";
const EMBED_MODEL = "mistral-embed";
const BATCH_SIZE = 32; // Mistral supports up to 2048 tokens per item; batch conservatively

type SourceTable = "board_resolutions" | "processed_documents" | "company_mandates";

// Build the text blob to embed for each record type
function buildEmbedText(row: any, table: SourceTable): string {
  switch (table) {
    case "board_resolutions":
      return [
        row.company_name,
        row.resolution_type,
        row.resolution_number,
        row.document_name,
        row.purpose_summary,
        row.full_text?.slice(0, 1500),
      ].filter(Boolean).join("\n");
    case "processed_documents":
      return [
        row.file_name,
        row.category,
        row.summary?.slice(0, 1500),
      ].filter(Boolean).join("\n");
    case "company_mandates":
      return [
        `${row.company_name} — ${row.director_name}`,
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
  // mistral-embed returns { data: [{ embedding: number[] }, ...] }
  return json.data.map((d: any) => d.embedding);
}

async function embedTable(
  supabase: ReturnType<typeof createClient>,
  table: SourceTable,
  apiKey: string,
  forceAll: boolean
): Promise<{ table: SourceTable; embedded: number; skipped: number; errors: string[] }> {
  let query = supabase.from(table).select("id, *");
  if (!forceAll) query = query.is("embedding", null);

  const { data: rows, error } = await query;
  if (error) throw new Error(`Fetch ${table} error: ${error.message}`);
  if (!rows || rows.length === 0) return { table, embedded: 0, skipped: 0, errors: [] };

  let embedded = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => buildEmbedText(r, table));
    try {
      const embeddings = await generateEmbeddings(texts, apiKey);
      // Update rows with their embeddings
      for (let j = 0; j < batch.length; j++) {
        const { error: updateErr } = await supabase
          .from(table)
          .update({ embedding: JSON.stringify(embeddings[j]) })
          .eq("id", batch[j].id);
        if (updateErr) {
          errors.push(`Row ${batch[j].id}: ${updateErr.message}`);
        } else {
          embedded++;
        }
      }
    } catch (err: any) {
      errors.push(`Batch ${i}-${i + BATCH_SIZE}: ${err.message}`);
    }
  }

  return { table, embedded, skipped: rows.length - embedded - errors.length, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { sources, force = false } = await req.json().catch(() => ({}));

    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) throw new Error("MISTRAL_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const tables: SourceTable[] = sources ?? [
      "board_resolutions",
      "processed_documents",
      "company_mandates",
    ];

    const results = await Promise.all(
      tables.map((t) => embedTable(supabase, t, apiKey, Boolean(force)))
    );

    const totalEmbedded = results.reduce((s, r) => s + r.embedded, 0);

    return new Response(
      JSON.stringify({ success: true, totalEmbedded, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
