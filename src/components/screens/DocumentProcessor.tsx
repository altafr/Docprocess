import { useState, useRef, useCallback, Component } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, FileImage, X, SquareCheck as CheckSquare, Square, Play, Loader as Loader2, Tag, Building2, MapPin, Users, Hash, Calendar, Briefcase, ChevronRight, CircleAlert as AlertCircle, Scale, UserCheck, ListChecks, PenLine, Stamp, Clock, RefreshCw, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { callEdgeFunction, supabase } from '@/lib/supabase';
import { extractAndStoreSignatures, StoredSignature } from '@/lib/signatureUtils';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface DuplicateInfo {
  id: string;
  processed_at: string;
  category: string | null;
  summary: string | null;
}

interface DocFile {
  id: string;
  file: File;
  hash: string | null;
  preview: string | null;
  selected: boolean;
  hashChecking: boolean;
  duplicateInfo: DuplicateInfo | null;
  mode: 'process' | 'skip' | 'update';
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ProcessedDoc {
  id: string;
  fileName: string;
  fileSize: number;
  preview: string | null;
  extractedText: string;
  classification: { category: string; confidence: number } | null;
  summary: string;
  keyDataPoints: Record<string, string>;
  brDetails: {
    companyName: string | null;
    address: string | null;
    directors: string[];
    registrationNumber: string | null;
    dateOfIncorporation: string | null;
    businessNature: string | null;
  } | null;
  boardResolutionDetails: {
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
  } | null;
  financialDetails: {
    period: string | null;
    currency: string | null;
    documentType: string | null;
    plainSummary: string | null;
    figures: Record<string, string>;
  } | null;
  visualElements: {
    signatures: Array<{
      name: string | null;
      title: string | null;
      company: string | null;
      type: 'wet-ink' | 'digital' | 'unknown';
      description: string | null;
      boundingBox?: { x: number; y: number; w: number; h: number } | null;
    }>;
    stamps: Array<{
      type: 'company-seal' | 'official-stamp' | 'date-stamp' | 'chop' | 'notary' | 'other';
      text: string | null;
      company: string | null;
      description: string | null;
      boundingBox?: { x: number; y: number; w: number; h: number } | null;
    }>;
    hasSignatures: boolean;
    hasStamps: boolean;
    notes: string | null;
  } | null;
  storedSignatures?: StoredSignature[];
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

const categoryColors: Record<string, string> = {
  'Utility Bill': 'bg-sky-50 text-sky-700 border-sky-200',
  'BR Certificate': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Bank Statement': 'bg-blue-50 text-blue-700 border-blue-200',
  'Invoice': 'bg-amber-50 text-amber-700 border-amber-200',
  'Receipt': 'bg-orange-50 text-orange-700 border-orange-200',
  'Tax Document': 'bg-rose-50 text-rose-700 border-rose-200',
  'Identity Document': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  'Insurance Document': 'bg-teal-50 text-teal-700 border-teal-200',
  'Contract / Agreement': 'bg-slate-50 text-slate-700 border-slate-200',
  'Letter / Correspondence': 'bg-gray-50 text-gray-700 border-gray-200',
  'Financial Report': 'bg-green-50 text-green-700 border-green-200',
  'Application Form': 'bg-lime-50 text-lime-700 border-lime-200',
  'Board Resolution': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Balance Sheet': 'bg-stone-50 text-stone-700 border-stone-200',
  'Profit & Loss Statement': 'bg-pink-50 text-pink-700 border-pink-200',
  'Cash Flow Statement': 'bg-zinc-50 text-zinc-700 border-zinc-200',
  'Other': 'bg-neutral-50 text-neutral-600 border-neutral-200',
};

function getCategoryColor(category: string) {
  return categoryColors[category] || categoryColors['Other'];
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function extractTextFromPDFClient(file: File): Promise<string> {
  const { extractTextFromPDF, isScannedPDF } = await import('@/lib/pdfUtils');
  const text = await extractTextFromPDF(file);
  if (isScannedPDF(text, file)) return '';
  return text;
}

export function DocumentProcessor() {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [processed, setProcessed] = useState<ProcessedDoc[]>([]);
  const [processing, setProcessing] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const selectedCount = files.filter((f) => f.selected).length;
  const allSelected = files.length > 0 && selectedCount === files.length;

  const handleFiles = useCallback(
    (incoming: FileList | File[]) => {
      const newFiles: DocFile[] = [];
      for (const f of Array.from(incoming)) {
        if (f.size > MAX_FILE_SIZE) {
          toast({ title: 'Skipped', description: `${f.name} exceeds 5 MB`, variant: 'destructive' });
          continue;
        }
        const ok = f.type.startsWith('image/') || f.type === 'application/pdf';
        if (!ok) {
          toast({ title: 'Skipped', description: `${f.name} is not a supported file`, variant: 'destructive' });
          continue;
        }
        const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
        newFiles.push({ id: crypto.randomUUID(), file: f, hash: null, preview, selected: true, hashChecking: true, duplicateInfo: null, mode: 'process' });
      }
      if (newFiles.length === 0) return;
      setFiles((prev) => [...prev, ...newFiles]);

      // Async: compute hashes + check DB for duplicates
      (async () => {
        const hashes = await Promise.all(newFiles.map(async (nf) => ({ id: nf.id, hash: await computeFileHash(nf.file) })));
        const hashList = hashes.map((h) => h.hash);
        const { data: existing } = await supabase
          .from('processed_documents')
          .select('id, file_hash, processed_at, category, summary')
          .in('file_hash', hashList);
        const dupMap = new Map((existing ?? []).map((r: any) => [r.file_hash, r as DuplicateInfo & { file_hash: string }]));
        setFiles((prev) =>
          prev.map((f) => {
            const entry = hashes.find((h) => h.id === f.id);
            if (!entry) return f;
            const dup = dupMap.get(entry.hash) ?? null;
            return { ...f, hash: entry.hash, hashChecking: false, duplicateInfo: dup, mode: dup ? 'skip' : 'process' };
          }),
        );
      })();
    },
    [toast],
  );

  const toggleSelect = (id: string) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)));

  const toggleAll = () => {
    const next = !allSelected;
    setFiles((prev) => prev.map((f) => ({ ...f, selected: next })));
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return prev.filter((x) => x.id !== id);
    });
    setProcessed((prev) => prev.filter((x) => x.id !== id));
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const processDocuments = async () => {
    // Only process files that are selected AND not set to skip
    const selected = files.filter((f) => f.selected && f.mode !== 'skip');
    if (selected.length === 0) {
      toast({ title: 'Nothing to process', description: 'All selected documents are set to Skip. Toggle duplicates to Update to reprocess them.' });
      return;
    }

    setProcessing(true);

    // Initialise all selected docs as 'processing' immediately so the UI
    // reflects parallel activity from the start.
    const initial: ProcessedDoc[] = selected.map((f) => ({
      id: f.id,
      fileName: f.file.name,
      fileSize: f.file.size,
      preview: f.preview,
      extractedText: '',
      classification: null,
      summary: '',
      keyDataPoints: {},
      brDetails: null,
      boardResolutionDetails: null,
      financialDetails: null,
      visualElements: null,
      status: 'processing',
    }));
    setProcessed(initial);

    // Build document inputs: extract client-side text for digital PDFs to save
    // an OCR round-trip; images and scanned PDFs go as raw base64 for Mistral OCR.
    // Also render the first page of PDFs to JPEG so the edge function can run
    // Pixtral vision on them and get accurate signature bounding boxes.
    const documentInputs = await Promise.all(
      selected.map(async (doc) => {
        const base64 = await fileToBase64(doc.file);
        let clientText = '';
        let firstPageImage: string | undefined;
        if (doc.file.type === 'application/pdf') {
          clientText = await extractTextFromPDFClient(doc.file);
          try {
            const { convertPDFToImages } = await import('@/lib/pdfUtils');
            const pages = await convertPDFToImages(doc.file, 100);
            if (pages[0]) firstPageImage = pages[0];
          } catch {
            // first page render failed — edge function falls back to text extraction
          }
        }
        return { id: doc.id, base64, fileName: doc.file.name, clientText, firstPageImage };
      }),
    );

    try {
      // Single call — the edge function fans out all documents in parallel
      // using Promise.all internally (agentic orchestration with Mistral OCR).
      const response = await callEdgeFunction('document-processor-agent', {
        documents: documentInputs,
      });

      const results: Array<{
        id: string;
        extractedText: string;
        classification: { category: string; confidence: number } | null;
        summary: string;
        keyDataPoints: Record<string, string>;
        brDetails: ProcessedDoc['brDetails'];
        boardResolutionDetails: ProcessedDoc['boardResolutionDetails'];
        financialDetails: ProcessedDoc['financialDetails'];
        visualElements: ProcessedDoc['visualElements'];
        error?: string;
      }> = response.results || [];

      // Apply each result individually so the table updates all at once
      setProcessed((prev) =>
        prev.map((p) => {
          const result = results.find((r) => r.id === p.id);
          if (!result) return { ...p, status: 'error' as const, error: 'No result returned' };
          if (result.error) return { ...p, status: 'error' as const, error: result.error };
          return {
            ...p,
            extractedText: result.extractedText,
            classification: result.classification,
            summary: result.summary,
            keyDataPoints: result.keyDataPoints,
            brDetails: result.brDetails,
            boardResolutionDetails: result.boardResolutionDetails,
            financialDetails: result.financialDetails,
            visualElements: result.visualElements ?? null,
            status: 'done' as const,
          };
        }),
      );

      const errorCount = results.filter((r) => r.error).length;
      if (errorCount > 0) {
        toast({
          title: 'Batch complete with errors',
          description: `${selected.length - errorCount} succeeded, ${errorCount} failed`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Batch complete', description: `Processed ${selected.length} document(s) in parallel` });
      }

      // Record processing history — upsert by file_hash so updates replace old entries
      const historyRows = results
        .filter((r) => !r.error)
        .map((r) => {
          const doc = selected.find((f) => f.id === r.id);
          if (!doc?.hash) return null;
          return {
            file_name: doc.file.name,
            file_hash: doc.hash,
            file_size: doc.file.size,
            category: r.classification?.category ?? null,
            summary: r.summary ?? null,
            processed_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);
      if (historyRows.length > 0) {
        await supabase
          .from('processed_documents')
          .upsert(historyRows, { onConflict: 'file_hash' });
        // Fire-and-forget: index new documents for semantic search
        callEdgeFunction('embed-documents', { force: false }).catch(() => {});
        // Mark files as no-longer-duplicate in the sidebar
        setFiles((prev) =>
          prev.map((f) => {
            const row = historyRows.find((h) => h && h.file_hash === f.hash);
            if (!row) return f;
            return { ...f, duplicateInfo: { id: '', processed_at: row.processed_at, category: row.category, summary: row.summary }, mode: 'skip' };
          }),
        );
      }

      // Async: crop & upload signatures/stamps — updates UI when done, never blocks
      (async () => {
        try {
          // Map fileName → board_resolution DB id so cropped images can be linked
          const { data: brRows } = await supabase
            .from('board_resolutions')
            .select('id, document_name')
            .in('document_name', selected.map((f) => f.file.name));
          const fileNameToBrId = new Map((brRows ?? []).map((r: any) => [r.document_name, r.id]));
          const brIdMap = new Map<string, string>();
          for (const doc of selected) {
            const brId = fileNameToBrId.get(doc.file.name);
            if (brId) brIdMap.set(doc.id, brId);
          }

          const storedMap = await extractAndStoreSignatures(
            results.map((r) => ({
              id: r.id,
              visualElements: r.visualElements as any,
              boardResolutionDetails: r.boardResolutionDetails,
              error: r.error,
            })),
            selected.map((f) => ({ id: f.id, file: f.file })),
            brIdMap,
          );

          if (storedMap.size > 0) {
            setProcessed((prev) =>
              prev.map((p) => {
                const sigs = storedMap.get(p.id);
                return sigs ? { ...p, storedSignatures: sigs } : p;
              }),
            );
          }
        } catch (e) {
          console.error('Signature extraction error:', e);
        }
      })();
    } catch (err: any) {
      setProcessed((prev) =>
        prev.map((p) => ({ ...p, status: 'error' as const, error: err.message || 'Processing failed' })),
      );
      toast({ title: 'Processing failed', description: err.message || 'Unknown error', variant: 'destructive' });
    }

    setProcessing(false);
  };

  const processingCount = processed.filter((p) => p.status === 'processing').length;
  const toProcessCount = files.filter((f) => f.selected && f.mode !== 'skip').length;
  const duplicateCount = files.filter((f) => f.duplicateInfo).length;

  return (
    <div className="font-['Inter',sans-serif] space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Document Processor</h2>
        <p className="text-[13px] text-gray-500 mt-1">
          Upload multiple documents, then classify, extract and summarise in one go.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* -------- Left: file sidebar -------- */}
        <motion.div
          layout
          className="w-full lg:w-72 xl:w-80 shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col"
          style={{ maxHeight: 'calc(100vh - 180px)' }}
        >
          {/* Upload zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50/60 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            <div className="flex flex-col items-center gap-1.5 py-3">
              <Upload className="h-5 w-5 text-gray-400" />
              <p className="text-[12px] font-medium text-gray-600">Drop files or click to upload</p>
              <p className="text-[11px] text-gray-400">PNG, JPG, PDF -- max 5 MB each</p>
            </div>
          </div>

          {/* Toolbar */}
          {files.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/50">
              <button onClick={toggleAll} className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-800 transition-colors">
                {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-[11px] text-gray-400">{selectedCount}/{files.length} selected</span>
            </div>
          )}

          {/* File list */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence>
              {files.map((f) => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className={`flex flex-col px-3 py-2.5 border-b border-gray-50 transition-colors ${
                    f.selected && f.mode !== 'skip' ? 'bg-red-50/40' :
                    f.duplicateInfo ? 'bg-amber-50/30' :
                    'hover:bg-gray-50/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => toggleSelect(f.id)}>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(f.id); }}
                      className="shrink-0"
                    >
                      {f.selected ? (
                        <CheckSquare className="h-4 w-4 text-[#DB0011]" />
                      ) : (
                        <Square className="h-4 w-4 text-gray-300" />
                      )}
                    </button>

                    {f.preview ? (
                      <img src={f.preview} alt="" className="h-8 w-8 rounded object-cover shrink-0 border border-gray-200" />
                    ) : (
                      <div className="h-8 w-8 rounded bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-gray-400" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-gray-800 truncate">{f.file.name}</p>
                      <p className="text-[10px] text-gray-400">{(f.file.size / 1024).toFixed(0)} KB</p>
                    </div>

                    {f.hashChecking && (
                      <Loader2 className="h-3 w-3 animate-spin text-gray-300 shrink-0" />
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                      className="shrink-0 p-1 rounded hover:bg-gray-200/60 transition-colors"
                    >
                      <X className="h-3.5 w-3.5 text-gray-400" />
                    </button>
                  </div>

                  {/* Duplicate warning + mode toggle */}
                  {f.duplicateInfo && !f.hashChecking && (
                    <div className="mt-1.5 ml-8 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-amber-600">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="text-[10px]">
                          Processed {new Date(f.duplicateInfo.processed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {f.duplicateInfo.category ? ` · ${f.duplicateInfo.category}` : ''}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiles((prev) => prev.map((ff) => ff.id === f.id ? { ...ff, mode: ff.mode === 'skip' ? 'update' : 'skip' } : ff));
                        }}
                        className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${
                          f.mode === 'skip'
                            ? 'bg-gray-50 text-gray-400 border-gray-200 hover:border-amber-300 hover:text-amber-600'
                            : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        {f.mode === 'skip' ? (
                          <><SkipForward className="h-2.5 w-2.5" />Skip</>
                        ) : (
                          <><RefreshCw className="h-2.5 w-2.5" />Update</>
                        )}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {files.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <FileImage className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-[12px]">No documents yet</p>
              </div>
            )}
          </div>

          {/* Process button */}
          {files.length > 0 && (
            <div className="p-3 border-t border-gray-100 space-y-1.5">
              {duplicateCount > 0 && !processing && (
                <p className="text-[10px] text-amber-600 text-center">
                  {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} detected — set to Skip by default
                </p>
              )}
              <Button
                onClick={processDocuments}
                disabled={processing || selectedCount === 0}
                className="w-full bg-[#DB0011] hover:bg-[#B00010] text-white text-[13px] font-medium h-9"
              >
                {processing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                {processing
                  ? `Processing ${processingCount} document${processingCount !== 1 ? 's' : ''} in parallel...`
                  : `Process ${toProcessCount} document${toProcessCount !== 1 ? 's' : ''}`}
              </Button>
            </div>
          )}
        </motion.div>

        {/* -------- Right: results area -------- */}
        <div className="flex-1 min-w-0">
          {processed.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-64 text-gray-400"
            >
              <Tag className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-[13px] font-medium">Results will appear here</p>
              <p className="text-[11px] mt-1">Upload documents, select them, and press Process</p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {/* Summary table */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                {/* Table header */}
                <div className="grid grid-cols-[1fr_140px_1fr_48px] md:grid-cols-[minmax(0,1.2fr)_140px_minmax(0,2fr)_48px] gap-0 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Document</span>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Category</span>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:block">Summary</span>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Info</span>
                </div>

                <AnimatePresence>
                  {processed.map((doc, idx) => (
                    <motion.div
                      key={doc.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      {/* Table row */}
                      <div
                        className={`grid grid-cols-[1fr_140px_1fr_48px] md:grid-cols-[minmax(0,1.2fr)_140px_minmax(0,2fr)_48px] gap-0 px-4 py-3 border-b border-gray-50 items-center transition-colors ${
                          expandedDoc === doc.id ? 'bg-gray-50/60' : 'hover:bg-gray-50/40'
                        }`}
                      >
                        {/* File info */}
                        <div className="flex items-center gap-2.5 min-w-0 pr-3">
                          {doc.preview ? (
                            <img src={doc.preview} alt="" className="h-9 w-9 rounded-md object-cover shrink-0 border border-gray-200" />
                          ) : (
                            <div className="h-9 w-9 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                              <FileText className="h-4 w-4 text-gray-400" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-gray-800 truncate">{doc.fileName}</p>
                            <p className="text-[10px] text-gray-400">{(doc.fileSize / 1024).toFixed(0)} KB</p>
                          </div>
                        </div>

                        {/* Category */}
                        <div className="pr-3">
                          {doc.status === 'processing' ? (
                            <div className="flex items-center gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                              <span className="text-[11px] text-gray-400">Analyzing...</span>
                            </div>
                          ) : doc.status === 'error' ? (
                            <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-600">Error</Badge>
                          ) : doc.status === 'done' && doc.classification ? (
                            <span className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border ${getCategoryColor(doc.classification.category)}`}>
                              {doc.classification.category}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-300">--</span>
                          )}
                        </div>

                        {/* Summary */}
                        <div className="pr-3 hidden md:block">
                          {doc.status === 'done' && doc.summary ? (
                            <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-2">{doc.summary}</p>
                          ) : doc.status === 'processing' ? (
                            <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
                          ) : doc.status === 'error' ? (
                            <p className="text-[11px] text-red-500 truncate">{doc.error}</p>
                          ) : (
                            <span className="text-[11px] text-gray-300">--</span>
                          )}
                        </div>

                        {/* Expand */}
                        <div className="flex justify-center">
                          {doc.status === 'done' ? (
                            <button
                              onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                              className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
                            >
                              <motion.div animate={{ rotate: expandedDoc === doc.id ? 90 : 0 }}>
                                <ChevronRight className="h-4 w-4 text-gray-400" />
                              </motion.div>
                            </button>
                          ) : doc.status === 'processing' ? (
                            <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
                          ) : doc.status === 'error' ? (
                            <AlertCircle className="h-4 w-4 text-red-400" />
                          ) : (
                            <span className="h-4 w-4" />
                          )}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      <AnimatePresence>
                        {expandedDoc === doc.id && doc.status === 'done' && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <DocDetailErrorBoundary docId={doc.id}>
                              <ExpandedDocDetail doc={doc} />
                            </DocDetailErrorBoundary>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Catches render errors inside any document detail tab so one bad document
// can never crash the whole processor view.
class DocDetailErrorBoundary extends Component<
  { docId: string; children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { docId: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { docId: string }) {
    if (prev.docId !== this.props.docId && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="px-4 py-4 bg-gray-50/40 border-b border-gray-100">
          <div className="flex items-start gap-2.5 px-3 py-3 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[12px] font-medium text-red-700">Could not display document details</p>
              <p className="text-[11px] text-red-500 mt-0.5">{this.state.error.message}</p>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ExpandedDocDetail({ doc }: { doc: ProcessedDoc }) {
  const FINANCIAL_CATEGORIES = ['Balance Sheet', 'Profit & Loss Statement', 'Cash Flow Statement'];
  const [tab, setTab] = useState<'data' | 'text' | 'business' | 'resolution' | 'financials' | 'visuals'>('data');
  const hasBR = doc.classification?.category === 'BR Certificate' && doc.brDetails;
  const hasBoardRes = doc.classification?.category === 'Board Resolution' && doc.boardResolutionDetails;
  const hasVisuals = doc.classification?.category === 'Board Resolution';
  const hasFinancials = doc.financialDetails && doc.classification?.category && FINANCIAL_CATEGORIES.includes(doc.classification.category);

  const storedSigs = (doc.storedSignatures ?? []).filter((s) => s.element_type === 'signature');
  const storedSeals = (doc.storedSignatures ?? []).filter((s) => s.element_type !== 'signature');
  const hasStoredImages = (doc.storedSignatures?.length ?? 0) > 0;

  return (
    <div className="px-4 py-4 bg-gray-50/40 border-b border-gray-100">
      {/* Mobile summary */}
      {doc.summary && (
        <p className="text-[11px] text-gray-600 leading-relaxed mb-3 md:hidden">{doc.summary}</p>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {[
          { id: 'data' as const, label: 'Key Data' },
          ...(hasBR ? [{ id: 'business' as const, label: 'Business Details' }] : []),
          ...(hasBoardRes ? [{ id: 'resolution' as const, label: 'Board Resolution' }] : []),
          ...(hasVisuals ? [{
            id: 'visuals' as const,
            label: `Signatures & Stamps${doc.visualElements?.signatures.length || doc.visualElements?.stamps.length ? ` (${(doc.visualElements?.signatures.length ?? 0) + (doc.visualElements?.stamps.length ?? 0)})` : ''}`,
          }] : []),
          ...(hasFinancials ? [{ id: 'financials' as const, label: 'Financials' }] : []),
          { id: 'text' as const, label: 'Full Text' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'data' && (
          <motion.div
            key="data"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {Object.keys(doc.keyDataPoints ?? {}).length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(doc.keyDataPoints ?? {}).map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5 px-3 py-2 bg-white rounded-lg border border-gray-200">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">{label}</span>
                    <span className="text-[12px] text-gray-800 font-medium">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 py-4 text-center">No structured data points extracted.</p>
            )}
          </motion.div>
        )}

        {tab === 'business' && hasBR && doc.brDetails && (
          <motion.div
            key="business"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            {doc.brDetails.companyName && (
              <DetailRow icon={Building2} label="Company Name" value={doc.brDetails.companyName} />
            )}
            {doc.brDetails.registrationNumber && (
              <DetailRow icon={Hash} label="Registration No." value={doc.brDetails.registrationNumber} />
            )}
            {doc.brDetails.address && (
              <DetailRow icon={MapPin} label="Registered Address" value={doc.brDetails.address} />
            )}
            {(doc.brDetails.directors ?? []).length > 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                <Users className="h-4 w-4 text-[#DB0011] mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Directors</p>
                  <ul className="mt-1 space-y-0.5">
                    {(doc.brDetails.directors ?? []).map((d, i) => (
                      <li key={i} className="text-[12px] text-gray-800">{safeStr(d)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {doc.brDetails.dateOfIncorporation && (
              <DetailRow icon={Calendar} label="Date of Incorporation" value={doc.brDetails.dateOfIncorporation} />
            )}
            {doc.brDetails.businessNature && (
              <DetailRow icon={Briefcase} label="Nature of Business" value={doc.brDetails.businessNature} />
            )}
          </motion.div>
        )}

        {tab === 'resolution' && hasBoardRes && doc.boardResolutionDetails && (
          <motion.div
            key="resolution"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {doc.boardResolutionDetails.companyName && (
                <DetailRow icon={Building2} label="Company" value={doc.boardResolutionDetails.companyName} />
              )}
              {doc.boardResolutionDetails.resolutionNumber && (
                <DetailRow icon={Hash} label="Resolution No." value={doc.boardResolutionDetails.resolutionNumber} />
              )}
              {doc.boardResolutionDetails.resolutionDate && (
                <DetailRow icon={Calendar} label="Resolution Date" value={doc.boardResolutionDetails.resolutionDate} />
              )}
              {doc.boardResolutionDetails.resolutionType && (
                <DetailRow icon={Scale} label="Type" value={doc.boardResolutionDetails.resolutionType} />
              )}
              {doc.boardResolutionDetails.effectiveDate && (
                <DetailRow icon={Calendar} label="Effective Date" value={doc.boardResolutionDetails.effectiveDate} />
              )}
              {doc.boardResolutionDetails.expiryDate && (
                <DetailRow icon={Calendar} label="Expiry Date" value={doc.boardResolutionDetails.expiryDate} />
              )}
            </div>
            {doc.boardResolutionDetails.purposeSummary && (
              <div className="px-3 py-2.5 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-[10px] font-medium text-yellow-700 uppercase tracking-wider mb-1">Purpose</p>
                <p className="text-[12px] text-gray-800 leading-relaxed">{doc.boardResolutionDetails.purposeSummary}</p>
              </div>
            )}
            {(doc.boardResolutionDetails.keyDecisions ?? []).length > 0 && (
              <div className="px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center gap-1.5 mb-2">
                  <ListChecks className="h-3.5 w-3.5 text-[#DB0011]" />
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Key Decisions</p>
                </div>
                <ul className="space-y-1.5">
                  {(doc.boardResolutionDetails.keyDecisions ?? []).map((d, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#DB0011] shrink-0" />
                      <span className="text-[12px] text-gray-800 leading-relaxed">{safeStr(d)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(doc.boardResolutionDetails.authorizedPersons ?? []).length > 0 && (
              <div className="px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center gap-1.5 mb-2">
                  <UserCheck className="h-3.5 w-3.5 text-[#DB0011]" />
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Authorized Persons</p>
                </div>
                <ul className="space-y-0.5">
                  {(doc.boardResolutionDetails.authorizedPersons ?? []).map((p, i) => (
                    <li key={i} className="text-[12px] text-gray-800">{safeStr(p)}</li>
                  ))}
                </ul>
              </div>
            )}
            {(doc.boardResolutionDetails.signatories ?? []).length > 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                <Users className="h-4 w-4 text-[#DB0011] mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Signatories</p>
                  <ul className="mt-1 space-y-0.5">
                    {(doc.boardResolutionDetails.signatories ?? []).map((s, i) => (
                      <li key={i} className="text-[12px] text-gray-800">{safeStr(s)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {tab === 'financials' && hasFinancials && doc.financialDetails && (
          <motion.div
            key="financials"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {/* Period + currency header */}
            {(doc.financialDetails.period || doc.financialDetails.currency) && (
              <div className="flex items-center gap-3 flex-wrap">
                {doc.financialDetails.period && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
                    <Calendar className="h-3 w-3 text-gray-400" />
                    {doc.financialDetails.period}
                  </span>
                )}
                {doc.financialDetails.currency && (
                  <span className="inline-flex text-[11px] font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                    {doc.financialDetails.currency}
                  </span>
                )}
              </div>
            )}

            {/* Plain-English summary */}
            {doc.financialDetails.plainSummary && (
              <div className="px-3.5 py-3 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-[12px] text-blue-900 leading-relaxed">{doc.financialDetails.plainSummary}</p>
              </div>
            )}

            {/* Financial figures grid */}
            {Object.keys(doc.financialDetails.figures ?? {}).length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(doc.financialDetails.figures ?? {}).map(([label, value]) => {
                  const isNegative = /^-|\(/.test(String(value).trim());
                  return (
                    <div key={label} className="flex items-center justify-between gap-2 px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                      <span className="text-[11px] text-gray-500 leading-tight">{label}</span>
                      <span className={`text-[13px] font-semibold tabular-nums shrink-0 ${isNegative ? 'text-rose-600' : 'text-gray-900'}`}>
                        {value}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 py-4 text-center">No financial figures extracted.</p>
            )}
          </motion.div>
        )}

        {tab === 'visuals' && hasVisuals && (
          <motion.div
            key="visuals"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {!doc.visualElements ? (
              <div className="flex items-center gap-2 py-6 justify-center">
                <AlertCircle className="h-4 w-4 text-gray-300" />
                <p className="text-[12px] text-gray-400">Visual element extraction not yet available for this document.</p>
              </div>
            ) : !doc.visualElements.hasSignatures && !doc.visualElements.hasStamps ? (
              <div className="flex flex-col items-center gap-1.5 py-6">
                <p className="text-[12px] text-gray-400">No signatures or stamps detected in this document.</p>
                {doc.visualElements.notes && (
                  <p className="text-[11px] text-gray-400 italic text-center max-w-xs">{doc.visualElements.notes}</p>
                )}
              </div>
            ) : (
              <>
                {/* Extracted PNG thumbnails — shown when bounding boxes were captured */}
                {hasStoredImages && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Extracted Images</p>
                    <div className="flex flex-wrap gap-3">
                      {storedSigs.map((s) => (
                        <div key={s.id} className="flex flex-col items-center gap-1">
                          <div className="rounded-lg border border-blue-200 bg-blue-50 overflow-hidden w-28 h-16 flex items-center justify-center">
                            <img
                              src={s.storage_url ?? ''}
                              alt={s.person_name ?? 'Signature'}
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                          <span className="text-[10px] text-gray-500 max-w-[7rem] truncate text-center">
                            {s.person_name ?? 'Signature'}
                          </span>
                        </div>
                      ))}
                      {storedSeals.map((s) => (
                        <div key={s.id} className="flex flex-col items-center gap-1">
                          <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden w-16 h-16 flex items-center justify-center">
                            <img
                              src={s.storage_url ?? ''}
                              alt={s.person_name ?? s.element_type}
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                          <span className="text-[10px] text-amber-700 max-w-[4rem] truncate text-center capitalize">
                            {s.element_type}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 mb-1 border-t border-gray-100" />
                  </div>
                )}

                {/* Signatures */}
                {doc.visualElements.signatures.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <PenLine className="h-3.5 w-3.5 text-[#DB0011]" />
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                        Signatures ({doc.visualElements.signatures.length})
                      </p>
                    </div>
                    <div className="space-y-2">
                      {doc.visualElements.signatures.map((sig, i) => (
                        <div key={i} className="flex items-start gap-3 px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                          <div className={`mt-0.5 shrink-0 h-2 w-2 rounded-full ${
                            sig.type === 'wet-ink' ? 'bg-blue-500' : sig.type === 'digital' ? 'bg-emerald-500' : 'bg-gray-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            {sig.name && <p className="text-[12px] font-semibold text-gray-900">{safeStr(sig.name)}</p>}
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              {sig.title && <span className="text-[11px] text-gray-500">{safeStr(sig.title)}</span>}
                              {sig.company && <span className="text-[11px] text-gray-400">· {safeStr(sig.company)}</span>}
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${
                                sig.type === 'wet-ink' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                sig.type === 'digital' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                'bg-gray-50 text-gray-500 border-gray-200'
                              }`}>
                                {sig.type === 'wet-ink' ? 'Wet Ink' : sig.type === 'digital' ? 'Digital' : 'Unknown'}
                              </span>
                            </div>
                            {sig.description && !sig.name && (
                              <p className="text-[11px] text-gray-500 mt-0.5 italic">{safeStr(sig.description)}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stamps */}
                {doc.visualElements.stamps.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Stamp className="h-3.5 w-3.5 text-[#DB0011]" />
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                        Stamps & Seals ({doc.visualElements.stamps.length})
                      </p>
                    </div>
                    <div className="space-y-2">
                      {doc.visualElements.stamps.map((stamp, i) => {
                        const stampLabel: Record<string, string> = {
                          'company-seal': 'Company Seal',
                          'official-stamp': 'Official Stamp',
                          'date-stamp': 'Date Stamp',
                          'chop': 'Company Chop',
                          'notary': 'Notary Seal',
                          'other': 'Stamp',
                        };
                        return (
                          <div key={i} className="flex items-start gap-3 px-3 py-2.5 bg-white rounded-lg border border-gray-200">
                            <div className="mt-0.5 shrink-0 h-2 w-2 rounded-full bg-amber-500" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                                  {stampLabel[stamp.type] ?? 'Stamp'}
                                </span>
                                {stamp.company && <span className="text-[12px] font-medium text-gray-800">{safeStr(stamp.company)}</span>}
                              </div>
                              {stamp.text && <p className="text-[11px] text-gray-600 mt-0.5 font-mono">{safeStr(stamp.text)}</p>}
                              {stamp.description && <p className="text-[11px] text-gray-400 mt-0.5 italic">{safeStr(stamp.description)}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* AI observations */}
                {doc.visualElements.notes && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 rounded-lg border border-amber-200">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-amber-800 leading-relaxed">{doc.visualElements.notes}</p>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}

        {tab === 'text' && (          <motion.div
            key="text"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="max-h-60 overflow-y-auto bg-white rounded-lg border border-gray-200 p-3">
              <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                {doc.extractedText || 'No text extracted.'}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: unknown }) {
  const display = safeStr(value);
  if (!display) return null;
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 bg-white rounded-lg border border-gray-200">
      <Icon className="h-4 w-4 text-[#DB0011] mt-0.5 shrink-0" />
      <div>
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-[12px] text-gray-800 font-medium mt-0.5">{display}</p>
      </div>
    </div>
  );
}

// Converts any value — including LLM-returned objects — to a display string.
function safeStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const named = o.name ?? o.fullName ?? o.text ?? o.value ?? o.description;
    if (named !== undefined) return safeStr(named);
    return Object.values(o)
      .filter((x) => x !== null && x !== undefined && typeof x !== 'object')
      .map(String)
      .join(', ');
  }
  return String(v);
}
