import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Copy, Check, Search, Bot, Cpu, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';

// ---------------------------------------------------------------------------
// Static prompt catalogue — sourced from each edge function
// ---------------------------------------------------------------------------

type PromptCategory = 'classification' | 'extraction' | 'analysis' | 'detection' | 'generation' | 'translation';

interface PromptEntry {
  id: string;
  functionName: string;
  functionLabel: string;
  model: string;
  purpose: string;
  category: PromptCategory;
  systemPrompt?: string;
  userTemplate?: string;
  notes?: string;
}

const PROMPTS: PromptEntry[] = [
  // -------------------------------------------------------------------------
  // document-processor-agent
  // -------------------------------------------------------------------------
  {
    id: 'dpa-classify',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'Document Classification',
    category: 'classification',
    systemPrompt: `You are a document classifier. Classify the document into exactly ONE of these categories: Utility Bill, BR Certificate, Bank Statement, Invoice, Receipt, Tax Document, Identity Document, Insurance Document, Contract / Agreement, Letter / Correspondence, Financial Report, Balance Sheet, Profit & Loss Statement, Cash Flow Statement, Application Form, Board Resolution, Other. Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}. No other text.`,
    userTemplate: `Classify this document based on its content:\n\n{document_text}`,
  },
  {
    id: 'dpa-br-extract',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'BR Certificate Data Extraction',
    category: 'extraction',
    systemPrompt: `Extract BR/company registration fields. Respond ONLY with this JSON:\n{"companyName":null,"address":null,"directors":[],"registrationNumber":null,"dateOfIncorporation":null,"businessNature":null}\nUse null for missing strings, empty array for missing directors.`,
    userTemplate: `Extract from:\n\n{document_text}`,
  },
  {
    id: 'dpa-board-res',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'Board Resolution Details Extraction',
    category: 'extraction',
    systemPrompt: `Extract board resolution details. Respond ONLY with this JSON (no other text):\n{"companyName":null,"resolutionNumber":null,"resolutionDate":null,"resolutionType":"Other","purposeSummary":null,"keyDecisions":[],"signatories":[],"authorizedPersons":[],"effectiveDate":null,"expiryDate":null}\nRules:\n- resolutionType must be one of: "Authorization","Appointment","Approval","Ratification","Amendment","Dissolution","Other"\n- purposeSummary: REQUIRED. Write ONE clear sentence in plain English explaining exactly what this resolution is about and what it authorises or decides. Do NOT leave this null — if details are sparse, summarise from context. Never return null for purposeSummary.\n- keyDecisions: each RESOLVED/APPROVED decision as a separate plain-English string\n- signatories: full names of directors or officers who signed\n- authorizedPersons: names of persons authorized by this resolution\n- Use null for missing strings other than purposeSummary, empty arrays for missing lists`,
    userTemplate: `Extract from:\n\n{document_text}`,
  },
  {
    id: 'dpa-financial',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'Financial Statement Analysis',
    category: 'extraction',
    systemPrompt: `Extract financial data from this {category}. Respond ONLY with this JSON:\n{"period":null,"currency":null,"documentType":null,"plainSummary":null,"figures":{}}\nRules:\n- period: reporting period or date (e.g. "Year ended 31 December 2024")\n- currency: ISO currency code (e.g. "USD", "HKD", "GBP") or symbol found in document\n- documentType: one of "balance_sheet", "profit_loss", "cash_flow"\n- plainSummary: REQUIRED. 2–3 plain-English sentences a non-accountant can understand.\n- figures: object with up to 12 most important line items. Keys are human-readable labels, values are the amounts exactly as shown.\nReturn ONLY the JSON. No markdown, no other text.`,
    userTemplate: `Extract from this {category}:\n\n{document_text}`,
  },
  {
    id: 'dpa-summary',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'Summary & Key Data Points',
    category: 'extraction',
    systemPrompt: `Extract key data and write a short summary. Respond ONLY with JSON:\n{"summary":"<2-3 sentence summary>","keyDataPoints":{"<label>":"<value>"}}\nUp to 8 most important data points (dates, amounts, names, IDs, addresses). Human-readable labels. No other text.`,
    userTemplate: `Summarize and extract key data:\n\n{document_text}`,
  },
  {
    id: 'dpa-mandates',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'Signing Mandates Extraction',
    category: 'extraction',
    systemPrompt: `Extract ALL individual signing mandates and authorised signatories from a board resolution. Include every person granted signing authority or authorised to act on behalf of the company.\n\nRespond ONLY with this JSON (no other text):\n{"mandates":[{"personName":"Full Name","title":null,"authorizedProducts":[],"signingArrangement":"sole","signingRules":[],"effectiveDate":null,"expiryDate":null}]}\n\nRules:\n- personName: full name as written in the resolution\n- title: Director, Chairman, CEO, Authorised Signatory, Company Secretary, etc.\n- authorizedProducts: banking products/accounts they are authorised for, e.g. "Current Account","FX Transactions","Trade Finance","All Accounts". NEVER leave this empty — default to ["All Accounts"].\n- signingArrangement: "sole" (can sign alone), "joint" (must sign with a specific named person), "any-two" (any two from the authorised list), "other", "unknown"\n- signingRules: any specific conditions, transaction limits, or restrictions stated in the resolution\n- effectiveDate / expiryDate: ISO date strings if stated, otherwise null\n- Return empty mandates array ONLY if the resolution makes no mention of signing authority whatsoever.`,
    userTemplate: `Extract all signing mandates from this board resolution:\n\n{document_text}`,
  },
  {
    id: 'dpa-visual-image',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'pixtral-12b-2409',
    purpose: 'Signature & Stamp Detection (Image)',
    category: 'detection',
    userTemplate: `Examine this document image for all visual authentication elements: signatures, stamps, seals, and chops.\n\nFor EACH element found, also provide its bounding box as percentages of the image dimensions:\n- x: left edge (0-100)\n- y: top edge (0-100)\n- w: width (0-100)\n- h: height (0-100)\n\nBe generous with the bounding box — include a few percent of padding around each element so the crop looks clean.\n\nRespond ONLY with this JSON, no other text:\n{"signatures":[{"name":null,"title":null,"company":null,"type":"wet-ink","description":null,"boundingBox":{"x":0,"y":0,"w":0,"h":0}}],"stamps":[{"type":"company-seal","text":null,"company":null,"description":null,"boundingBox":{"x":0,"y":0,"w":0,"h":0}}],"hasSignatures":false,"hasStamps":false,"notes":null}\n\nsignature type: "wet-ink" | "digital" | "unknown"\nstamp type: "company-seal" | "official-stamp" | "date-stamp" | "chop" | "notary" | "other"\nnotes: brief completeness observation\nUse empty arrays if nothing found.`,
    notes: 'Sent alongside the document image as a multimodal message. Bounding boxes enable client-side PNG cropping.',
  },
  {
    id: 'dpa-visual-text',
    functionName: 'document-processor-agent',
    functionLabel: 'Document Processor',
    model: 'mistral-small-latest',
    purpose: 'Signature & Stamp Detection (Text Fallback)',
    category: 'detection',
    systemPrompt: `Extract signature and stamp information from board resolution text. Respond ONLY with this JSON:\n{"signatures":[{"name":null,"title":null,"company":null,"type":"unknown","description":null}],"stamps":[{"type":"company-seal","text":null,"company":null,"description":null}],"hasSignatures":false,"hasStamps":false,"notes":null}\n- Signatures: look for "Signed:", blank lines labelled with names/titles, "Director:", "Chairman:" etc.\n- Stamps: look for "Common Seal", "Company Chop", "Official Stamp", seal affixed references\n- type is always "unknown" for text-inferred signatures\n- notes: any completeness observation\n- Empty arrays if none found.`,
    userTemplate: `Extract from:\n\n{document_text}`,
    notes: 'Used as fallback when Pixtral vision fails or document is a digital PDF.',
  },

  // -------------------------------------------------------------------------
  // analyze-company
  // -------------------------------------------------------------------------
  {
    id: 'ac-analysis',
    functionName: 'analyze-company',
    functionLabel: 'Analyse Company',
    model: 'mistral-small-latest',
    purpose: 'Board Resolution Governance Analysis',
    category: 'analysis',
    userTemplate: `You are a senior banking compliance analyst reviewing board resolutions for a corporate client.\n\nCompany: {company}\nTotal resolutions: {count}\nPeriod: {firstDate} to {lastDate}{authorizedNote}\n\nResolution history (most recent first):\n{historyLines}\n\nWrite a professional analysis in exactly 3 paragraphs separated by blank lines:\n\nParagraph 1 — Governance overview: What governance activity has this company undertaken? What does the pattern suggest (routine maintenance, restructuring, regulatory compliance, leadership transition, expansion)?\n\nParagraph 2 — Key patterns: Types of resolutions used, timing and frequency, any notable changes or rotation in authorized persons or signatories across resolutions.\n\nParagraph 3 — Banking implications: What should relationship managers or banking operations teams note, verify, or be aware of based on this resolution history?\n\nRules: 3–4 sentences per paragraph. Be factual and precise. Do not speculate beyond what the data supports. Use professional banking language.`,
  },

  // -------------------------------------------------------------------------
  // asksme
  // -------------------------------------------------------------------------
  {
    id: 'sme-qa',
    functionName: 'asksme',
    functionLabel: 'AskSME',
    model: 'OpenRouter (configured)',
    purpose: 'Expert Q&A — Commercial Banking',
    category: 'analysis',
    systemPrompt: `You are a subject matter expert in {expertArea} within commercial banking.`,
    userTemplate: `{expertContext}\n\nQuestion: {question}\n\nPlease provide expert guidance and detailed insights.`,
    notes: 'expertArea and model are both configurable in Settings. Response streamed via SSE.',
  },

  // -------------------------------------------------------------------------
  // procedure-qa
  // -------------------------------------------------------------------------
  {
    id: 'pqa-qa',
    functionName: 'procedure-qa',
    functionLabel: 'Procedure Q&A',
    model: 'OpenRouter (configured)',
    purpose: 'Banking Procedures Q&A',
    category: 'generation',
    userTemplate: `{market_context}{journey_context}{additional_context}Question: {question}\n\nPlease provide a detailed answer about banking procedures. Format your response in markdown with clear headings, bullet points, and sections where appropriate.`,
    notes: 'market, journey and additional context are optional fields supplied by the user in the UI. Response streamed via SSE.',
  },

  // -------------------------------------------------------------------------
  // translate
  // -------------------------------------------------------------------------
  {
    id: 'translate-main',
    functionName: 'translate',
    functionLabel: 'Translation Service',
    model: 'OpenRouter (configured)',
    purpose: 'Professional Banking Translation',
    category: 'translation',
    userTemplate: `Translate the following text {source_lang_clause}to {target_lang}. Maintain professional banking terminology and context:\n\n{text}\n\nProvide only the translation without explanations.`,
    notes: 'source_lang_clause is omitted when auto-detect is selected. Response streamed via SSE.',
  },

  // -------------------------------------------------------------------------
  // data-extraction
  // -------------------------------------------------------------------------
  {
    id: 'de-classify',
    functionName: 'data-extraction',
    functionLabel: 'Data Extraction (OCR)',
    model: 'mistral-small-latest / openai/gpt-4o-mini',
    purpose: 'Document Classification',
    category: 'classification',
    systemPrompt: `You are a document classifier. Classify the document into exactly ONE of these categories: Utility Bill, BR Certificate, Bank Statement, Invoice, Receipt, Tax Document, Identity Document, Insurance Document, Contract / Agreement, Letter / Correspondence, Financial Report, Application Form, Other. Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}. No other text.`,
    userTemplate: `Classify this document based on its content:\n\n{document_text}`,
  },
  {
    id: 'de-br-extract',
    functionName: 'data-extraction',
    functionLabel: 'Data Extraction (OCR)',
    model: 'mistral-small-latest / openai/gpt-4o-mini',
    purpose: 'BR Certificate Data Extraction',
    category: 'extraction',
    systemPrompt: `You are a document data extractor specializing in Business Registration (BR) certificates and company incorporation documents. Extract the following fields from the document text. Respond with ONLY a JSON object, no other text:\n{\n  "companyName": "<company/business name or null>",\n  "address": "<registered address or null>",\n  "directors": ["<director name 1>", "<director name 2>"],\n  "registrationNumber": "<BR/registration number or null>",\n  "dateOfIncorporation": "<date of incorporation/registration or null>",\n  "businessNature": "<nature of business or null>"\n}\nIf a field is not found, use null for strings or an empty array for directors.`,
    userTemplate: `Extract business registration details from this document:\n\n{document_text}`,
  },
  {
    id: 'de-summary',
    functionName: 'data-extraction',
    functionLabel: 'Data Extraction (OCR)',
    model: 'mistral-small-latest / openai/gpt-4o-mini',
    purpose: 'Summary & Key Data Points',
    category: 'extraction',
    systemPrompt: `You extract key data points from documents and write a short summary. Respond with ONLY a JSON object:\n{"summary": "<2-3 sentence summary of the document>", "keyDataPoints": {"<label>": "<value>", ...}}\nExtract up to 8 of the most important data points (dates, amounts, names, IDs, addresses, etc). Use human-readable labels. No other text.`,
    userTemplate: `Summarize and extract key data:\n\n{document_text}`,
  },
  {
    id: 'de-ocr',
    functionName: 'data-extraction',
    functionLabel: 'Data Extraction (OCR)',
    model: 'openai/gpt-4o (OpenRouter)',
    purpose: 'OCR Text Extraction',
    category: 'extraction',
    userTemplate: `Extract all text from this image. Return only the extracted text, preserving the layout and structure as much as possible. Include any tables, lists, or formatted content.`,
    notes: 'Sent with the document image as a multimodal message when Mistral OCR is unavailable.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<PromptCategory, { label: string; color: string }> = {
  classification: { label: 'Classification',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
  extraction:     { label: 'Extraction',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  analysis:       { label: 'Analysis',         color: 'bg-violet-50 text-violet-700 border-violet-200' },
  detection:      { label: 'Detection',        color: 'bg-amber-50 text-amber-700 border-amber-200' },
  generation:     { label: 'Generation',       color: 'bg-sky-50 text-sky-700 border-sky-200' },
  translation:    { label: 'Translation',      color: 'bg-teal-50 text-teal-700 border-teal-200' },
};

const FUNCTION_COLORS: Record<string, string> = {
  'document-processor-agent': 'bg-[#DB0011]/10 text-[#DB0011] border-[#DB0011]/20',
  'analyze-company':          'bg-rose-50 text-rose-700 border-rose-200',
  'asksme':                   'bg-purple-50 text-purple-700 border-purple-200',
  'procedure-qa':             'bg-blue-50 text-blue-700 border-blue-200',
  'translate':                'bg-teal-50 text-teal-700 border-teal-200',
  'data-extraction':          'bg-orange-50 text-orange-700 border-orange-200',
};

const MODEL_ICON = (model: string) => {
  if (model.includes('pixtral')) return Cpu;
  if (model.includes('OpenRouter')) return Zap;
  return Bot;
};

const ALL_FUNCTIONS = ['All', ...Array.from(new Set(PROMPTS.map((p) => p.functionLabel)))];
const ALL_CATEGORIES: Array<'All' | PromptCategory> = ['All', 'classification', 'extraction', 'analysis', 'detection', 'generation', 'translation'];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PromptLibrary() {
  const [search, setSearch] = useState('');
  const [fnFilter, setFnFilter] = useState('All');
  const [catFilter, setCatFilter] = useState<'All' | PromptCategory>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = PROMPTS.filter((p) => {
    if (fnFilter !== 'All' && p.functionLabel !== fnFilter) return false;
    if (catFilter !== 'All' && p.category !== catFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.purpose.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.functionLabel.toLowerCase().includes(q) ||
        (p.systemPrompt ?? '').toLowerCase().includes(q) ||
        (p.userTemplate ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const copyPrompt = (p: PromptEntry) => {
    const text = [
      p.systemPrompt ? `[SYSTEM]\n${p.systemPrompt}` : '',
      p.userTemplate ? `[USER]\n${p.userTemplate}` : '',
    ].filter(Boolean).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  };

  return (
    <div className="font-['Inter',sans-serif] space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Prompt Library</h2>
        <p className="text-[13px] text-gray-500 mt-1">
          All AI prompts sent to Mistral, Pixtral, and OpenRouter across every edge function — {PROMPTS.length} prompts total.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Prompts', value: PROMPTS.length, color: 'text-gray-900' },
          { label: 'Edge Functions', value: new Set(PROMPTS.map((p) => p.functionName)).size, color: 'text-blue-700' },
          { label: 'Models Used', value: new Set(PROMPTS.map((p) => p.model)).size, color: 'text-emerald-700' },
          { label: 'Categories', value: new Set(PROMPTS.map((p) => p.category)).size, color: 'text-amber-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] text-gray-400 uppercase tracking-wider">{s.label}</p>
            <p className={`text-2xl font-semibold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search prompts, models, purposes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px] border-gray-200"
          />
        </div>
        <select
          value={fnFilter}
          onChange={(e) => setFnFilter(e.target.value)}
          className="h-9 text-[13px] border border-gray-200 rounded-lg px-3 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#DB0011]/20"
        >
          {ALL_FUNCTIONS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as 'All' | PromptCategory)}
          className="h-9 text-[13px] border border-gray-200 rounded-lg px-3 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#DB0011]/20"
        >
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c === 'All' ? 'All Categories' : CATEGORY_META[c].label}</option>
          ))}
        </select>
      </div>

      {/* Prompt cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Bot className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-[14px] font-medium text-gray-500">No prompts match your filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((p, idx) => {
              const catMeta = CATEGORY_META[p.category];
              const fnColor = FUNCTION_COLORS[p.functionName] ?? 'bg-gray-50 text-gray-600 border-gray-200';
              const ModelIcon = MODEL_ICON(p.model);
              const isExpanded = expandedId === p.id;

              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                >
                  {/* Header row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    className="w-full text-left px-5 py-4 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${fnColor}`}>
                            {p.functionLabel}
                          </span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${catMeta.color}`}>
                            {catMeta.label}
                          </span>
                        </div>
                        <p className="text-[14px] font-semibold text-gray-900 mt-1.5">{p.purpose}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <ModelIcon className="h-3 w-3 text-gray-400" />
                          <span className="text-[11px] text-gray-400 font-mono">{p.model}</span>
                        </div>
                        {p.notes && (
                          <p className="text-[11px] text-gray-400 italic mt-1">{p.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); copyPrompt(p); }}
                          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 px-2 py-1 rounded-md border border-gray-200 hover:border-gray-300 transition-colors"
                          title="Copy prompt"
                        >
                          {copiedId === p.id ? (
                            <><Check className="h-3 w-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                          ) : (
                            <><Copy className="h-3 w-3" />Copy</>
                          )}
                        </button>
                        <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        </motion.div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded prompt text */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-gray-100 divide-y divide-gray-100">
                          {p.systemPrompt && (
                            <PromptSection label="System Prompt" text={p.systemPrompt} color="bg-purple-50/40" />
                          )}
                          {p.userTemplate && (
                            <PromptSection label="User Message" text={p.userTemplate} color="bg-blue-50/30" />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function PromptSection({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div className={`px-5 py-4 ${color}`}>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <pre className="text-[12px] text-gray-800 whitespace-pre-wrap font-mono leading-relaxed bg-white/70 rounded-lg border border-gray-200 p-3 max-h-80 overflow-y-auto">
        {text}
      </pre>
    </div>
  );
}
