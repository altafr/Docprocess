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

function buildStandardResult(extractedText: string, visualizationUrl = "") {
  const lines = extractedText.split('\n').filter((line: string) => line.trim());
  const jsonData = {
    full_text: extractedText,
    pages: [{
      page_number: 1,
      lines: lines.map((line: string) => ({
        text: line,
        confidence: 1.0
      }))
    }],
    total_pages: 1
  };

  return {
    extractedText: extractedText || "No text extracted",
    jsonData,
    visualizationUrl
  };
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

async function processWithReplicate(imageUrl: string, apiKey: string) {
  const response = await fetch("https://api.replicate.com/v1/models/datalab-to/ocr/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({
      input: {
        file: imageUrl,
        return_pages: true,
        visualize: true,
        skip_cache: false,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "OCR processing failed");
  }

  const result = await response.json();
  const output = result.output;

  let extractedText = "";
  let jsonData = {};
  let visualizationUrl = "";

  if (typeof output === 'string') {
    extractedText = output;
    jsonData = { text: output };
  } else if (output && typeof output === 'object') {
    extractedText = output.text || "";

    const simplifiedJson: any = {};

    if (output.pages && Array.isArray(output.pages)) {
      simplifiedJson.pages = output.pages.map((page: any) => {
        const pageData: any = {
          page_number: page.page_number || 1,
          lines: []
        };

        if (page.blocks && Array.isArray(page.blocks)) {
          page.blocks.forEach((block: any) => {
            if (block.lines && Array.isArray(block.lines)) {
              block.lines.forEach((line: any) => {
                if (line.text) {
                  pageData.lines.push({
                    text: line.text,
                    confidence: line.confidence
                  });
                }
              });
            }
          });
        }

        return pageData;
      });

      simplifiedJson.total_pages = simplifiedJson.pages.length;
    }

    simplifiedJson.full_text = extractedText;
    jsonData = simplifiedJson;

    if (output.visualizations && Array.isArray(output.visualizations) && output.visualizations.length > 0) {
      visualizationUrl = output.visualizations[0];
    }
  }

  return {
    extractedText: extractedText || "No text extracted",
    jsonData,
    visualizationUrl
  };
}

async function processWithOpenRouter(imageUrl: string, apiKey: string, model: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": Deno.env.get("SUPABASE_URL") || "",
      "X-Title": "Banking AI Assistant"
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all text from this image. Return only the extracted text, preserving the layout and structure as much as possible. Include any tables, lists, or formatted content."
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || "OpenRouter OCR processing failed");
  }

  const result = await response.json();
  const extractedText = result.choices?.[0]?.message?.content || "";

  return buildStandardResult(extractedText);
}

async function processWithMistralOCR(imageUrl: string, apiKey: string) {
  const body: any = {
    model: "mistral-ocr-latest",
    document: {},
  };

  if (imageUrl.startsWith("data:")) {
    const mimeMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!mimeMatch) throw new Error("Invalid base64 image format");

    const mimeType = mimeMatch[1];
    const base64Data = mimeMatch[2];

    if (mimeType === "application/pdf") {
      body.document = {
        type: "document_url",
        document_url: `data:${mimeType};base64,${base64Data}`,
      };
    } else {
      body.document = {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64Data}`,
        },
      };
    }
  } else {
    body.document = {
      type: "document_url",
      document_url: imageUrl,
    };
  }

  const response = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData?.message || errorData?.detail || `Mistral OCR failed with status ${response.status}`
    );
  }

  const result = await response.json();

  let extractedText = "";
  const pages: any[] = [];

  if (result.pages && Array.isArray(result.pages)) {
    result.pages.forEach((page: any, idx: number) => {
      const pageText = page.markdown || page.text || "";
      extractedText += (idx > 0 ? `\n\n--- Page ${idx + 1} ---\n\n` : "") + pageText;

      const lines = pageText.split('\n').filter((l: string) => l.trim());
      pages.push({
        page_number: idx + 1,
        lines: lines.map((line: string) => ({ text: line, confidence: 1.0 })),
      });
    });
  } else if (result.text || result.markdown) {
    extractedText = result.markdown || result.text || "";
  }

  const jsonData = {
    full_text: extractedText,
    pages: pages.length > 0 ? pages : [{
      page_number: 1,
      lines: extractedText.split('\n').filter((l: string) => l.trim()).map((line: string) => ({
        text: line,
        confidence: 1.0
      }))
    }],
    total_pages: pages.length || 1
  };

  return {
    extractedText: extractedText || "No text extracted",
    jsonData,
    visualizationUrl: ""
  };
}

async function processWithLlamaParse(imageUrl: string, apiKey: string) {
  let fileData: Uint8Array;
  let fileName: string;
  let mimeType: string;

  if (imageUrl.startsWith("data:")) {
    const mimeMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!mimeMatch) throw new Error("Invalid base64 image format");

    mimeType = mimeMatch[1];
    const base64Data = mimeMatch[2];
    const binaryStr = atob(base64Data);
    fileData = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      fileData[i] = binaryStr.charCodeAt(i);
    }

    const ext = mimeType.includes("pdf") ? "pdf"
      : mimeType.includes("png") ? "png"
      : "jpg";
    fileName = `upload.${ext}`;
  } else {
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error("Failed to fetch image from URL");
    fileData = new Uint8Array(await resp.arrayBuffer());
    mimeType = resp.headers.get("content-type") || "image/jpeg";
    fileName = "upload.jpg";
  }

  const formData = new FormData();
  formData.append("file", new Blob([fileData], { type: mimeType }), fileName);
  formData.append("language", "en");

  const uploadResponse = await fetch("https://api.cloud.llamaindex.ai/api/parsing/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errorData = await uploadResponse.json().catch(() => ({}));
    throw new Error(
      errorData?.detail || `LlamaParse upload failed with status ${uploadResponse.status}`
    );
  }

  const uploadResult = await uploadResponse.json();
  const jobId = uploadResult.id;

  if (!jobId) throw new Error("LlamaParse did not return a job ID");

  let status = "PENDING";
  let attempts = 0;
  const maxAttempts = 60;

  while (status === "PENDING" && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;

    const statusResponse = await fetch(
      `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}`,
      {
        headers: { "Authorization": `Bearer ${apiKey}` },
      }
    );

    if (!statusResponse.ok) throw new Error("Failed to check LlamaParse job status");

    const statusResult = await statusResponse.json();
    status = statusResult.status;

    if (status === "ERROR") {
      throw new Error(statusResult.error || "LlamaParse processing failed");
    }
  }

  if (status === "PENDING") throw new Error("LlamaParse processing timed out");

  const resultResponse = await fetch(
    `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}/result/markdown`,
    {
      headers: { "Authorization": `Bearer ${apiKey}` },
    }
  );

  if (!resultResponse.ok) throw new Error("Failed to get LlamaParse result");

  const resultData = await resultResponse.json();
  const extractedText = resultData.markdown || resultData.text || "";

  return buildStandardResult(extractedText);
}

const DOCUMENT_CATEGORIES = [
  "Utility Bill",
  "BR Certificate",
  "Bank Statement",
  "Invoice",
  "Receipt",
  "Tax Document",
  "Identity Document",
  "Insurance Document",
  "Contract / Agreement",
  "Letter / Correspondence",
  "Financial Report",
  "Application Form",
  "Other",
];

async function classifyDocument(extractedText: string): Promise<{ category: string; confidence: number }> {
  const snippet = extractedText.slice(0, 3000);

  const mistralKey = await getApiKey("MISTRAL_API_KEY");
  if (mistralKey) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            {
              role: "system",
              content: `You are a document classifier. Classify the document into exactly ONE of these categories: ${DOCUMENT_CATEGORIES.join(", ")}. Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}. No other text.`,
            },
            {
              role: "user",
              content: `Classify this document based on its content:\n\n${snippet}`,
            },
          ],
          temperature: 0,
          max_tokens: 100,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = content.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.category) {
            return { category: parsed.category, confidence: parsed.confidence ?? 0.8 };
          }
        }
      }
    } catch (e) {
      console.error("Mistral classification failed, falling back to rules:", e);
    }
  }

  const openRouterKey = await getApiKey("OPENROUTER_API_KEY");
  if (openRouterKey) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a document classifier. Classify the document into exactly ONE of these categories: ${DOCUMENT_CATEGORIES.join(", ")}. Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}. No other text.`,
            },
            {
              role: "user",
              content: `Classify this document based on its content:\n\n${snippet}`,
            },
          ],
          temperature: 0,
          max_tokens: 100,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = content.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.category) {
            return { category: parsed.category, confidence: parsed.confidence ?? 0.8 };
          }
        }
      }
    } catch (e) {
      console.error("OpenRouter classification failed, falling back to rules:", e);
    }
  }

  const lower = snippet.toLowerCase();
  if (/\b(electricity|water|gas|sewage|telecom|internet|broadband|phone\s*bill|utility)\b/.test(lower) &&
      /\b(amount\s*due|bill\s*date|meter|account\s*number|kwh|consumption|due\s*date)\b/.test(lower)) {
    return { category: "Utility Bill", confidence: 0.7 };
  }
  if (/\b(business\s*registration|br\s*certificate|certificate\s*of\s*incorporation|company\s*registration|registration\s*number)\b/.test(lower)) {
    return { category: "BR Certificate", confidence: 0.7 };
  }
  if (/\b(bank\s*statement|account\s*summary|opening\s*balance|closing\s*balance|transaction\s*history)\b/.test(lower)) {
    return { category: "Bank Statement", confidence: 0.7 };
  }
  if (/\b(invoice|bill\s*to|subtotal|total\s*due|payment\s*terms|invoice\s*number|invoice\s*date)\b/.test(lower)) {
    return { category: "Invoice", confidence: 0.7 };
  }
  if (/\b(receipt|paid|transaction\s*id|payment\s*received|thank\s*you\s*for\s*your\s*purchase)\b/.test(lower)) {
    return { category: "Receipt", confidence: 0.7 };
  }
  if (/\b(tax\s*return|income\s*tax|tax\s*assessment|irs|hmrc|taxable\s*income|w-2|1099)\b/.test(lower)) {
    return { category: "Tax Document", confidence: 0.7 };
  }
  if (/\b(passport|national\s*id|driver'?s?\s*licen[cs]e|identity\s*card|date\s*of\s*birth|nationality)\b/.test(lower)) {
    return { category: "Identity Document", confidence: 0.7 };
  }
  if (/\b(insurance|policy\s*number|premium|coverage|insured|claim|deductible)\b/.test(lower)) {
    return { category: "Insurance Document", confidence: 0.7 };
  }
  if (/\b(agreement|contract|terms\s*and\s*conditions|parties|hereby\s*agree|witness|signature)\b/.test(lower)) {
    return { category: "Contract / Agreement", confidence: 0.6 };
  }
  if (/\b(financial\s*report|annual\s*report|balance\s*sheet|profit\s*and\s*loss|revenue|fiscal\s*year)\b/.test(lower)) {
    return { category: "Financial Report", confidence: 0.7 };
  }
  if (/\b(application\s*form|applicant|please\s*fill|form\s*number|submit)\b/.test(lower)) {
    return { category: "Application Form", confidence: 0.6 };
  }
  if (/\b(dear\s*(sir|madam|mr|ms|customer)|sincerely|regards|re:|subject:)\b/.test(lower)) {
    return { category: "Letter / Correspondence", confidence: 0.6 };
  }

  return { category: "Other", confidence: 0.5 };
}

interface BRDetails {
  companyName: string | null;
  address: string | null;
  directors: string[];
  registrationNumber: string | null;
  dateOfIncorporation: string | null;
  businessNature: string | null;
}

async function extractBRDetails(extractedText: string): Promise<BRDetails> {
  const snippet = extractedText.slice(0, 4000);

  const mistralKey = await getApiKey("MISTRAL_API_KEY");
  if (mistralKey) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            {
              role: "system",
              content: `You are a document data extractor specializing in Business Registration (BR) certificates and company incorporation documents. Extract the following fields from the document text. Respond with ONLY a JSON object, no other text:
{
  "companyName": "<company/business name or null>",
  "address": "<registered address or null>",
  "directors": ["<director name 1>", "<director name 2>"],
  "registrationNumber": "<BR/registration number or null>",
  "dateOfIncorporation": "<date of incorporation/registration or null>",
  "businessNature": "<nature of business or null>"
}
If a field is not found, use null for strings or an empty array for directors.`,
            },
            {
              role: "user",
              content: `Extract business registration details from this document:\n\n${snippet}`,
            },
          ],
          temperature: 0,
          max_tokens: 500,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            companyName: parsed.companyName || null,
            address: parsed.address || null,
            directors: Array.isArray(parsed.directors) ? parsed.directors.filter(Boolean) : [],
            registrationNumber: parsed.registrationNumber || null,
            dateOfIncorporation: parsed.dateOfIncorporation || null,
            businessNature: parsed.businessNature || null,
          };
        }
      }
    } catch (e) {
      console.error("Mistral BR extraction failed, trying OpenRouter:", e);
    }
  }

  const openRouterKey = await getApiKey("OPENROUTER_API_KEY");
  if (openRouterKey) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a document data extractor specializing in Business Registration (BR) certificates and company incorporation documents. Extract the following fields from the document text. Respond with ONLY a JSON object, no other text:
{
  "companyName": "<company/business name or null>",
  "address": "<registered address or null>",
  "directors": ["<director name 1>", "<director name 2>"],
  "registrationNumber": "<BR/registration number or null>",
  "dateOfIncorporation": "<date of incorporation/registration or null>",
  "businessNature": "<nature of business or null>"
}
If a field is not found, use null for strings or an empty array for directors.`,
            },
            {
              role: "user",
              content: `Extract business registration details from this document:\n\n${snippet}`,
            },
          ],
          temperature: 0,
          max_tokens: 500,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            companyName: parsed.companyName || null,
            address: parsed.address || null,
            directors: Array.isArray(parsed.directors) ? parsed.directors.filter(Boolean) : [],
            registrationNumber: parsed.registrationNumber || null,
            dateOfIncorporation: parsed.dateOfIncorporation || null,
            businessNature: parsed.businessNature || null,
          };
        }
      }
    } catch (e) {
      console.error("OpenRouter BR extraction failed:", e);
    }
  }

  return {
    companyName: null,
    address: null,
    directors: [],
    registrationNumber: null,
    dateOfIncorporation: null,
    businessNature: null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();
  try {
    const { imageUrl, provider, model, textContent } = await req.json();

    if (imageUrl === "summarize-document" && textContent) {
      const snippet = textContent.slice(0, 4000);
      const classification = await classifyDocument(textContent);

      let brDetails: BRDetails | null = null;
      if (classification.category === "BR Certificate") {
        brDetails = await extractBRDetails(textContent);
      }

      let summary = "";
      let keyDataPoints: Record<string, string> = {};

      const mistralKey = await getApiKey("MISTRAL_API_KEY");
      const openRouterKey = await getApiKey("OPENROUTER_API_KEY");
      const apiKey = mistralKey || openRouterKey;
      const apiUrl = mistralKey
        ? "https://api.mistral.ai/v1/chat/completions"
        : "https://openrouter.ai/api/v1/chat/completions";
      const modelName = mistralKey ? "mistral-small-latest" : "openai/gpt-4o-mini";

      if (apiKey) {
        try {
          const headers: Record<string, string> = {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          };
          const resp = await fetch(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelName,
              messages: [
                {
                  role: "system",
                  content: `You extract key data points from documents and write a short summary. Respond with ONLY a JSON object:
{"summary": "<2-3 sentence summary of the document>", "keyDataPoints": {"<label>": "<value>", ...}}
Extract up to 8 of the most important data points (dates, amounts, names, IDs, addresses, etc). Use human-readable labels. No other text.`,
                },
                { role: "user", content: `Summarize and extract key data:\n\n${snippet}` },
              ],
              temperature: 0,
              max_tokens: 600,
            }),
          });

          if (resp.ok) {
            const r = await resp.json();
            const content = r.choices?.[0]?.message?.content?.trim() || "";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              summary = parsed.summary || "";
              keyDataPoints = parsed.keyDataPoints || {};
            }
          }
        } catch (e) {
          console.error("Summarization failed:", e);
        }
      }

      logUsage({
        functionName: "data-extraction",
        model: modelName,
        promptTokens: Math.ceil(textContent.length / 4),
        completionTokens: Math.ceil((summary + JSON.stringify(keyDataPoints)).length / 4),
        promptPreview: textContent.slice(0, 1000),
        responsePreview: `[summarize] category=${classification.category} summary=${summary.slice(0, 200)}`,
        durationMs: Date.now() - startTime,
        status: "success",
      });
      return new Response(
        JSON.stringify({ classification, brDetails, summary, keyDataPoints }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (imageUrl === "classify-only" && textContent) {
      const classification = await classifyDocument(textContent);
      let brDetails: BRDetails | null = null;
      if (classification.category === "BR Certificate") {
        brDetails = await extractBRDetails(textContent);
      }
      logUsage({
        functionName: "data-extraction",
        model: "mistral-small-latest",
        promptTokens: Math.ceil(textContent.length / 4),
        completionTokens: Math.ceil(JSON.stringify(classification).length / 4),
        promptPreview: textContent.slice(0, 1000),
        responsePreview: `[classify] category=${classification.category} confidence=${classification.confidence}`,
        durationMs: Date.now() - startTime,
        status: "success",
      });
      return new Response(
        JSON.stringify({ classification, brDetails }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "Image URL is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const selectedProvider = provider || await getApiKey("ocr_provider") || "replicate";
    let result;

    if (selectedProvider === "replicate") {
      const apiKey = await getApiKey("REPLICATE_API_TOKEN");

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "Replicate API token not configured. Add it in Settings." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      result = await processWithReplicate(imageUrl, apiKey);
    } else if (selectedProvider === "openrouter") {
      const apiKey = await getApiKey("OPENROUTER_API_KEY");

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "OpenRouter API key not configured. Add it in Settings." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const selectedModel = model || "openai/gpt-4o";
      result = await processWithOpenRouter(imageUrl, apiKey, selectedModel);
    } else if (selectedProvider === "mistral") {
      const apiKey = await getApiKey("MISTRAL_API_KEY");

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "Mistral API key not configured. Add it in Settings." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      result = await processWithMistralOCR(imageUrl, apiKey);
    } else if (selectedProvider === "llamaparse") {
      const apiKey = await getApiKey("LLAMAPARSE_API_KEY");

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "LlamaParse API key not configured. Add it in Settings." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      result = await processWithLlamaParse(imageUrl, apiKey);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown OCR provider: ${selectedProvider}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const classification = await classifyDocument(result.extractedText);

    let brDetails: BRDetails | null = null;
    if (classification.category === "BR Certificate") {
      brDetails = await extractBRDetails(result.extractedText);
    }

    logUsage({
      functionName: "data-extraction",
      model: selectedProvider === "mistral" ? "mistral-ocr-latest" : selectedProvider,
      promptTokens: Math.ceil(imageUrl.length / 4),
      completionTokens: Math.ceil(result.extractedText.length / 4),
      promptPreview: `[ocr:${selectedProvider}] ${imageUrl.slice(0, 80)}`,
      responsePreview: result.extractedText.slice(0, 1000),
      durationMs: Date.now() - startTime,
      status: "success",
    });
    return new Response(
      JSON.stringify({
        extractedText: result.extractedText,
        jsonData: result.jsonData,
        visualizationUrl: result.visualizationUrl,
        provider: selectedProvider,
        classification,
        brDetails,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    logUsage({
      functionName: "data-extraction",
      model: null,
      promptTokens: 0,
      completionTokens: 0,
      promptPreview: "",
      responsePreview: "",
      durationMs: Date.now() - startTime,
      status: "error",
      errorMessage: error?.message || "Internal server error",
    });
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
