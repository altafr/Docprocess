import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, Server, ScanLine, Tag, Database,
  Monitor, Play, RotateCcw, Building2, GitMerge, Network,
  ChevronRight, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

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
} as const;

const NODE_INFO: Record<string, NodeInfo> = {
  upload: {
    label: 'Upload Documents',
    description: 'Users drag-and-drop or click to select multiple files. Supported formats are PNG, JPG, and PDF (max 5 MB each). Files are held in React state as DocFile objects with object-URL previews generated client-side.',
    tech: 'Browser File API · FileReader · URL.createObjectURL()',
    input: 'FileList from drag event or <input type="file" multiple>',
    output: 'DocFile[] — { id, file, preview, selected }',
    color: 'gray', icon: Upload,
  },
  'client-extract': {
    label: 'Client PDF Extraction',
    description: 'Digital (non-scanned) PDFs are parsed in the browser with pdf.js before upload. A heuristic checks text density — if extracted text is under 100 chars or less than 1% of file size, the PDF is treated as scanned and falls through to OCR.',
    tech: 'pdfjs-dist · extractTextFromPDF() · isScannedPDF()',
    input: 'PDF File object',
    output: 'clientText string (empty string if scanned/image)',
    color: 'blue', icon: FileText,
  },
  'edge-fn': {
    label: 'document-processor-agent',
    description: 'Supabase Edge Function (Deno runtime). Receives all documents as a single JSON payload. Retrieves MISTRAL_API_KEY from env or api_settings table, records a job in document_processing_jobs, then fans out with Promise.all.',
    tech: 'Supabase Edge Functions · Deno · @supabase/supabase-js',
    input: '{ documents: DocumentInput[], jobId? } via HTTP POST',
    output: '{ jobId, results: DocumentResult[] }',
    color: 'teal', icon: Server,
  },
  doc: {
    label: 'Document Input',
    description: 'Each document is an independent agent dispatched concurrently. Promise.all means all N documents start simultaneously — the batch is as fast as the slowest single document. A per-document error does not abort others.',
    tech: 'processOneDocument() · Promise.all fan-out',
    input: '{ id, base64, fileName, clientText? }',
    output: 'DocumentResult — routed through the per-doc pipeline',
    color: 'slate', icon: FileText,
  },
  ocr: {
    label: 'Mistral OCR',
    description: 'If no clientText was provided, the base64 document is sent to Mistral OCR. Images use type: image_url; PDFs use type: document_url. The API returns per-page markdown. Skipped entirely for digital PDFs that supplied text.',
    tech: 'Mistral API · mistral-ocr-latest · POST /v1/ocr',
    input: 'Base64 data URI (image/png, image/jpeg, application/pdf)',
    output: 'extractedText — concatenated page markdown with separators',
    color: 'orange', icon: ScanLine,
  },
  classify: {
    label: 'Classify + Summarize',
    description: 'Two concurrent Mistral chat calls run in parallel: classifyDocument assigns one of 13 categories with a confidence score; summarizeDocument produces a 2–3 sentence summary plus up to 8 labelled key data points. Falls back to regex rules if Mistral is unavailable.',
    tech: 'Mistral API · mistral-small-latest · Promise.all',
    input: 'extractedText (first 3000–4000 chars)',
    output: '{ classification: {category, confidence}, summary, keyDataPoints }',
    color: 'sky', icon: Tag,
  },
  br: {
    label: 'BR Details (conditional)',
    description: 'Only triggered when classification.category === "BR Certificate". Extracts structured corporate fields using a JSON extraction prompt: company name, registered address, directors array, registration number, date of incorporation, nature of business.',
    tech: 'Mistral API · mistral-small-latest · JSON extraction prompt',
    input: 'extractedText — only for BR Certificate documents',
    output: 'BRDetails { companyName, address, directors[], registrationNumber, dateOfIncorporation, businessNature }',
    color: 'emerald', icon: Building2,
  },
  merge: {
    label: 'Merge Results',
    description: 'Promise.all resolves once every document agent completes. Results preserve the original input order. Each DocumentResult carries its own error field — partial success is normal and each document\'s status is reported independently.',
    tech: 'Promise.all resolution · DocumentResult[]',
    input: 'N concurrent processOneDocument promises',
    output: 'Ordered DocumentResult[] — one entry per input document',
    color: 'teal', icon: GitMerge,
  },
  'ui-update': {
    label: 'Update Frontend UI',
    description: 'React state is updated by mapping results to document IDs. All documents transition from "processing" to "done" or "error" in a single setState call. AnimatePresence handles the staggered appearance of result rows.',
    tech: 'React setState · framer-motion AnimatePresence',
    input: 'DocumentResult[] from edge function response',
    output: 'ProcessedDoc[] state → re-render with categories, summaries, detail expansion',
    color: 'blue', icon: Monitor,
  },
  'log-db': {
    label: 'Log to llm_usage_logs',
    description: 'After the batch resolves, one row is inserted into llm_usage_logs: function_name, model, estimated token counts, a prompt preview (file names), total duration, and overall status. Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS.',
    tech: 'Supabase service role · llm_usage_logs table · INSERT',
    input: 'Batch metadata — file count, token estimates, duration, status',
    output: 'Inserted log row visible in the Usage Logs screen',
    color: 'green', icon: Database,
  },
};

// Simulation: each step is the set of node IDs that light up simultaneously
const SIM_STEPS: string[][] = [
  ['upload'],
  ['client-extract'],
  ['edge-fn'],
  ['doc-1', 'doc-2', 'doc-3'],
  ['ocr-1', 'ocr-2', 'ocr-3'],
  ['classify-1', 'classify-2', 'classify-3'],
  ['br-1', 'br-2', 'br-3'],
  ['merge'],
  ['ui-update', 'log-db'],
];

const SIM_LABELS = [
  'Files selected by user',
  'Extracting text from digital PDFs',
  'Edge Function receives batch request',
  'Fan-out: each document starts in parallel',
  'Mistral OCR running on all documents',
  'Classification & summarization in parallel',
  'BR Details extracted (if applicable)',
  'All results merged',
  'UI updated · Usage logged',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
        'border rounded-xl p-3 cursor-pointer transition-all duration-200 select-none',
        c.bg, c.border,
        highlight ? cn('ring-2 ring-offset-1', c.ring) : '',
        !isVisited && !highlight ? 'opacity-50' : '',
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
      <div className={cn('w-px bg-gray-200', small ? 'h-3' : 'h-5')} />
    </div>
  );
}

function ForkSVG() {
  return (
    <svg height="20" className="w-full my-1" viewBox="0 0 300 20" preserveAspectRatio="none">
      <line x1="150" y1="0" x2="150" y2="8" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="50" y1="8" x2="250" y2="8" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="50" y1="8" x2="50" y2="20" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="150" y1="8" x2="150" y2="20" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="250" y1="8" x2="250" y2="20" stroke="#d1d5db" strokeWidth="1.5" />
    </svg>
  );
}

function JoinSVG() {
  return (
    <svg height="20" className="w-full my-1" viewBox="0 0 300 20" preserveAspectRatio="none">
      <line x1="50" y1="0" x2="50" y2="12" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="150" y1="0" x2="150" y2="12" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="250" y1="0" x2="250" y2="12" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="50" y1="12" x2="250" y2="12" stroke="#d1d5db" strokeWidth="1.5" />
      <line x1="150" y1="12" x2="150" y2="20" stroke="#d1d5db" strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProcessingPipeline() {
  const [simStep, setSimStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeNodes = new Set<string>(simStep >= 0 ? SIM_STEPS[simStep] || [] : []);
  const visitedNodes = new Set<string>(simStep >= 0 ? SIM_STEPS.slice(0, simStep + 1).flat() : []);

  const isActive = (id: string) => activeNodes.has(id);
  const isVisited = (id: string) => visitedNodes.has(id) || simStep === -1;

  const handleNodeClick = (id: string) => {
    if (isPlaying) { setIsPlaying(false); }
    setSelectedId((prev) => prev === id ? null : id);
  };

  const startSim = () => {
    setSimStep(0);
    setSelectedId(null);
    setIsPlaying(true);
  };

  const resetSim = () => {
    setIsPlaying(false);
    setSimStep(-1);
    setSelectedId(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => {
      setSimStep((prev) => {
        const next = prev + 1;
        if (next >= SIM_STEPS.length) { setIsPlaying(false); return SIM_STEPS.length - 1; }
        return next;
      });
    }, 1100);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, simStep]);

  const selectedInfo = selectedId
    ? (NODE_INFO[selectedId] || NODE_INFO[selectedId.replace(/-\d$/, '')])
    : null;

  const laneProps = (suffix: string) => ({
    isActive: (id: string) => activeNodes.has(id + suffix),
    isVisited: (id: string) => visitedNodes.has(id + suffix) || simStep === -1,
  });

  return (
    <div className="font-['Inter',sans-serif] space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Processing Pipeline</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Interactive diagram of the Document Processor flow. Click any node to inspect it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {simStep >= 0 && simStep < SIM_LABELS.length && (
            <motion.span
              key={simStep}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[11px] text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full font-medium"
            >
              {SIM_LABELS[simStep]}
            </motion.span>
          )}
          <Button variant="outline" size="sm" onClick={resetSim} disabled={simStep === -1 && !isPlaying} className="h-8 text-[12px] gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={startSim} disabled={isPlaying} className="h-8 text-[12px] gap-1.5 bg-[#DB0011] hover:bg-[#B00010] text-white">
            <Play className="h-3.5 w-3.5" />
            {isPlaying ? 'Running...' : 'Simulate'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Diagram */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 p-5 overflow-x-auto">
          <div className="min-w-[520px]">

            {/* Stage 1: Upload */}
            <NodeCard id="upload" label="Upload Documents" sublabel="PNG · JPG · PDF (max 5 MB)" isActive={isActive('upload')} isVisited={isVisited('upload')} isSelected={selectedId === 'upload'} onClick={handleNodeClick} />

            <VConnector />

            {/* Stage 2: Client extraction */}
            <NodeCard id="client-extract" label="Client-side PDF Text Extraction" sublabel="pdf.js · skipped for images & scanned PDFs" isActive={isActive('client-extract')} isVisited={isVisited('client-extract')} isSelected={selectedId === 'client-extract'} onClick={handleNodeClick} />

            <VConnector />

            {/* Stage 3: Edge Function container */}
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
                <div className="rounded-lg p-1.5 bg-teal-100 shrink-0">
                  <Server className="h-4 w-4 text-teal-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-teal-700">document-processor-agent</p>
                  <p className="text-[10px] text-teal-500">Supabase Edge Function · Deno Runtime</p>
                </div>
                <span className="text-[10px] bg-teal-100 text-teal-700 font-medium px-2 py-0.5 rounded-full border border-teal-200 shrink-0">
                  Promise.all
                </span>
              </div>

              {/* Fork */}
              <ForkSVG />

              {/* Parallel lanes */}
              <div className="grid grid-cols-3 gap-3">
                {(['-1', '-2', '-3'] as const).map((sfx, idx) => {
                  const lp = laneProps(sfx);
                  const docLabel = idx === 2 ? 'Document N' : `Document ${idx + 1}`;
                  return (
                    <div key={sfx} className="space-y-0">
                      <NodeCard id={`doc${sfx}`} label={docLabel} sublabel="base64 + clientText" isActive={lp.isActive('doc')} isVisited={lp.isVisited('doc')} isSelected={selectedId === `doc${sfx}`} onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`ocr${sfx}`} label="Mistral OCR" sublabel="mistral-ocr-latest" isActive={lp.isActive('ocr')} isVisited={lp.isVisited('ocr')} isSelected={selectedId === `ocr${sfx}`} onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`classify${sfx}`} label="Classify + Summarize" sublabel="mistral-small-latest" isActive={lp.isActive('classify')} isVisited={lp.isVisited('classify')} isSelected={selectedId === `classify${sfx}`} onClick={handleNodeClick} />
                      <VConnector small />
                      <NodeCard id={`br${sfx}`} label="BR Details" sublabel="mistral-small-latest" optional isActive={lp.isActive('br')} isVisited={lp.isVisited('br')} isSelected={selectedId === `br${sfx}`} onClick={handleNodeClick} />
                    </div>
                  );
                })}
              </div>

              {/* Join */}
              <JoinSVG />
            </div>

            <VConnector />

            {/* Stage 4: Merge */}
            <NodeCard id="merge" label="Merge All Results" sublabel="collect DocumentResult[] in input order" isActive={isActive('merge')} isVisited={isVisited('merge')} isSelected={selectedId === 'merge'} onClick={handleNodeClick} />

            <VConnector />

            {/* Stage 5: Dual output */}
            <div className="grid grid-cols-2 gap-3">
              <NodeCard id="ui-update" label="Update Frontend UI" sublabel="React state · AnimatePresence" isActive={isActive('ui-update')} isVisited={isVisited('ui-update')} isSelected={selectedId === 'ui-update'} onClick={handleNodeClick} />
              <NodeCard id="log-db" label="Log to llm_usage_logs" sublabel="service_role · usage tracking" isActive={isActive('log-db')} isVisited={isVisited('log-db')} isSelected={selectedId === 'log-db'} onClick={handleNodeClick} />
            </div>
          </div>
        </div>

        {/* Legend + detail panel (right column) */}
        <div className="w-full lg:w-64 xl:w-72 shrink-0 space-y-4">
          {/* Legend */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Legend</p>
            <div className="space-y-2">
              {([
                { color: 'gray',    label: 'Client / Browser' },
                { color: 'blue',    label: 'Client-side processing' },
                { color: 'teal',    label: 'Edge Function scope' },
                { color: 'slate',   label: 'Document agent' },
                { color: 'orange',  label: 'Mistral OCR call' },
                { color: 'sky',     label: 'Mistral analysis call' },
                { color: 'emerald', label: 'Conditional extraction' },
                { color: 'green',   label: 'Database / logging' },
              ] as Array<{ color: keyof typeof COLOR_MAP; label: string }>).map(({ color, label }) => {
                const c = COLOR_MAP[color];
                return (
                  <div key={color} className="flex items-center gap-2">
                    <div className={cn('w-3 h-3 rounded border', c.bg, c.border)} />
                    <span className="text-[11px] text-gray-600">{label}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 mt-1">
                <div className="w-3 h-3 rounded border border-dashed border-gray-300 bg-white" />
                <span className="text-[11px] text-gray-600">Conditional step</span>
              </div>
            </div>
          </div>

          {/* Step progress (during simulation) */}
          {simStep >= 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</p>
              <div className="space-y-1.5">
                {SIM_LABELS.map((label, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0',
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

          {/* Node detail panel */}
          <AnimatePresence mode="wait">
            {selectedInfo && (
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
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
                  <DetailRow label="Tech" value={selectedInfo.tech} />
                  <DetailRow label="Input" value={selectedInfo.input} />
                  <DetailRow label="Output" value={selectedInfo.output} />
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="mt-3 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Dismiss
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {!selectedInfo && simStep === -1 && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-2 text-center">
              <Info className="h-5 w-5 text-gray-300" />
              <p className="text-[11px] text-gray-400">Click any node in the diagram to see its details here.</p>
              <p className="text-[11px] text-gray-400">Press Simulate to watch data flow through the pipeline.</p>
            </div>
          )}
        </div>
      </div>
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
