import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, Server, ScanLine, Tag, Database,
  Monitor, Play, RotateCcw, Building2, GitMerge, Network,
  Hash, Copy, Eye, PenLine, Layers, Zap, Info, BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types & colour map ─────────────────────────────────────────────────────────

interface NodeInfo {
  label: string;
  description: string;
  tech: string;
  input: string;
  output: string;
  color: keyof typeof COLOR_MAP;
  icon: React.ComponentType<{ className?: string }>;
}

const COLOR_MAP = {
  gray:    { bg: 'bg-gray-50',    border: 'border-gray-200',    iconBg: 'bg-gray-100',    iconColor: 'text-gray-500',    text: 'text-gray-700',    ring: 'ring-gray-400'    },
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-200',    iconBg: 'bg-blue-100',    iconColor: 'text-blue-600',    text: 'text-blue-700',    ring: 'ring-blue-400'    },
  teal:    { bg: 'bg-teal-50',    border: 'border-teal-200',    iconBg: 'bg-teal-100',    iconColor: 'text-teal-600',    text: 'text-teal-700',    ring: 'ring-teal-400'    },
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   iconBg: 'bg-slate-100',   iconColor: 'text-slate-500',   text: 'text-slate-600',   ring: 'ring-slate-300'   },
  orange:  { bg: 'bg-orange-50',  border: 'border-orange-200',  iconBg: 'bg-orange-100',  iconColor: 'text-orange-600',  text: 'text-orange-700',  ring: 'ring-orange-400'  },
  sky:     { bg: 'bg-sky-50',     border: 'border-sky-200',     iconBg: 'bg-sky-100',     iconColor: 'text-sky-600',     text: 'text-sky-700',     ring: 'ring-sky-400'     },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', text: 'text-emerald-700', ring: 'ring-emerald-400' },
  green:   { bg: 'bg-green-50',   border: 'border-green-200',   iconBg: 'bg-green-100',   iconColor: 'text-green-600',   text: 'text-green-700',   ring: 'ring-green-400'   },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   iconBg: 'bg-amber-100',   iconColor: 'text-amber-600',   text: 'text-amber-700',   ring: 'ring-amber-400'   },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-200',  iconBg: 'bg-purple-100',  iconColor: 'text-purple-600',  text: 'text-purple-700',  ring: 'ring-purple-400'  },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-200',    iconBg: 'bg-rose-100',    iconColor: 'text-rose-600',    text: 'text-rose-700',    ring: 'ring-rose-400'    },
} as const;

const NODE_INFO: Record<string, NodeInfo> = {
  upload: {
    label: 'Upload Documents',
    description: 'User drags-and-drops or picks files. Accepted formats: PNG, JPG, PDF (max 5 MB each). Files are held in React state as DocFile objects; image previews are generated client-side with URL.createObjectURL().',
    tech: 'Browser File API · FileReader · URL.createObjectURL()',
    input: 'FileList from drag event or <input type="file" multiple>',
    output: 'DocFile[] — { id, file, preview, selected, mode }',
    color: 'gray', icon: Upload,
  },
  hash: {
    label: 'SHA-256 Hash',
    description: 'A SHA-256 digest is computed for every uploaded file using the browser\'s native SubtleCrypto API. The hash is used as a stable identity for duplicate detection — file renames do not cause false misses.',
    tech: 'crypto.subtle.digest("SHA-256") · FileReader.readAsArrayBuffer()',
    input: 'File.arrayBuffer()',
    output: 'hex string (64 chars) per file',
    color: 'amber', icon: Hash,
  },
  'dup-check': {
    label: 'Duplicate Detection',
    description: 'The computed hash is looked up in the processed_documents table. Matching rows surface a "Duplicate" badge on the file card. Users can set the mode to Skip (default), Process anyway, or Update the existing record.',
    tech: 'Supabase anon client · SELECT WHERE file_hash IN (...)',
    input: 'hash string[]',
    output: 'DocFile mode: "process" | "skip" | "update"',
    color: 'amber', icon: Copy,
  },
  'client-extract': {
    label: 'Client-side PDF Processing',
    description: 'Two operations run for PDFs. (1) Text extraction: pdf.js parses digital PDFs in the browser. A density heuristic (text length < 100 chars or < 1% of file size) marks scanned PDFs so they fall through to OCR. (2) First-page render: the first page is rasterised to a JPEG at 100 dpi using Canvas. This image is sent to the edge function as firstPageImage, enabling Pixtral vision analysis on PDFs and returning accurate signature bounding boxes. Image files skip both steps.',
    tech: 'pdfjs-dist · extractTextFromPDFClient() · convertPDFToImages(100 dpi) · Canvas.toDataURL()',
    input: 'PDF File object',
    output: 'clientText string + firstPageImage JPEG data URI (both optional, empty/undefined for images or on failure)',
    color: 'blue', icon: FileText,
  },
  'edge-fn': {
    label: 'document-processor-agent',
    description: 'Supabase Edge Function (Deno runtime). Receives all documents as a batch. Resolves MISTRAL_API_KEY (env var first, then api_settings table). Creates/updates a job record in document_processing_jobs, then fans out with Promise.all — every document is processed in parallel.',
    tech: 'Supabase Edge Functions · Deno · @supabase/supabase-js · Promise.all',
    input: '{ documents: DocumentInput[], jobId? } via HTTP POST',
    output: '{ jobId, results: DocumentResult[] }',
    color: 'teal', icon: Server,
  },
  doc: {
    label: 'Document Agent',
    description: 'Each document runs in its own independent Promise — one error does not abort others. The agent receives the base64 data URI, any client-extracted text, and (for PDFs) the first-page JPEG image. All N documents start simultaneously; the batch resolves when the slowest document finishes.',
    tech: 'processOneDocument() · Promise.all fan-out',
    input: '{ id, base64, fileName, clientText?, firstPageImage? }',
    output: 'DocumentResult routed through the per-doc pipeline',
    color: 'slate', icon: FileText,
  },
  ocr: {
    label: 'Mistral OCR',
    description: 'Skipped if clientText was provided. Otherwise, the base64 data URI is sent to the Mistral OCR endpoint. Images use type: image_url; PDFs use type: document_url. Pages are joined with separators. Falls back to empty string on failure.',
    tech: 'mistral-ocr-latest · POST /v1/ocr',
    input: 'Base64 data URI (image/png, image/jpeg, application/pdf)',
    output: 'extractedText — per-page markdown joined with page separators',
    color: 'orange', icon: ScanLine,
  },
  classify: {
    label: 'Classify + Summarize',
    description: 'Two Mistral chat calls run concurrently via Promise.all. classifyDocument assigns one of 17 categories (incl. Board Resolution, Balance Sheet, P&L) with a confidence score; summarizeDocument produces a 2–3 sentence summary plus up to 8 key data points. Falls back to regex rules if the API is unavailable.',
    tech: 'mistral-small-latest · Promise.all · regex fallback',
    input: 'extractedText (first 3 000–4 000 chars)',
    output: '{ classification: { category, confidence }, summary, keyDataPoints }',
    color: 'sky', icon: Tag,
  },
  br: {
    label: 'Board Resolution Path',
    description: 'Triggered only when category === "Board Resolution". Three calls run concurrently via Promise.allSettled: (1) extractBoardResolutionDetails — structured fields (company, resolution number, type, signatories, authorized persons, decisions); (2) extractVisualElements — if firstPageImage or a native image is available, Pixtral-12b vision is called and returns precise bounding boxes for signatures and stamps; otherwise text extraction is used as fallback. (3) extractSigningMandates — per-person banking authority (sole/joint/any-two, products, rules).',
    tech: 'mistral-small-latest + pixtral-12b-2409 (vision) · Promise.allSettled · firstPageImage → bounding boxes',
    input: 'extractedText + base64 data URI + firstPageImage? (JPEG of first page)',
    output: '{ boardResolutionDetails, visualElements (with bounding boxes), signingMandates[] }',
    color: 'emerald', icon: Building2,
  },
  financial: {
    label: 'Financial Statement Path',
    description: 'Triggered for Balance Sheet, Profit & Loss Statement, or Cash Flow Statement categories. Extracts period, currency, document type, a plain-English summary, and up to 12 key line items. Category-specific hints guide the extraction focus (assets/liabilities for BS, profitability for P&L, cash generation for CF).',
    tech: 'mistral-small-latest · extractFinancialDetails()',
    input: 'extractedText (first 5 000 chars) + category hint',
    output: '{ period, currency, documentType, plainSummary, figures: Record<string,string> }',
    color: 'purple', icon: Layers,
  },
  'br-cert': {
    label: 'BR Certificate Path',
    description: 'Triggered when category === "BR Certificate". Extracts company registration details: company name, registered address, directors array, registration number, date of incorporation, and nature of business.',
    tech: 'mistral-small-latest · extractBRDetails()',
    input: 'extractedText (first 4 000 chars)',
    output: 'BRDetails { companyName, address, directors[], registrationNumber, dateOfIncorporation, businessNature }',
    color: 'emerald', icon: Building2,
  },
  merge: {
    label: 'Batch Results Merged',
    description: 'Promise.all resolves once every document agent completes (or fails). Results are ordered by input index. Each DocumentResult carries its own error field — partial success is normal. The job record in document_processing_jobs is updated with status: "completed", "partial", or "failed".',
    tech: 'Promise.all resolution · document_processing_jobs UPDATE',
    input: 'N concurrent processOneDocument() promises',
    output: 'Ordered DocumentResult[] — one entry per input document',
    color: 'teal', icon: GitMerge,
  },
  'save-br': {
    label: 'Save Board Resolutions',
    description: 'Successful Board Resolution documents are inserted into the board_resolutions table using the service role key (bypasses RLS). Includes: company name, resolution type/number/date, signatories, authorized persons, key decisions, visual elements JSON, and full extracted text (up to 10 000 chars).',
    tech: 'board_resolutions INSERT · SUPABASE_SERVICE_ROLE_KEY',
    input: 'DocumentResult[] where category === "Board Resolution"',
    output: 'board_resolutions rows with generated UUIDs (used by mandate upsert)',
    color: 'green', icon: Database,
  },
  'save-mandates': {
    label: 'Upsert Company Mandates',
    description: 'For every signing mandate extracted, an upsert is performed on company_mandates keyed by (company_name, director_name). Products are union-merged across resolutions. Signing rules/arrangement are updated only if the new effective_date is more recent. Signature type is cross-referenced from visual elements (wet-ink vs digital).',
    tech: 'company_mandates SELECT + INSERT/UPDATE · merge products · cross-ref visual',
    input: 'SigningMandate[] + visual signature types per document',
    output: 'Upserted rows in company_mandates — visible in Company Mandates screen',
    color: 'green', icon: PenLine,
  },
  'log-db': {
    label: 'Log to llm_usage_logs',
    description: 'One row is inserted into llm_usage_logs: function name, model (OCR + small), estimated token counts from base64/text lengths, prompt preview (file names), duration, status, and estimated cost in USD using Mistral published pricing.',
    tech: 'llm_usage_logs INSERT · service_role · MODEL_PRICING cost calc',
    input: 'Batch metadata — file count, token estimates, duration, status',
    output: 'Inserted log row visible in the Usage Logs screen',
    color: 'green', icon: Database,
  },
  'trigger-embed': {
    label: 'Trigger Embedding (background)',
    description: 'After the HTTP response is returned to the client, the embed-documents edge function is invoked non-blocking via EdgeRuntime.waitUntil(). Errors are silently swallowed — embedding is best-effort and never blocks document processing results.',
    tech: 'EdgeRuntime.waitUntil() · fetch POST /functions/v1/embed-documents',
    input: '{ force: false }',
    output: 'Background Deno process — response already sent to client',
    color: 'amber', icon: Zap,
  },
  'ui-update': {
    label: 'Update Frontend UI',
    description: 'React state is updated by mapping results to document IDs — all documents transition from "processing" to "done" or "error" in a single setState call. Extracted text, classification, summary, BR/financial details, and visual elements are all displayed in expandable result rows.',
    tech: 'React setState · framer-motion AnimatePresence',
    input: 'DocumentResult[] from edge function response',
    output: 'ProcessedDoc[] state → expandable cards with categories, summaries, and details',
    color: 'blue', icon: Monitor,
  },
  'save-processed': {
    label: 'Save processed_documents',
    description: 'The client upserts a summary record to the processed_documents table keyed on file_hash. This powers duplicate detection for future uploads. Also immediately calls embed-documents (fire-and-forget) to ensure new records are indexed for Knowledge Search.',
    tech: 'Supabase anon client · UPSERT ON CONFLICT file_hash · callEdgeFunction(embed-documents)',
    input: 'Successful DocumentResult[] + file metadata',
    output: 'processed_documents rows — also immediately available in Knowledge Search',
    color: 'green', icon: Database,
  },
  'sig-extract': {
    label: 'Extract & Store Signatures',
    description: 'Runs client-side after the edge function returns. For each board resolution result with bounding boxes, the original file is rendered to page images, each bounding box is cropped using the Canvas API, and the JPEG is uploaded to Supabase Storage (signatures bucket). A row is inserted into document_signatures, and company_mandates.signature_url is updated via an ilike match on (company_name, director_name) — making thumbnails immediately visible in both the Board Resolutions Signatures tab and the Company Mandates table.',
    tech: 'Canvas API crop · Supabase Storage upload · extractAndStoreSignatures() · company_mandates UPDATE',
    input: 'Original File + VisualElements[] with bounding boxes + brIdMap',
    output: 'StoredSignature[] in document_signatures · signature_url written to company_mandates rows',
    color: 'rose', icon: Eye,
  },
  'embed-fn': {
    label: 'embed-documents (background)',
    description: 'Separate Supabase Edge Function. Queries all three knowledge tables for rows where embedding IS NULL. Builds a text representation per row (company name + resolution type + full text for board resolutions; file name + category + summary for processed documents; person + products for mandates). Batches up to 64 texts per Mistral request, with max 4 concurrent requests per table.',
    tech: 'mistral-embed · batches of 64 · max 4 concurrent · bulk_update_embeddings RPC',
    input: 'board_resolutions / processed_documents / company_mandates WHERE embedding IS NULL',
    output: 'vector(1024) embeddings written back via bulk_update_embeddings RPC — powers semantic search',
    color: 'purple', icon: BookOpen,
  },
};

// ── Simulation steps ──────────────────────────────────────────────────────────

const SIM_STEPS: string[][] = [
  ['upload'],
  ['hash'],
  ['dup-check'],
  ['client-extract'],
  ['edge-fn'],
  ['doc-1', 'doc-2', 'doc-3'],
  ['ocr-1', 'ocr-2', 'ocr-3'],
  ['classify-1', 'classify-2', 'classify-3'],
  ['br-1', 'br-2', 'br-3'],
  ['financial-1', 'financial-2', 'financial-3'],
  ['merge'],
  ['save-br', 'save-mandates', 'log-db', 'trigger-embed'],
  ['ui-update', 'save-processed'],
  ['sig-extract'],
  ['embed-fn'],
];

const SIM_LABELS = [
  'Files selected & validated',
  'SHA-256 hash computed per file',
  'Duplicate check against processed_documents',
  'Client-side PDF text extraction + first-page JPEG render',
  'Edge Function receives batch',
  'Fan-out: all documents start in parallel',
  'Mistral OCR running on all documents',
  'Classify + Summarize (concurrent per doc)',
  'Board Resolution: BR details + visual elements + signing mandates',
  'Financial extraction (Balance Sheet / P&L / Cash Flow)',
  'Batch results merged — job status updated',
  'Save board_resolutions · Upsert mandates · Log usage · Trigger embed',
  'React UI updated · Save processed_documents',
  'Crop & upload signature/stamp images',
  'Background: generate vector embeddings',
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function NodeCard({
  id, label, sublabel, optional, isActive, isVisited, isSelected, onClick,
}: {
  id: string; label: string; sublabel?: string; optional?: boolean;
  isActive: boolean; isVisited: boolean; isSelected: boolean; onClick: (id: string) => void;
}) {
  const baseId = id.replace(/-\d$/, '');
  const info = NODE_INFO[id] || NODE_INFO[baseId];
  if (!info) return null;
  const c = COLOR_MAP[info.color];
  const highlight = isActive || isSelected;

  return (
    <motion.div
      animate={isActive ? { scale: [1, 1.03, 1], boxShadow: ['0 0 0 0px rgba(0,0,0,0)', '0 0 12px 2px rgba(0,0,0,0.08)', '0 0 0 0px rgba(0,0,0,0)'] } : {}}
      transition={{ duration: 0.6, repeat: isActive ? Infinity : 0 }}
      onClick={() => onClick(id)}
      className={cn(
        'border rounded-xl p-2.5 cursor-pointer transition-all duration-200 select-none',
        c.bg, c.border,
        highlight ? cn('ring-2 ring-offset-1', c.ring) : '',
        !isVisited && !highlight ? 'opacity-40' : '',
        optional ? 'border-dashed' : '',
        'hover:shadow-sm hover:opacity-100',
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn('rounded-lg p-1.5 shrink-0', c.iconBg)}>
          <info.icon className={cn('h-3.5 w-3.5', c.iconColor)} />
        </div>
        <div className="min-w-0">
          <p className={cn('text-[11px] font-semibold leading-tight', c.text)}>{label}</p>
          {sublabel && <p className="text-[10px] text-gray-400 mt-0.5">{sublabel}</p>}
          {optional && <p className="text-[9px] text-gray-400 italic mt-0.5">conditional</p>}
        </div>
      </div>
    </motion.div>
  );
}

function VConnector({ small = false }: { small?: boolean }) {
  return (
    <div className="flex justify-center">
      <div className={cn('w-px bg-gray-200', small ? 'h-3' : 'h-4')} />
    </div>
  );
}

function ForkSVG({ cols = 3 }: { cols?: number }) {
  const positions = cols === 2 ? [100, 200] : [50, 150, 250];
  return (
    <svg height="18" className="w-full my-1" viewBox="0 0 300 18" preserveAspectRatio="none">
      <line x1="150" y1="0" x2="150" y2="8" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1={positions[0]} y1="8" x2={positions[positions.length - 1]} y2="8" stroke="#d1d5db" strokeWidth="1.5" />
      {positions.map(x => <line key={x} x1={x} y1="8" x2={x} y2="18" stroke="#d1d5db" strokeWidth="1.5" />)}
    </svg>
  );
}

function JoinSVG({ cols = 3 }: { cols?: number }) {
  const positions = cols === 2 ? [100, 200] : [50, 150, 250];
  return (
    <svg height="18" className="w-full my-1" viewBox="0 0 300 18" preserveAspectRatio="none">
      {positions.map(x => <line key={x} x1={x} y1="0" x2={x} y2="10" stroke="#d1d5db" strokeWidth="1.5" />)}
      <line x1={positions[0]} y1="10" x2={positions[positions.length - 1]} y2="10" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="150" y1="10" x2="150" y2="18" stroke="#d1d5db" strokeWidth="1.5" />
    </svg>
  );
}

function PhaseLabel({ label, color = 'gray' }: { label: string; color?: 'gray' | 'teal' | 'amber' | 'purple' }) {
  const styles = {
    gray:   'bg-gray-100 text-gray-500 border-gray-200',
    teal:   'bg-teal-50 text-teal-600 border-teal-200',
    amber:  'bg-amber-50 text-amber-600 border-amber-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
  };
  return (
    <div className={cn('text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border w-fit mb-2', styles[color])}>
      {label}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-[10px] text-gray-700 mt-0.5 leading-snug">{value}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ProcessingPipeline() {
  const [simStep, setSimStep]     = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeNodes  = new Set<string>(simStep >= 0 ? SIM_STEPS[simStep] ?? [] : []);
  const visitedNodes = new Set<string>(simStep >= 0 ? SIM_STEPS.slice(0, simStep + 1).flat() : []);

  const isActive  = (id: string) => activeNodes.has(id);
  const isVisited = (id: string) => visitedNodes.has(id) || simStep === -1;

  const handleNodeClick = (id: string) => {
    if (isPlaying) setIsPlaying(false);
    setSelectedId(prev => prev === id ? null : id);
  };

  const startSim = () => { setSimStep(0); setSelectedId(null); setIsPlaying(true); };
  const resetSim = () => {
    setIsPlaying(false); setSimStep(-1); setSelectedId(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => {
      setSimStep(prev => {
        const next = prev + 1;
        if (next >= SIM_STEPS.length) { setIsPlaying(false); return SIM_STEPS.length - 1; }
        return next;
      });
    }, 1200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, simStep]);

  const selectedInfo = selectedId
    ? (NODE_INFO[selectedId] ?? NODE_INFO[selectedId.replace(/-\d$/, '')] ?? null)
    : null;

  const laneActive  = (base: string, sfx: string) => activeNodes.has(base + sfx);
  const laneVisited = (base: string, sfx: string) => visitedNodes.has(base + sfx) || simStep === -1;

  return (
    <div className="font-['Inter',sans-serif] space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Processing Pipeline</h2>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Interactive diagram of the full document processing flow. Click any node to inspect it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {simStep >= 0 && simStep < SIM_LABELS.length && (
            <motion.span
              key={simStep}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              className="text-[11px] text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full font-medium max-w-xs truncate"
            >
              {SIM_LABELS[simStep]}
            </motion.span>
          )}
          <Button variant="outline" size="sm" onClick={resetSim} disabled={simStep === -1 && !isPlaying} className="h-8 text-[12px] gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={startSim} disabled={isPlaying} className="h-8 text-[12px] gap-1.5 bg-[#DB0011] hover:bg-[#B00010] text-white">
            <Play className="h-3.5 w-3.5" />{isPlaying ? 'Running…' : 'Simulate'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ── Diagram ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 p-5 overflow-x-auto">
          <div className="min-w-[560px]">

            {/* Phase 1 — Browser: file handling */}
            <PhaseLabel label="Phase 1 · Browser" color="gray" />
            <NodeCard id="upload"       label="Upload Documents"          sublabel="PNG · JPG · PDF · max 5 MB"              isActive={isActive('upload')}       isVisited={isVisited('upload')}       isSelected={selectedId === 'upload'}       onClick={handleNodeClick} />
            <VConnector />
            <div className="grid grid-cols-2 gap-3">
              <NodeCard id="hash"       label="SHA-256 Hash"              sublabel="crypto.subtle · per file"                isActive={isActive('hash')}         isVisited={isVisited('hash')}         isSelected={selectedId === 'hash'}         onClick={handleNodeClick} />
              <NodeCard id="dup-check"  label="Duplicate Detection"       sublabel="DB lookup · file_hash"                   isActive={isActive('dup-check')}    isVisited={isVisited('dup-check')}    isSelected={selectedId === 'dup-check'}    onClick={handleNodeClick} />
            </div>
            <VConnector />
            <NodeCard id="client-extract" label="Client-side PDF Processing" sublabel="pdf.js text + JPEG render (100 dpi)"         isActive={isActive('client-extract')} isVisited={isVisited('client-extract')} isSelected={selectedId === 'client-extract'} onClick={handleNodeClick} />
            <VConnector />

            {/* Phase 2 — Edge Function */}
            <PhaseLabel label="Phase 2 · Supabase Edge Function" color="teal" />
            <div className={cn(
              'border-2 rounded-2xl p-4 transition-all duration-300',
              isActive('edge-fn') ? 'border-teal-400 bg-teal-50/60 shadow-md' : 'border-dashed border-teal-200 bg-teal-50/20',
            )}>
              {/* Edge function header */}
              <div
                onClick={() => handleNodeClick('edge-fn')}
                className={cn(
                  'flex items-center gap-2.5 cursor-pointer rounded-xl px-3 py-2.5 border transition-all duration-200 mb-3',
                  selectedId === 'edge-fn' ? 'ring-2 ring-teal-400 ring-offset-1 bg-teal-50 border-teal-300' : 'bg-white border-teal-200 hover:bg-teal-50/40',
                )}
              >
                <div className="rounded-lg p-1.5 bg-teal-100 shrink-0"><Server className="h-4 w-4 text-teal-600" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-teal-700">document-processor-agent</p>
                  <p className="text-[10px] text-teal-500">Deno Runtime · Resolves API key · Creates job record · Promise.all fan-out</p>
                </div>
                <span className="text-[10px] bg-teal-100 text-teal-700 font-medium px-2 py-0.5 rounded-full border border-teal-200 shrink-0">Promise.all</span>
              </div>

              <ForkSVG cols={3} />

              {/* Parallel per-document lanes */}
              <div className="grid grid-cols-3 gap-2.5">
                {(['-1', '-2', '-3'] as const).map((sfx, idx) => {
                  const docLabel = idx === 2 ? 'Document N' : `Document ${idx + 1}`;
                  return (
                    <div key={sfx} className="space-y-0">
                      <NodeCard id={`doc${sfx}`}       label={docLabel}              sublabel="base64 + clientText?"    isActive={laneActive('doc', sfx)}      isVisited={laneVisited('doc', sfx)}      isSelected={selectedId === `doc${sfx}`}       onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`ocr${sfx}`}       label="Mistral OCR"           sublabel="mistral-ocr-latest"      isActive={laneActive('ocr', sfx)}      isVisited={laneVisited('ocr', sfx)}      isSelected={selectedId === `ocr${sfx}`}       onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`classify${sfx}`}  label="Classify + Summarize"  sublabel="mistral-small-latest"    isActive={laneActive('classify', sfx)} isVisited={laneVisited('classify', sfx)} isSelected={selectedId === `classify${sfx}`}  onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`br${sfx}`}        label="Board Resolution Path" sublabel="BR + Visual + Mandates"  optional isActive={laneActive('br', sfx)}      isVisited={laneVisited('br', sfx)}      isSelected={selectedId === `br${sfx}`}        onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`financial${sfx}`} label="Financial Statement"   sublabel="Balance Sheet/P&L/CF"    optional isActive={laneActive('financial', sfx)} isVisited={laneVisited('financial', sfx)} isSelected={selectedId === `financial${sfx}`} onClick={handleNodeClick} />
                    </div>
                  );
                })}
              </div>

              <JoinSVG cols={3} />

              {/* Merge */}
              <NodeCard id="merge" label="Batch Results Merged" sublabel="update document_processing_jobs" isActive={isActive('merge')} isVisited={isVisited('merge')} isSelected={selectedId === 'merge'} onClick={handleNodeClick} />
              <VConnector small />

              {/* DB persistence (inside edge fn) */}
              <div className="grid grid-cols-2 gap-2.5">
                <NodeCard id="save-br"       label="Save board_resolutions"    sublabel="service_role INSERT"         optional isActive={isActive('save-br')}       isVisited={isVisited('save-br')}       isSelected={selectedId === 'save-br'}       onClick={handleNodeClick} />
                <NodeCard id="save-mandates" label="Upsert company_mandates"   sublabel="merge products · cross-ref"  optional isActive={isActive('save-mandates')} isVisited={isVisited('save-mandates')} isSelected={selectedId === 'save-mandates'} onClick={handleNodeClick} />
              </div>
              <VConnector small />
              <div className="grid grid-cols-2 gap-2.5">
                <NodeCard id="log-db"         label="Log to llm_usage_logs"    sublabel="cost · tokens · duration"          isActive={isActive('log-db')}         isVisited={isVisited('log-db')}         isSelected={selectedId === 'log-db'}         onClick={handleNodeClick} />
                <NodeCard id="trigger-embed"  label="Trigger Embeddings"       sublabel="EdgeRuntime.waitUntil (async)"     isActive={isActive('trigger-embed')}  isVisited={isVisited('trigger-embed')}  isSelected={selectedId === 'trigger-embed'}  onClick={handleNodeClick} />
              </div>
            </div>

            <VConnector />

            {/* Phase 3 — Browser result handling */}
            <PhaseLabel label="Phase 3 · Browser (Result Handling)" color="gray" />
            <div className="grid grid-cols-2 gap-3">
              <NodeCard id="ui-update"      label="Update React UI"              sublabel="state update · AnimatePresence"  isActive={isActive('ui-update')}      isVisited={isVisited('ui-update')}      isSelected={selectedId === 'ui-update'}      onClick={handleNodeClick} />
              <NodeCard id="save-processed" label="Save processed_documents"     sublabel="UPSERT file_hash · history"      isActive={isActive('save-processed')} isVisited={isVisited('save-processed')} isSelected={selectedId === 'save-processed'} onClick={handleNodeClick} />
            </div>
            <VConnector />
            <NodeCard id="sig-extract" label="Extract & Store Signatures" sublabel="Canvas crop · Supabase Storage" optional isActive={isActive('sig-extract')} isVisited={isVisited('sig-extract')} isSelected={selectedId === 'sig-extract'} onClick={handleNodeClick} />

            <VConnector />

            {/* Phase 4 — Background embed */}
            <PhaseLabel label="Phase 4 · Background (embed-documents)" color="purple" />
            <NodeCard id="embed-fn" label="embed-documents Edge Function" sublabel="mistral-embed · vector(1024) · all 3 tables" isActive={isActive('embed-fn')} isVisited={isVisited('embed-fn')} isSelected={selectedId === 'embed-fn'} onClick={handleNodeClick} />

          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div className="w-full lg:w-64 xl:w-72 shrink-0 space-y-4">
          {/* Legend */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Legend</p>
            <div className="space-y-1.5">
              {([
                { color: 'gray',    label: 'Client / Browser' },
                { color: 'amber',   label: 'Hash & dedup (browser)' },
                { color: 'blue',    label: 'Client-side PDF parsing' },
                { color: 'teal',    label: 'Edge Function scope' },
                { color: 'slate',   label: 'Document agent (parallel)' },
                { color: 'orange',  label: 'Mistral OCR call' },
                { color: 'sky',     label: 'Mistral analysis call' },
                { color: 'emerald', label: 'Board Resolution extraction' },
                { color: 'purple',  label: 'Financial / embedding' },
                { color: 'green',   label: 'Database writes' },
                { color: 'rose',    label: 'Storage / signatures' },
              ] as Array<{ color: keyof typeof COLOR_MAP; label: string }>).map(({ color, label }) => {
                const c = COLOR_MAP[color];
                return (
                  <div key={color} className="flex items-center gap-2">
                    <div className={cn('w-3 h-3 rounded border shrink-0', c.bg, c.border)} />
                    <span className="text-[11px] text-gray-600">{label}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 mt-1">
                <div className="w-3 h-3 rounded border border-dashed border-gray-300 bg-white shrink-0" />
                <span className="text-[11px] text-gray-600">Conditional step</span>
              </div>
            </div>
          </div>

          {/* Simulation progress */}
          {simStep >= 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</p>
              <div className="space-y-1.5">
                {SIM_LABELS.map((label, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0 mt-0.5',
                      i < simStep ? 'bg-teal-500' : i === simStep ? 'bg-[#DB0011] animate-pulse' : 'bg-gray-200',
                    )} />
                    <span className={cn(
                      'text-[11px] leading-tight',
                      i === simStep ? 'text-gray-900 font-medium' : i < simStep ? 'text-gray-500' : 'text-gray-300',
                    )}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Node detail */}
          <AnimatePresence mode="wait">
            {selectedInfo && (
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn('rounded-lg p-1.5 shrink-0', COLOR_MAP[selectedInfo.color].iconBg)}>
                    <selectedInfo.icon className={cn('h-4 w-4', COLOR_MAP[selectedInfo.color].iconColor)} />
                  </div>
                  <p className="text-[12px] font-bold text-gray-800 leading-tight">{selectedInfo.label}</p>
                </div>
                <p className="text-[11px] text-gray-600 leading-relaxed mb-3">{selectedInfo.description}</p>
                <div className="space-y-2">
                  <DetailRow label="Tech"   value={selectedInfo.tech}   />
                  <DetailRow label="Input"  value={selectedInfo.input}  />
                  <DetailRow label="Output" value={selectedInfo.output} />
                </div>
                <button onClick={() => setSelectedId(null)} className="mt-3 text-[10px] text-gray-400 hover:text-gray-600 transition-colors">
                  Dismiss
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {!selectedInfo && simStep === -1 && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-2 text-center">
              <Info className="h-5 w-5 text-gray-300" />
              <p className="text-[11px] text-gray-400">Click any node to see technical details.</p>
              <p className="text-[11px] text-gray-400">Press Simulate to watch data flow through all 15 stages.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
