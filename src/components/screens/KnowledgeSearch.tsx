import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Search, FileText, ScrollText, ShieldCheck, ExternalLink, Clock,
  ChevronDown, ChevronRight, X, CircleAlert as AlertCircle,
  Loader as Loader2, Sparkles, Database, ChevronUp, History, Trash2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamEdgeFunction, callEdgeFunction } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type SourceType = 'board_resolution' | 'processed_document' | 'company_mandate';

interface SearchResult {
  id: string;
  source: SourceType;
  rank: number;
  title: string;
  subtitle: string;
  snippet: string;
  metadata: Record<string, string | null>;
  created_at: string;
  searchMode?: 'semantic' | 'keyword';
}

const SOURCE_CONFIG: Record<SourceType, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.FC<{ className?: string }>;
  tab: string;
}> = {
  board_resolution: {
    label: 'Board Resolution', color: 'text-amber-700',
    bg: 'bg-amber-50', border: 'border-amber-200',
    icon: ScrollText, tab: 'boardresolutions',
  },
  processed_document: {
    label: 'Processed Document', color: 'text-blue-700',
    bg: 'bg-blue-50', border: 'border-blue-200',
    icon: FileText, tab: 'docprocessor',
  },
  company_mandate: {
    label: 'Company Mandate', color: 'text-green-700',
    bg: 'bg-green-50', border: 'border-green-200',
    icon: ShieldCheck, tab: 'companyMandates',
  },
};

const SOURCE_FILTERS: { id: SourceType; label: string }[] = [
  { id: 'board_resolution',   label: 'Board Resolutions' },
  { id: 'processed_document', label: 'Documents' },
  { id: 'company_mandate',    label: 'Mandates' },
];

interface KnowledgeSearchProps {
  onNavigate?: (tab: string) => void;
}

// ── History ───────────────────────────────────────────────────────────────────
interface HistoryEntry {
  id: string;
  query: string;
  timestamp: string;
  searchMode: 'semantic' | 'hybrid' | 'keyword' | null;
  resultsCount: number;
  answerSnippet: string;
  sources: SourceType[];
}

const HISTORY_LS_KEY = 'ks_search_history';
const HISTORY_MAX    = 50;

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_LS_KEY) ?? '[]'); }
  catch { return []; }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_LS_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
}

export function KnowledgeSearch({ onNavigate }: KnowledgeSearchProps) {
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState<SearchResult[]>([]);
  const [lastQuery, setLastQuery]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [indexing, setIndexing]       = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [searched, setSearched]       = useState(false);
  const [searchMode, setSearchMode]   = useState<'semantic' | 'hybrid' | 'keyword' | null>(null);
  const [answer, setAnswer]           = useState('');
  const [streaming, setStreaming]     = useState(false);
  const [streamDone, setStreamDone]   = useState(false);
  const [references, setReferences]   = useState<SearchResult[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeSources, setActiveSources] = useState<Set<SourceType>>(
    new Set(['board_resolution', 'processed_document', 'company_mandate'])
  );
  const [history, setHistory]           = useState<HistoryEntry[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen]   = useState(false);
  const inputRef          = useRef<HTMLInputElement>(null);
  const abortRef          = useRef<AbortController | null>(null);
  const currentSearchIdRef = useRef<string>('');

  // Cancel any in-flight stream when component unmounts
  useEffect(() => () => abortRef.current?.abort(), []);

  // Save to history when a search completes
  useEffect(() => {
    if (!streamDone || !lastQuery || !answer) return;
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      query: lastQuery,
      timestamp: new Date().toISOString(),
      searchMode,
      resultsCount: results.length,
      answerSnippet: answer.slice(0, 120).replace(/[#*`]/g, ''),
      sources: Array.from(activeSources),
    };
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => h.query !== lastQuery)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }, [streamDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    // Cancel any previous in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current  = controller;

    // Hard 35-second client-side timeout
    const timeoutId = setTimeout(() => controller.abort(), 35_000);

    // Use a search ID to discard results from stale concurrent calls
    const searchId = crypto.randomUUID();
    currentSearchIdRef.current = searchId;

    setLoading(true);
    setStreaming(false);
    setStreamDone(false);
    setError(null);
    setSearched(true);
    setLastQuery(trimmed);
    setAnswer('');
    setResults([]);
    setReferences([]);
    setShowSources(false);

    let localAnswer = '';

    try {
      const response = await streamEdgeFunction(
        'knowledge-search',
        { query: trimmed, sources: Array.from(activeSources), limit: 20, stream: true },
        controller.signal,
      );

      if (currentSearchIdRef.current !== searchId) return;

      const reader  = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf       = '';
      let eventType = '';

      setLoading(false);
      setStreaming(true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (currentSearchIdRef.current !== searchId) { reader.cancel(); break; }

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'results') {
                setResults(data.results ?? []);
                setSearchMode(data.searchMode ?? 'keyword');
              } else if (eventType === 'chunk') {
                localAnswer += data.text ?? '';
                setAnswer(localAnswer);
              } else if (eventType === 'done') {
                setReferences(data.references ?? []);
                setStreamDone(true);
                setStreaming(false);
              } else if (eventType === 'error') {
                setError(data.message ?? 'Search service error');
              }
            } catch { /* ignore malformed SSE payloads */ }
            eventType = '';
          }
        }
      }
    } catch (err: any) {
      if (currentSearchIdRef.current !== searchId) return;
      if (err.name === 'AbortError') {
        setError('Search timed out — please try again.');
      } else {
        setError(err.message ?? 'Search failed');
      }
    } finally {
      clearTimeout(timeoutId);
      if (currentSearchIdRef.current === searchId) {
        setLoading(false);
        setStreaming(false);
        // If the stream ended without a `done` event but we have an answer, unblock the UI
        if (localAnswer) setStreamDone(true);
      }
    }
  }, [activeSources]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') runSearch(query);
  };

  const clearSearch = () => {
    abortRef.current?.abort();
    setQuery('');
    setResults([]);
    setAnswer('');
    setReferences([]);
    setSearched(false);
    setStreamDone(false);
    setStreaming(false);
    setError(null);
    setSearchMode(null);
    inputRef.current?.focus();
  };

  const runIndex = async () => {
    setIndexing(true);
    try { await callEdgeFunction('embed-documents', { force: false }); }
    finally { setIndexing(false); }
  };

  const toggleSource = (src: SourceType) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(src) && next.size === 1) return prev;
      next.has(src) ? next.delete(src) : next.add(src);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const grouped = SOURCE_FILTERS.map((f) => ({
    ...f,
    items: results.filter((r) => r.source === f.id),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Search</h1>
          <p className="text-gray-500 text-sm mt-1">
            Ask anything about board resolutions, company mandates, and processed documents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistoryOpen(true)}
            title="Search history"
            className="relative flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
          >
            <History className="h-4 w-4" />
            History
            {history.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#DB0011] text-white text-xs flex items-center justify-center font-medium">
                {history.length > 9 ? '9+' : history.length}
              </span>
            )}
          </button>
          <button
            onClick={runIndex}
            disabled={indexing}
            title="Generate semantic embeddings for unindexed documents"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {indexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {indexing ? 'Indexing…' : 'Re-index'}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Ask a question — e.g. "Who has sole signing authority at HSBC?" or "Show all board resolutions from 2024"'
          className="w-full pl-12 pr-28 py-4 rounded-xl border border-gray-200 bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0011]/30 focus:border-[#DB0011] transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button onClick={clearSearch} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => runSearch(query)}
            disabled={!query.trim() || loading || streaming}
            className="px-4 py-2 rounded-lg bg-[#DB0011] text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ask'}
          </button>
        </div>
      </div>

      {/* Source filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Sources:</span>
        {SOURCE_FILTERS.map((f) => {
          const cfg    = SOURCE_CONFIG[f.id];
          const active = activeSources.has(f.id);
          return (
            <button
              key={f.id}
              onClick={() => toggleSource(f.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                active ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
              )}
            >
              <cfg.icon className="h-3 w-3" />
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm mb-6">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Initial empty state */}
      {!searched && !loading && <EmptyState />}

      {/* Loading (pre-results) */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">Searching knowledge base…</span>
        </div>
      )}

      {/* AI Answer panel */}
      {searched && !loading && (answer || streaming) && (
        <AiAnswerPanel
          answer={answer}
          streaming={streaming}
          streamDone={streamDone}
          searchMode={searchMode}
          references={references}
          resultsCount={results.length}
          lastQuery={lastQuery}
          showSources={showSources}
          onToggleSources={() => setShowSources((v) => !v)}
          onNavigate={onNavigate}
        />
      )}

      {/* No results */}
      {searched && !loading && !streaming && !answer && results.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
          <Search className="h-8 w-8" />
          <p className="text-sm font-medium">No results for "{lastQuery}"</p>
          <p className="text-xs">Try different keywords or click Re-index if documents were recently added.</p>
        </div>
      )}

      {/* Source document cards */}
      <AnimatePresence>
        {showSources && grouped.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 flex flex-col gap-8 overflow-hidden"
          >
            {grouped.map((group) => (
              <ResultGroup
                key={group.id}
                label={group.label}
                sourceType={group.id}
                items={group.items}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpand}
                onNavigate={onNavigate}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* History drawer */}
      <HistoryDrawer
        open={historyOpen}
        history={history}
        onClose={() => setHistoryOpen(false)}
        onSelect={(q) => { setHistoryOpen(false); setQuery(q); runSearch(q); }}
        onDelete={(id) => setHistory((prev) => { const n = prev.filter((h) => h.id !== id); saveHistory(n); return n; })}
        onClearAll={() => { setHistory([]); saveHistory([]); }}
      />
    </div>
  );
}

// ── AI Answer panel ────────────────────────────────────────────────────────────
interface AiAnswerPanelProps {
  answer: string;
  streaming: boolean;
  streamDone: boolean;
  searchMode: 'semantic' | 'hybrid' | 'keyword' | null;
  references: SearchResult[];
  resultsCount: number;
  lastQuery: string;
  showSources: boolean;
  onToggleSources: () => void;
  onNavigate?: (tab: string) => void;
}

function AiAnswerPanel({
  answer, streaming, streamDone, searchMode,
  references, resultsCount, lastQuery,
  showSources, onToggleSources, onNavigate,
}: AiAnswerPanelProps) {
  const answerEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming) answerEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [answer, streaming]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-2">
      {/* Panel header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100">
        <div className="p-1.5 rounded-lg bg-[#DB0011]/10">
          <Sparkles className="h-4 w-4 text-[#DB0011]" />
        </div>
        <span className="text-sm font-semibold text-gray-800 flex-1">AI Answer</span>
        <div className="flex items-center gap-2">
          {searchMode && <SearchModeBadge mode={searchMode} />}
          {streaming && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
            </span>
          )}
        </div>
      </div>

      {/* Streamed markdown answer */}
      <div className="px-6 py-5">
        <div className="prose prose-sm max-w-none text-gray-800 prose-a:no-underline prose-headings:text-gray-900">
          <ReactMarkdown
            remarkPlugins={[remarkGfm as any]}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith('ks://')) {
                  const [id, source] = href.slice(5).split('/');
                  return (
                    <ReferenceChip
                      id={id}
                      source={source as SourceType}
                      label={String(children)}
                      onNavigate={onNavigate}
                    />
                  );
                }
                return <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#DB0011] hover:underline">{children}</a>;
              },
            }}
          >
            {answer}
          </ReactMarkdown>
          {streaming && <span className="inline-block w-2 h-4 ml-0.5 bg-[#DB0011] animate-pulse rounded-sm align-middle" />}
          <div ref={answerEndRef} />
        </div>
      </div>

      {/* Footer: references + show sources toggle */}
      {streamDone && (
        <div className="px-6 pb-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-50 pt-4">
          {references.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Sources:</span>
              {references.map((ref) => {
                const cfg = SOURCE_CONFIG[ref.source];
                const Icon = cfg.icon;
                return (
                  <button
                    key={ref.id}
                    onClick={() => onNavigate?.(cfg.tab)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors hover:brightness-95',
                      cfg.bg, cfg.color, cfg.border
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {ref.title.length > 32 ? ref.title.slice(0, 32) + '…' : ref.title}
                  </button>
                );
              })}
            </div>
          )}
          {resultsCount > 0 && (
            <button
              onClick={onToggleSources}
              className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showSources ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showSources ? 'Hide' : 'Show'} {resultsCount} source document{resultsCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reference chip (inline in markdown) ──────────────────────────────────────
function ReferenceChip({ id: _id, source, label, onNavigate }: {
  id: string; source: SourceType; label: string; onNavigate?: (tab: string) => void;
}) {
  const cfg  = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.board_resolution;
  const Icon = cfg.icon;
  return (
    <button
      onClick={() => onNavigate?.(cfg.tab)}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border mx-0.5 transition-colors hover:brightness-95 cursor-pointer',
        cfg.bg, cfg.color, cfg.border
      )}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      {label}
      <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-60" />
    </button>
  );
}

// ── Search mode badge ─────────────────────────────────────────────────────────
function SearchModeBadge({ mode }: { mode: 'semantic' | 'hybrid' | 'keyword' }) {
  if (mode === 'semantic') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-medium">
      <Sparkles className="h-3 w-3" /> Semantic
    </span>
  );
  if (mode === 'hybrid') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
      <Sparkles className="h-3 w-3" /> Semantic + Keyword
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 text-xs font-medium">
      <Search className="h-3 w-3" /> Keyword
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  const examples = [
    'Who has sole signing authority at HSBC?',
    'Show board resolutions from 2024',
    'Which directors are authorized for trade finance?',
    'What is the signing arrangement for ABC Corp?',
    'List all annual general meeting resolutions',
  ];
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Sparkles className="h-7 w-7 text-gray-400" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">Ask questions in plain language</p>
        <p className="text-xs text-gray-400 mt-1">Answers are generated from indexed board resolutions, mandates, and documents</p>
      </div>
      <div className="flex flex-col gap-2 mt-2 w-full max-w-lg">
        {examples.map((ex) => (
          <div key={ex} className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-500">
            {ex}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Result group + cards (expandable source documents) ───────────────────────
interface ResultGroupProps {
  label: string; sourceType: SourceType; items: SearchResult[];
  expandedIds: Set<string>; onToggleExpand: (id: string) => void;
  onNavigate?: (tab: string) => void;
}

function ResultGroup({ label, sourceType, items, expandedIds, onToggleExpand, onNavigate }: ResultGroupProps) {
  const cfg  = SOURCE_CONFIG[sourceType];
  const Icon = cfg.icon;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn('p-1.5 rounded-lg', cfg.bg)}>
          <Icon className={cn('h-4 w-4', cfg.color)} />
        </div>
        <h2 className="text-sm font-semibold text-gray-800">{label}</h2>
        <span className={cn('ml-auto text-xs font-medium px-2 py-0.5 rounded-full', cfg.bg, cfg.color)}>
          {items.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((result) => (
          <ResultCard
            key={result.id}
            result={result}
            cfg={cfg}
            expanded={expandedIds.has(result.id)}
            onToggle={() => onToggleExpand(result.id)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

interface ResultCardProps {
  result: SearchResult;
  cfg: typeof SOURCE_CONFIG[SourceType];
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: (tab: string) => void;
}

function ResultCard({ result, cfg, expanded, onToggle, onNavigate }: ResultCardProps) {
  const Icon         = cfg.icon;
  const relevancePct = Math.min(100, Math.round((result.rank / 0.6) * 100));

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-xl border bg-white shadow-sm overflow-hidden', cfg.border)}>
      <div className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50/60 transition-colors" onClick={onToggle}>
        <div className={cn('p-1.5 rounded-lg mt-0.5 flex-shrink-0', cfg.bg)}>
          <Icon className={cn('h-4 w-4', cfg.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{result.title}</p>
          {result.subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{result.subtitle}</p>}
          {result.snippet  && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{result.snippet}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-2">
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', cfg.bg, cfg.color)}>
            {relevancePct}% match
          </span>
          {result.searchMode === 'semantic' && (
            <span className="flex items-center gap-1 text-blue-500 text-xs">
              <Sparkles className="h-3 w-3" /> semantic
            </span>
          )}
          <div className="flex items-center gap-1 text-gray-400 text-xs">
            <Clock className="h-3 w-3" />
            {formatDate(result.created_at)}
          </div>
        </div>
        <div className="ml-1 text-gray-400 mt-0.5">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div key="detail" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className={cn('border-t px-4 py-4 space-y-4', cfg.border)}>
              <MetadataGrid metadata={result.metadata} />
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => onNavigate?.(SOURCE_CONFIG[result.source].tab)}
                  className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-colors hover:brightness-95', cfg.bg, cfg.color, cfg.border)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View in {SOURCE_CONFIG[result.source].label}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MetadataGrid({ metadata }: { metadata: Record<string, string | null> }) {
  const entries = Object.entries(metadata).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs font-medium text-gray-400 capitalize">{key.replace(/_/g, ' ')}</dt>
          <dd className="text-xs text-gray-700 mt-0.5 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

// ── History Drawer ─────────────────────────────────────────────────────────────
interface HistoryDrawerProps {
  open: boolean;
  history: HistoryEntry[];
  onClose: () => void;
  onSelect: (query: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

function HistoryDrawer({ open, history, onClose, onSelect, onDelete, onClearAll }: HistoryDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/20 z-40"
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-900">Search History</span>
                {history.length > 0 && (
                  <span className="text-xs text-gray-400 font-medium">({history.length})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button
                    onClick={onClearAll}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                  <History className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No searches yet</p>
                  <p className="text-xs text-center px-6">Your searches will appear here after you run a query.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {history.map((entry) => (
                    <HistoryItem
                      key={entry.id}
                      entry={entry}
                      onSelect={() => onSelect(entry.query)}
                      onDelete={() => onDelete(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function HistoryItem({ entry, onSelect, onDelete }: {
  entry: HistoryEntry;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const modeColors: Record<string, string> = {
    hybrid:   'bg-green-50 text-green-700 border-green-200',
    semantic: 'bg-blue-50 text-blue-700 border-blue-200',
    keyword:  'bg-gray-100 text-gray-600 border-gray-200',
  };
  const modeColor = entry.searchMode ? (modeColors[entry.searchMode] ?? modeColors.keyword) : modeColors.keyword;

  let relativeTime = '';
  try { relativeTime = formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true }); }
  catch { relativeTime = entry.timestamp; }

  return (
    <div className="group flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
      <button
        onClick={onSelect}
        className="flex-1 min-w-0 text-left"
      >
        <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-[#DB0011] transition-colors">
          {entry.query}
        </p>
        {entry.answerSnippet && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
            {entry.answerSnippet}{entry.answerSnippet.length >= 120 ? '…' : ''}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="flex items-center gap-1 text-gray-400 text-xs">
            <Clock className="h-3 w-3" />
            {relativeTime}
          </span>
          {entry.searchMode && (
            <span className={cn('text-xs px-1.5 py-0.5 rounded-full border font-medium', modeColor)}>
              {entry.searchMode}
            </span>
          )}
          {entry.resultsCount > 0 && (
            <span className="text-xs text-gray-400">{entry.resultsCount} result{entry.resultsCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0 mt-0.5"
        title="Remove from history"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
