import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentInput {
  id: string;
  base64: string;       // full data URI, e.g. "data:application/pdf;base64,..."
  fileName: string;
  clientText?: string;  // pre-extracted text from the client (digital PDFs)
  firstPageImage?: string; // JPEG data URI of the first page, rendered client-side for PDFs
}

export interface DocumentResult {
  id: string;
  extractedText: string;
  classification: { category: string; confidence: number } | null;
  summary: string;
  keyDataPoints: Record<string, string>;
  brDetails: BRDetails | null;
  boardResolutionDetails: BoardResolutionDetails | null;
  financialDetails: FinancialDetails | null;
  visualElements: VisualElements | null;
  signingMandates: SigningMandate[];
  error?: string;
}

interface BRDetails {
  companyName: string | null;
  address: string | null;
  directors: string[];
  registrationNumber: string | null;
  dateOfIncorporation: string | null;
  businessNature: string | null;
}

interface BoardResolutionDetails {
  companyName: string | null;
  resolutionNumber: string | null;
  resolutionDate: string | null;
  resolutionType: string | null;
  purposeSummary: string | null;
  keyDecisions: string[];
  signatories: string[];
  authorizedPersons: string[];
  effectiveDate: string | null;
  expiryDate: string | null;
}

interface FinancialDetails {
  period: string | null;
  currency: string | null;
  documentType: string | null;
  plainSummary: string | null;
  figures: Record<string, string>;
}

interface BoundingBox {
  x: number; // left edge, 0-100% of page width
  y: number; // top edge, 0-100% of page height
  w: number; // width, 0-100%
  h: number; // height, 0-100%
}

interface Signature {
  name: string | null;
  title: string | null;
  company: string | null;
  type: "wet-ink" | "digital" | "unknown";
  description: string | null;
  boundingBox: BoundingBox | null;
}

interface Stamp {
  type: "company-seal" | "official-stamp" | "date-stamp" | "chop" | "notary" | "other";
  text: string | null;
  company: string | null;
  description: string | null;
  boundingBox: BoundingBox | null;
}

interface VisualElements {
  signatures: Signature[];
  stamps: Stamp[];
  hasSignatures: boolean;
  hasStamps: boolean;
  notes: string | null;
}

interface SigningMandate {
  personName: string;
  title: string | null;
  authorizedProducts: string[];
  signingArrangement: "sole" | "joint" | "any-two" | "other" | "unknown";
  signingRules: string[];
  effectiveDate: string | null;
  expiryDate: string | null;
}

// ---------------------------------------------------------------------------
// API key helper (env first, then api_settings table)
// ---------------------------------------------------------------------------

async function getApiKey(keyName: string): Promise<string | null> {
  const envValue = Deno.env.get(keyName);
  if (envValue) return envValue;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("api_settings")
    .select("value")
    .eq("key", keyName)
    .maybeSingle();

  if (error || !data) return null;
  return data.value;
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mistral OCR
// ---------------------------------------------------------------------------

async function mistralOCR(base64DataUri: string, apiKey: string): Promise<string> {
  const mimeMatch = base64DataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!mimeMatch) throw new Error("Invalid base64 data URI");

  const mimeType = mimeMatch[1];
  const body: Record<string, unknown> = { model: "mistral-ocr-latest", document: {} };

  if (mimeType === "application/pdf") {
    body.document = { type: "document_url", document_url: base64DataUri };
  } else {
    body.document = { type: "image_url", image_url: { url: base64DataUri } };
  }

  const response = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.message || err?.detail || `Mistral OCR failed (${response.status})`);
  }

  const result = await response.json();
  let text = "";

  if (result.pages && Array.isArray(result.pages)) {
    result.pages.forEach((page: any, idx: number) => {
      const pageText = page.markdown || page.text || "";
      text += (idx > 0 ? `\n\n--- Page ${idx + 1} ---\n\n` : "") + pageText;
    });
  } else {
    text = result.markdown || result.text || "";
  }

  return text || "No text extracted";
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const DOCUMENT_CATEGORIES = [
  "Utility Bill", "BR Certificate", "Bank Statement", "Invoice", "Receipt",
  "Tax Document", "Identity Document", "Insurance Document",
  "Contract / Agreement", "Letter / Correspondence", "Financial Report",
  "Balance Sheet", "Profit & Loss Statement", "Cash Flow Statement",
  "Application Form", "Board Resolution", "Other",
];

async function classifyDocument(
  text: string,
  apiKey: string,
): Promise<{ category: string; confidence: number }> {
  const snippet = text.slice(0, 3000);

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `You are a document classifier. Classify the document into exactly ONE of these categories: ${DOCUMENT_CATEGORIES.join(", ")}. Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}. No other text.`,
          },
          { role: "user", content: `Classify this document:\n\n${snippet}` },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || "";
      const match = content.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.category) {
          return { category: parsed.category, confidence: parsed.confidence ?? 0.8 };
        }
      }
    }
  } catch (_e) {
    // fall through to rules
  }

  // Rule-based fallback
  const lower = snippet.toLowerCase();
  if (/\b(electricity|water|gas|utility|broadband|kwh|consumption)\b/.test(lower)) return { category: "Utility Bill", confidence: 0.7 };
  if (/\b(business\s*registration|br\s*certificate|certificate\s*of\s*incorporation)\b/.test(lower)) return { category: "BR Certificate", confidence: 0.7 };
  if (/\b(bank\s*statement|opening\s*balance|closing\s*balance|transaction\s*history)\b/.test(lower)) return { category: "Bank Statement", confidence: 0.7 };
  if (/\b(invoice|bill\s*to|invoice\s*number|payment\s*terms)\b/.test(lower)) return { category: "Invoice", confidence: 0.7 };
  if (/\b(receipt|payment\s*received|transaction\s*id)\b/.test(lower)) return { category: "Receipt", confidence: 0.7 };
  if (/\b(tax\s*return|income\s*tax|taxable\s*income|w-2|1099)\b/.test(lower)) return { category: "Tax Document", confidence: 0.7 };
  if (/\b(passport|national\s*id|driver'?s?\s*licen[cs]e|date\s*of\s*birth)\b/.test(lower)) return { category: "Identity Document", confidence: 0.7 };
  if (/\b(insurance|policy\s*number|premium|coverage|insured)\b/.test(lower)) return { category: "Insurance Document", confidence: 0.7 };
  if (/\b(agreement|contract|terms\s*and\s*conditions|hereby\s*agree)\b/.test(lower)) return { category: "Contract / Agreement", confidence: 0.6 };
  if (/\b(balance\s*sheet|total\s*assets|total\s*liabilities|shareholders.?\s*equity|net\s*assets)\b/.test(lower)) return { category: "Balance Sheet", confidence: 0.75 };
  if (/\b(profit\s*(and|&)\s*loss|income\s*statement|gross\s*profit|operating\s*income|net\s*income|ebitda)\b/.test(lower)) return { category: "Profit & Loss Statement", confidence: 0.75 };
  if (/\b(cash\s*flow\s*statement|cash\s*flows?\s*from\s*(operating|investing|financing)|net\s*(increase|decrease)\s*in\s*cash)\b/.test(lower)) return { category: "Cash Flow Statement", confidence: 0.75 };
  if (/\b(financial\s*report|annual\s*report|financial\s*statement|audit\s*report)\b/.test(lower)) return { category: "Financial Report", confidence: 0.7 };
  if (/\b(application\s*form|applicant|please\s*fill|form\s*number)\b/.test(lower)) return { category: "Application Form", confidence: 0.6 };
  if (/\b(dear\s*(sir|madam|mr|ms|customer)|sincerely|regards|re:|subject:)\b/.test(lower)) return { category: "Letter / Correspondence", confidence: 0.6 };
  if (/\b(board\s*resolution|resolved\s*that|be\s*it\s*resolved|board\s*of\s*directors.*resolv|hereby\s*resolves|it\s*was\s*unanimously\s*resolved)\b/.test(lower)) return { category: "Board Resolution", confidence: 0.75 };

  return { category: "Other", confidence: 0.5 };
}

// ---------------------------------------------------------------------------
// String normalisation helpers
// ---------------------------------------------------------------------------

// Converts an unknown value to a readable string.
// Guards against cases where the LLM returns objects instead of plain strings.
function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const named = o.name ?? o.fullName ?? o.text ?? o.value ?? o.description;
    if (named !== undefined) return toStr(named);
    return Object.values(o)
      .filter((x) => x !== null && x !== undefined && typeof x !== "object")
      .map(String)
      .join(", ");
  }
  return String(v);
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toStr).filter(Boolean);
}

// ---------------------------------------------------------------------------
// BR Details Extraction
// ---------------------------------------------------------------------------

async function extractBRDetails(text: string, apiKey: string): Promise<BRDetails> {
  const snippet = text.slice(0, 4000);

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `Extract BR/company registration fields. Respond ONLY with this JSON:
{"companyName":null,"address":null,"directors":[],"registrationNumber":null,"dateOfIncorporation":null,"businessNature":null}
Use null for missing strings, empty array for missing directors.`,
          },
          { role: "user", content: `Extract from:\n\n${snippet}` },
        ],
        temperature: 0,
        max_tokens: 500,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          companyName: toStr(parsed.companyName) || null,
          address: toStr(parsed.address) || null,
          directors: toStringArray(parsed.directors),
          registrationNumber: toStr(parsed.registrationNumber) || null,
          dateOfIncorporation: toStr(parsed.dateOfIncorporation) || null,
          businessNature: toStr(parsed.businessNature) || null,
        };
      }
    }
  } catch (_e) {
    // return empty below
  }

  return { companyName: null, address: null, directors: [], registrationNumber: null, dateOfIncorporation: null, businessNature: null };
}

// ---------------------------------------------------------------------------
// Board Resolution Details Extraction
// ---------------------------------------------------------------------------

async function extractBoardResolutionDetails(text: string, apiKey: string): Promise<BoardResolutionDetails> {
  const snippet = text.slice(0, 4000);

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `Extract board resolution details. Respond ONLY with this JSON (no other text):
{"companyName":null,"resolutionNumber":null,"resolutionDate":null,"resolutionType":"Other","purposeSummary":null,"keyDecisions":[],"signatories":[],"authorizedPersons":[],"effectiveDate":null,"expiryDate":null}
Rules:
- resolutionType must be one of: "Authorization","Appointment","Approval","Ratification","Amendment","Dissolution","Other"
- purposeSummary: REQUIRED. Write ONE clear sentence in plain English explaining exactly what this resolution is about and what it authorises or decides. Do NOT leave this null — if details are sparse, summarise from context (e.g. "The board authorises the company to open a bank account and designates signing authorities."). Never return null for purposeSummary.
- keyDecisions: each RESOLVED/APPROVED decision as a separate plain-English string
- signatories: full names of directors or officers who signed
- authorizedPersons: names of persons authorized by this resolution (e.g. to sign, operate accounts)
- Use null for missing strings other than purposeSummary, empty arrays for missing lists`,
          },
          { role: "user", content: `Extract from:\n\n${snippet}` },
        ],
        temperature: 0,
        max_tokens: 700,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          companyName: toStr(parsed.companyName) || null,
          resolutionNumber: toStr(parsed.resolutionNumber) || null,
          resolutionDate: toStr(parsed.resolutionDate) || null,
          resolutionType: toStr(parsed.resolutionType) || "Other",
          purposeSummary: toStr(parsed.purposeSummary) || null,
          keyDecisions: toStringArray(parsed.keyDecisions),
          signatories: toStringArray(parsed.signatories),
          authorizedPersons: toStringArray(parsed.authorizedPersons),
          effectiveDate: toStr(parsed.effectiveDate) || null,
          expiryDate: toStr(parsed.expiryDate) || null,
        };
      }
    }
  } catch (_e) {
    // return empty below
  }

  return { companyName: null, resolutionNumber: null, resolutionDate: null, resolutionType: "Other", purposeSummary: null, keyDecisions: [], signatories: [], authorizedPersons: [], effectiveDate: null, expiryDate: null };
}

// ---------------------------------------------------------------------------
// Financial Details Extraction (Balance Sheet / P&L / Cash Flow)
// ---------------------------------------------------------------------------

const FINANCIAL_TYPE_HINTS: Record<string, string> = {
  "Balance Sheet": "Focus on: total assets, current assets, non-current assets, total liabilities, current liabilities, shareholders equity, net assets. plainSummary should describe the company's financial position.",
  "Profit & Loss Statement": "Focus on: revenue/turnover, gross profit, operating income/EBIT, net income/profit, total expenses, EBITDA if present. plainSummary should state whether the company is profitable and the key trend.",
  "Cash Flow Statement": "Focus on: net cash from operating activities, net cash from investing activities, net cash from financing activities, net change in cash, opening and closing cash balances. plainSummary should describe cash generation or burn.",
};

async function extractFinancialDetails(
  text: string,
  apiKey: string,
  category: string,
): Promise<FinancialDetails> {
  const snippet = text.slice(0, 5000);
  const hint = FINANCIAL_TYPE_HINTS[category] || "Extract all key financial figures.";

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `Extract financial data from this ${category}. Respond ONLY with this JSON:
{"period":null,"currency":null,"documentType":null,"plainSummary":null,"figures":{}}
Rules:
- period: reporting period or date (e.g. "Year ended 31 December 2024" or "As at 31 March 2025")
- currency: ISO currency code (e.g. "USD", "HKD", "GBP") or symbol found in document
- documentType: one of "balance_sheet", "profit_loss", "cash_flow"
- plainSummary: REQUIRED. 2–3 plain-English sentences a non-accountant can understand. ${hint}
- figures: object with up to 12 most important line items. Keys are human-readable labels, values are the amounts exactly as shown (include currency symbol/code and thousands separators). Keep negative values with their minus sign or parentheses.
Return ONLY the JSON. No markdown, no other text.`,
          },
          { role: "user", content: `Extract from this ${category}:\n\n${snippet}` },
        ],
        temperature: 0,
        max_tokens: 800,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          period: parsed.period || null,
          currency: parsed.currency || null,
          documentType: parsed.documentType || null,
          plainSummary: parsed.plainSummary || null,
          figures: parsed.figures && typeof parsed.figures === "object" ? parsed.figures : {},
        };
      }
    }
  } catch (_e) {
    // return empty below
  }

  return { period: null, currency: null, documentType: null, plainSummary: null, figures: {} };
}

async function summarizeDocument(
  text: string,
  apiKey: string,
): Promise<{ summary: string; keyDataPoints: Record<string, string> }> {
  const snippet = text.slice(0, 4000);

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `Extract key data and write a short summary. Respond ONLY with JSON:
{"summary":"<2-3 sentence summary>","keyDataPoints":{"<label>":"<value>"}}
Up to 8 most important data points (dates, amounts, names, IDs, addresses). Human-readable labels. No other text.`,
          },
          { role: "user", content: `Summarize and extract key data:\n\n${snippet}` },
        ],
        temperature: 0,
        max_tokens: 600,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          summary: parsed.summary || "",
          keyDataPoints: parsed.keyDataPoints || {},
        };
      }
    }
  } catch (_e) {
    // return empty below
  }

  return { summary: "", keyDataPoints: {} };
}

// ---------------------------------------------------------------------------
// Signing mandate extraction
// ---------------------------------------------------------------------------

async function extractSigningMandates(
  extractedText: string,
  apiKey: string,
): Promise<SigningMandate[]> {
  const snippet = extractedText.slice(0, 5000);
  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `Extract ALL individual signing mandates and authorised signatories from a board resolution. Include every person granted signing authority or authorised to act on behalf of the company.

Respond ONLY with this JSON (no other text):
{"mandates":[{"personName":"Full Name","title":null,"authorizedProducts":[],"signingArrangement":"sole","signingRules":[],"effectiveDate":null,"expiryDate":null}]}

Rules:
- personName: full name as written in the resolution
- title: Director, Chairman, CEO, Authorised Signatory, Company Secretary, etc.
- authorizedProducts: banking products/accounts they are authorised for, e.g. "Current Account","FX Transactions","Trade Finance","All Accounts","Internet Banking","Letters of Credit". Use ["All Accounts"] if the resolution grants general banking authority or does not specify. NEVER leave this empty — default to ["All Accounts"].
- signingArrangement: "sole" (can sign alone), "joint" (must sign with a specific named person), "any-two" (any two signatories from the authorised list), "other", "unknown"
- signingRules: any specific conditions, transaction limits, or restrictions stated in the resolution, as plain-English strings
- effectiveDate / expiryDate: ISO date strings if stated, otherwise null
- If the resolution authorises persons to operate/sign/manage company bank accounts or conduct banking transactions, include ALL such persons.
- Return empty mandates array ONLY if the resolution makes no mention of signing authority or authorised persons whatsoever.`,
          },
          { role: "user", content: `Extract all signing mandates from this board resolution:\n\n${snippet}` },
        ],
        temperature: 0,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) return [];
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim() || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    const VALID_ARRANGEMENTS = ["sole", "joint", "any-two", "other", "unknown"];

    return Array.isArray(parsed.mandates)
      ? parsed.mandates
          .filter((m: any) => toStr(m.personName))
          .map((m: any) => ({
            personName: toStr(m.personName)!,
            title: toStr(m.title) || null,
            authorizedProducts: toStringArray(m.authorizedProducts).length > 0
              ? toStringArray(m.authorizedProducts)
              : ["All Accounts"],
            signingArrangement: VALID_ARRANGEMENTS.includes(m.signingArrangement)
              ? m.signingArrangement
              : "unknown",
            signingRules: toStringArray(m.signingRules),
            effectiveDate: toStr(m.effectiveDate) || null,
            expiryDate: toStr(m.expiryDate) || null,
          }))
      : [];
  } catch (_e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-document processing (full pipeline for one document)
// ---------------------------------------------------------------------------

function emptyVisualElements(): VisualElements {
  return { signatures: [], stamps: [], hasSignatures: false, hasStamps: false, notes: null };
}

function parseBoundingBox(bb: any): BoundingBox | null {
  if (!bb || typeof bb !== "object") return null;
  const x = Number(bb.x); const y = Number(bb.y);
  const w = Number(bb.w ?? bb.width); const h = Number(bb.h ?? bb.height);
  if ([x, y, w, h].some((v) => isNaN(v) || v < 0)) return null;
  return { x: Math.min(x, 100), y: Math.min(y, 100), w: Math.min(w, 100), h: Math.min(h, 100) };
}

function parseVisualElementsJson(parsed: any): VisualElements {
  const VALID_SIG_TYPES = ["wet-ink", "digital", "unknown"];
  const VALID_STAMP_TYPES = ["company-seal", "official-stamp", "date-stamp", "chop", "notary", "other"];

  const signatures: Signature[] = Array.isArray(parsed.signatures)
    ? parsed.signatures.map((s: any) => ({
        name: toStr(s.name) || null,
        title: toStr(s.title) || null,
        company: toStr(s.company) || null,
        type: VALID_SIG_TYPES.includes(s.type) ? s.type : "unknown",
        description: toStr(s.description) || null,
        boundingBox: parseBoundingBox(s.boundingBox ?? s.bounding_box),
      }))
    : [];

  const stamps: Stamp[] = Array.isArray(parsed.stamps)
    ? parsed.stamps.map((s: any) => ({
        type: VALID_STAMP_TYPES.includes(s.type) ? s.type : "other",
        text: toStr(s.text) || null,
        company: toStr(s.company) || null,
        description: toStr(s.description) || null,
        boundingBox: parseBoundingBox(s.boundingBox ?? s.bounding_box),
      }))
    : [];

  return {
    signatures,
    stamps,
    hasSignatures: signatures.length > 0 || !!parsed.hasSignatures,
    hasStamps: stamps.length > 0 || !!parsed.hasStamps,
    notes: toStr(parsed.notes) || null,
  };
}

// Vision-based extraction for image documents (JPEG/PNG) using Pixtral.
async function extractVisualElementsFromImage(
  base64DataUri: string,
  apiKey: string,
): Promise<VisualElements> {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "pixtral-12b-2409",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: base64DataUri } },
            {
              type: "text",
              text: `Examine this document image for all visual authentication elements: signatures, stamps, seals, and chops.

For EACH element found, also provide its bounding box as percentages of the image dimensions:
- x: left edge (0-100)
- y: top edge (0-100)
- w: width (0-100)
- h: height (0-100)

Be generous with the bounding box — include a few percent of padding around each element so the crop looks clean.

Respond ONLY with this JSON, no other text:
{"signatures":[{"name":null,"title":null,"company":null,"type":"wet-ink","description":null,"boundingBox":{"x":0,"y":0,"w":0,"h":0}}],"stamps":[{"type":"company-seal","text":null,"company":null,"description":null,"boundingBox":{"x":0,"y":0,"w":0,"h":0}}],"hasSignatures":false,"hasStamps":false,"notes":null}

signature type: "wet-ink" | "digital" | "unknown"
stamp type: "company-seal" | "official-stamp" | "date-stamp" | "chop" | "notary" | "other"
notes: brief completeness observation
Use empty arrays if nothing found.`,
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    throw new Error(`Pixtral vision error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in vision response");
  return parseVisualElementsJson(JSON.parse(match[0]));
}

// Text-based extraction for PDF documents using Mistral chat.
async function extractVisualElementsFromText(
  extractedText: string,
  apiKey: string,
): Promise<VisualElements> {
  const snippet = extractedText.slice(0, 4000);

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: [
        {
          role: "system",
          content: `Extract signature and stamp information from board resolution text. Respond ONLY with this JSON:
{"signatures":[{"name":null,"title":null,"company":null,"type":"unknown","description":null}],"stamps":[{"type":"company-seal","text":null,"company":null,"description":null}],"hasSignatures":false,"hasStamps":false,"notes":null}
- Signatures: look for "Signed:", blank lines labelled with names/titles, "Director:", "Chairman:" etc.
- Stamps: look for "Common Seal", "Company Chop", "Official Stamp", seal affixed references
- type is always "unknown" for text-inferred signatures
- notes: any completeness observation (e.g. "Two signature lines detected but names unclear")
- Empty arrays if none found.`,
        },
        { role: "user", content: `Extract from:\n\n${snippet}` },
      ],
      temperature: 0,
      max_tokens: 600,
    }),
  });

  if (!response.ok) throw new Error(`Text visual API error: ${response.status}`);

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in text visual response");
  return parseVisualElementsJson(JSON.parse(match[0]));
}

// Dispatches to image or text extraction; falls back to text if vision fails.
async function extractVisualElements(
  base64DataUri: string,
  extractedText: string,
  apiKey: string,
  firstPageImage?: string,
): Promise<VisualElements> {
  const mimeMatch = base64DataUri.match(/^data:([^;]+);base64,/);
  const isImage = (mimeMatch?.[1] ?? "").startsWith("image/");

  // Use firstPageImage (client-rendered PDF page) or direct image for vision
  const visionSource = firstPageImage ?? (isImage ? base64DataUri : null);

  try {
    if (visionSource) {
      return await extractVisualElementsFromImage(visionSource, apiKey);
    }
    return await extractVisualElementsFromText(extractedText, apiKey);
  } catch (_primaryErr) {
    // Vision failed — fall back to text extraction
    try {
      return await extractVisualElementsFromText(extractedText, apiKey);
    } catch (_fallbackErr) {
      return emptyVisualElements();
    }
  }
}

async function processOneDocument(doc: DocumentInput, mistralKey: string): Promise<DocumentResult> {
  try {
    let extractedText = doc.clientText || "";

    // OCR if no client-side text was provided
    if (!extractedText) {
      extractedText = await mistralOCR(doc.base64, mistralKey);
    }

    // Run classification, summary, and BR extraction concurrently
    const [classification, { summary, keyDataPoints }] = await Promise.all([
      classifyDocument(extractedText, mistralKey),
      summarizeDocument(extractedText, mistralKey),
    ]);

    let brDetails: BRDetails | null = null;
    if (classification.category === "BR Certificate") {
      brDetails = await extractBRDetails(extractedText, mistralKey);
    }

    let boardResolutionDetails: BoardResolutionDetails | null = null;
    let visualElements: VisualElements | null = null;
    let signingMandates: SigningMandate[] = [];
    if (classification.category === "Board Resolution") {
      const [bdResult, veResult, smResult] = await Promise.allSettled([
        extractBoardResolutionDetails(extractedText, mistralKey),
        extractVisualElements(doc.base64, extractedText, mistralKey, doc.firstPageImage),
        extractSigningMandates(extractedText, mistralKey),
      ]);
      boardResolutionDetails = bdResult.status === "fulfilled" ? bdResult.value : null;
      visualElements = veResult.status === "fulfilled" ? veResult.value : emptyVisualElements();
      signingMandates = smResult.status === "fulfilled" ? smResult.value : [];
    }

    const FINANCIAL_CATEGORIES = ["Balance Sheet", "Profit & Loss Statement", "Cash Flow Statement"];
    let financialDetails: FinancialDetails | null = null;
    if (FINANCIAL_CATEGORIES.includes(classification.category)) {
      financialDetails = await extractFinancialDetails(extractedText, mistralKey, classification.category);
    }

    return { id: doc.id, extractedText, classification, summary, keyDataPoints, brDetails, boardResolutionDetails, financialDetails, visualElements, signingMandates };
  } catch (err: any) {
    return {
      id: doc.id,
      extractedText: "",
      classification: null,
      summary: "",
      keyDataPoints: {},
      brDetails: null,
      boardResolutionDetails: null,
      financialDetails: null,
      visualElements: null,
      signingMandates: [],
      error: err?.message || "Processing failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function triggerEmbedding(supabaseUrl: string, serviceKey: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/embed-documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "Apikey": serviceKey,
      },
      body: JSON.stringify({ force: false }),
    });
  } catch (err) {
    console.error("Background embedding trigger failed:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startTime = Date.now();
  try {
    const { documents, jobId } = await req.json() as {
      documents: DocumentInput[];
      jobId?: string;
    };

    if (!Array.isArray(documents) || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: "documents array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mistralKey = await getApiKey("MISTRAL_API_KEY");
    if (!mistralKey) {
      return new Response(
        JSON.stringify({ error: "Mistral API key not configured. Add MISTRAL_API_KEY in Settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Record job start in database if jobId supplied
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let supabase: ReturnType<typeof createClient> | null = null;
    if (supabaseUrl && supabaseServiceKey) {
      supabase = createClient(supabaseUrl, supabaseServiceKey);
    }

    const resolvedJobId = jobId || crypto.randomUUID();

    if (supabase) {
      await supabase.from("document_processing_jobs").upsert({
        id: resolvedJobId,
        status: "processing",
        file_count: documents.length,
        started_at: new Date().toISOString(),
      });
    }

    // Fan-out: process all documents in parallel (agentic orchestration)
    const results: DocumentResult[] = await Promise.all(
      documents.map((doc) => processOneDocument(doc, mistralKey)),
    );

    const errorCount = results.filter((r) => r.error).length;
    const finalStatus = errorCount === documents.length ? "failed" : errorCount > 0 ? "partial" : "completed";

    if (supabase) {
      await supabase.from("document_processing_jobs").update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        error_count: errorCount,
      }).eq("id", resolvedJobId);
    }

    // Persist board resolutions to dedicated table for operations staff
    if (supabase) {
      const boardResRows = results
        .filter((r) => !r.error && r.classification?.category === "Board Resolution" && r.boardResolutionDetails)
        .map((r) => {
          const d = r.boardResolutionDetails!;
          const docInput = documents.find((doc) => doc.id === r.id);
          return {
            document_name: docInput?.fileName || "",
            company_name: d.companyName,
            resolution_number: d.resolutionNumber,
            resolution_date: d.resolutionDate,
            resolution_type: d.resolutionType,
            purpose_summary: d.purposeSummary,
            key_decisions: d.keyDecisions,
            signatories: d.signatories,
            authorized_persons: d.authorizedPersons,
            effective_date: d.effectiveDate,
            expiry_date: d.expiryDate,
            full_text: r.extractedText?.slice(0, 10000) || "",
            confidence: r.classification?.confidence ?? null,
            visual_elements: r.visualElements ?? null,
          };
        });
      if (boardResRows.length > 0) {
        const { data: insertedBrRows } = await supabase
          .from("board_resolutions")
          .insert(boardResRows)
          .select("id, company_name, document_name");

        // Persist signing mandates — upsert per (company, person), merging products
        // and taking the most-recent effective rules. Run independently of whether
        // the board_resolutions insert succeeded/returned rows.
        const brIdMap = new Map<string, string>(
          (insertedBrRows ?? []).map((r: any) => [`${r.company_name}|${r.document_name}`, r.id]),
        );

        for (const result of results) {
          if (result.error || !result.signingMandates?.length) continue;
          const docInput = documents.find((d) => d.id === result.id);
          const companyName =
            result.boardResolutionDetails?.companyName ||
            docInput?.fileName?.replace(/\.[^.]+$/, "") ||
            "Unknown Company";
          const brId = brIdMap.get(`${companyName}|${docInput?.fileName || ""}`) ?? null;

            // Cross-reference visual signatures to enrich signature_type
            const sigTypeMap = new Map<string, string>();
            for (const sig of result.visualElements?.signatures ?? []) {
              if (sig.name) sigTypeMap.set(sig.name.toLowerCase(), sig.type);
            }

            for (const mandate of result.signingMandates) {
              try {
                const { data: existing } = await supabase
                  .from("company_mandates")
                  .select("id, authorized_products, source_resolution_ids, effective_date")
                  .eq("company_name", companyName)
                  .eq("director_name", mandate.personName)
                  .maybeSingle();

                const sigType = sigTypeMap.get(mandate.personName.toLowerCase()) ?? "unknown";
                const mergedProducts = [
                  ...new Set([
                    ...(Array.isArray(existing?.authorized_products) ? existing.authorized_products : []),
                    ...mandate.authorizedProducts,
                  ]),
                ];
                const mergedIds = [
                  ...new Set([
                    ...(Array.isArray(existing?.source_resolution_ids) ? existing.source_resolution_ids : []),
                    ...(brId ? [brId] : []),
                  ]),
                ];
                const newIsNewer =
                  !existing?.effective_date ||
                  !mandate.effectiveDate ||
                  mandate.effectiveDate >= existing.effective_date;

                if (existing) {
                  await supabase.from("company_mandates").update({
                    authorized_products: mergedProducts,
                    source_resolution_ids: mergedIds,
                    ...(newIsNewer
                      ? {
                          title: mandate.title ?? null,
                          signing_arrangement: mandate.signingArrangement,
                          signing_rules: mandate.signingRules,
                          signature_type: sigType !== "unknown" ? sigType : existing.signature_type ?? "unknown",
                          effective_date: mandate.effectiveDate,
                          expiry_date: mandate.expiryDate,
                        }
                      : {}),
                    last_updated: new Date().toISOString(),
                  }).eq("id", existing.id);
                } else {
                  await supabase.from("company_mandates").insert({
                    company_name: companyName,
                    director_name: mandate.personName,
                    title: mandate.title,
                    authorized_products: mergedProducts,
                    signing_arrangement: mandate.signingArrangement,
                    signing_rules: mandate.signingRules,
                    signature_type: sigType,
                    effective_date: mandate.effectiveDate,
                    expiry_date: mandate.expiryDate,
                    source_resolution_ids: brId ? [brId] : [],
                  });
                }
              } catch (mandateErr) {
                console.error("Mandate upsert error:", mandateErr);
              }
            }
        }
      }
    }

    const totalTokens = results.reduce((sum, r) => {
      return sum + Math.ceil((r.extractedText?.length || 0) / 4);
    }, 0);

    if (supabase) {
      await supabase.from("llm_usage_logs").insert({
        function_name: "document-processor-agent",
        model: "mistral-ocr-latest / mistral-small-latest",
        prompt_tokens: documents.reduce((s, d) => s + Math.ceil((d.base64?.length || 0) / 4), 0),
        completion_tokens: totalTokens,
        total_tokens: totalTokens,
        prompt_preview: `Batch of ${documents.length} document(s): ${documents.map((d) => d.fileName).join(", ").slice(0, 800)}`,
        response_preview: `status=${finalStatus} docs=${documents.length} errors=${errorCount}`,
        duration_ms: Date.now() - startTime,
        status: finalStatus === "failed" ? "error" : "success",
        error_message: finalStatus === "failed" ? `All ${documents.length} documents failed` : null,
        cost_usd: computeCost("mistral-ocr-latest", documents.reduce((s, d) => s + Math.ceil((d.base64?.length || 0) / 4), 0), totalTokens),
      });
    }

    // Trigger background embedding for newly saved records (non-blocking)
    if (supabaseUrl && supabaseServiceKey) {
      EdgeRuntime.waitUntil(triggerEmbedding(supabaseUrl, supabaseServiceKey));
    }

    return new Response(
      JSON.stringify({ jobId: resolvedJobId, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("document-processor-agent error:", error);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const db = createClient(supabaseUrl, serviceKey);
      await db.from("llm_usage_logs").insert({
        function_name: "document-processor-agent",
        model: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_preview: "",
        response_preview: "",
        duration_ms: Date.now() - startTime,
        status: "error",
        error_message: (error?.message || "Internal server error").slice(0, 500),
        cost_usd: 0,
      }).catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: error?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
