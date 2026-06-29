import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, RefreshCw, ChevronDown, ChevronRight, CircleAlert as AlertCircle, CircleCheck as CheckCircle2, Clock, Zap, Hash, Activity, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

interface LogEntry {
  id: string;
  function_name: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  prompt_preview: string | null;
  response_preview: string | null;
  duration_ms: number | null;
  status: 'success' | 'error';
  error_message: string | null;
  cost_usd: number | null;
  created_at: string;
}

interface Stats {
  total_calls: number;
  total_tokens: number;
  error_count: number;
  avg_duration_ms: number;
  total_cost_usd: number;
}

interface Filters {
  search: string;
  functionName: string;
  model: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

const PAGE_SIZE = 20;

const FUNCTION_COLORS: Record<string, string> = {
  'procedure-qa':             'bg-blue-50 text-blue-700 border-blue-200',
  'asksme':                   'bg-teal-50 text-teal-700 border-teal-200',
  'translate':                'bg-amber-50 text-amber-700 border-amber-200',
  'data-extraction':          'bg-violet-50 text-violet-700 border-violet-200',
  'document-processor-agent': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function getFunctionColor(fn: string) {
  return FUNCTION_COLORS[fn] || 'bg-gray-50 text-gray-600 border-gray-200';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number | null) {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number | null) {
  if (n == null) return '--';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatCost(usd: number | null) {
  if (usd == null) return '--';
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

export function UsageLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [functionOptions, setFunctionOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({
    search: '', functionName: '', model: '', status: '', dateFrom: '', dateTo: '',
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setFilters((prev) => ({ ...prev, search: value }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(value), 350);
  };

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const buildQuery = useCallback(() => {
    let q = supabase
      .from('llm_usage_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (debouncedSearch) {
      q = q.or(
        `prompt_preview.ilike.%${debouncedSearch}%,response_preview.ilike.%${debouncedSearch}%`,
      );
    }
    if (filters.functionName) q = q.eq('function_name', filters.functionName);
    if (filters.model) q = q.eq('model', filters.model);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.dateFrom) q = q.gte('created_at', new Date(filters.dateFrom).toISOString());
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      q = q.lte('created_at', to.toISOString());
    }
    return q;
  }, [debouncedSearch, filters.functionName, filters.model, filters.status, filters.dateFrom, filters.dateTo]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error, count } = await buildQuery()
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!error) {
        setLogs((data as LogEntry[]) || []);
        setTotalCount(count || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [buildQuery, page]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { data } = await supabase.rpc('get_llm_usage_stats', {
        p_function_name: filters.functionName || null,
        p_model:         filters.model || null,
        p_status:        filters.status || null,
        p_date_from:     filters.dateFrom ? new Date(filters.dateFrom).toISOString() : null,
        p_date_to:       filters.dateTo ? (() => { const d = new Date(filters.dateTo); d.setHours(23,59,59,999); return d.toISOString(); })() : null,
        p_search:        debouncedSearch || null,
      });
      if (data) setStats(data as Stats);
    } finally {
      setStatsLoading(false);
    }
  }, [filters.functionName, filters.model, filters.status, filters.dateFrom, filters.dateTo, debouncedSearch]);

  const fetchOptions = useCallback(async () => {
    const { data } = await supabase.rpc('get_llm_usage_options');
    if (data) {
      setFunctionOptions(data.function_names || []);
      setModelOptions(data.models || []);
    }
  }, []);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);
  useEffect(() => { fetchLogs(); fetchStats(); }, [fetchLogs, fetchStats]);

  const refresh = () => { fetchOptions(); fetchLogs(); fetchStats(); };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasFilters = !!(debouncedSearch || filters.functionName || filters.model || filters.status || filters.dateFrom || filters.dateTo);

  const errorRate = stats && stats.total_calls > 0
    ? ((stats.error_count / stats.total_calls) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="font-['Inter',sans-serif] space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Usage Logs</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            All LLM calls across modules — prompts, models, tokens, and latency.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          {
            label: 'Total Calls',
            value: statsLoading ? '--' : (stats?.total_calls ?? 0).toLocaleString(),
            icon: Activity,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
          },
          {
            label: 'Total Tokens',
            value: statsLoading ? '--' : formatTokens(stats?.total_tokens ?? null),
            icon: Hash,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
          },
          {
            label: 'Total Cost',
            value: statsLoading ? '--' : formatCost(stats?.total_cost_usd ?? null),
            icon: DollarSign,
            color: 'text-teal-600',
            bg: 'bg-teal-50',
          },
          {
            label: 'Error Rate',
            value: statsLoading ? '--' : `${errorRate}%`,
            icon: AlertCircle,
            color: 'text-red-600',
            bg: 'bg-red-50',
          },
          {
            label: 'Avg Latency',
            value: statsLoading ? '--' : formatDuration(stats?.avg_duration_ms ?? null),
            icon: Clock,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
          },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <div className={`${card.bg} rounded-lg p-2 shrink-0`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{card.label}</p>
              <p className="text-lg font-semibold text-gray-900 leading-tight">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <div className="flex flex-wrap gap-2">
          {/* Search */}
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 flex-1 min-w-48">
            <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Search prompts and responses..."
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="flex-1 text-[12px] bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
            />
          </div>

          {/* Function filter */}
          <div className="relative">
            <select
              value={filters.functionName}
              onChange={(e) => setFilter('functionName', e.target.value)}
              className="appearance-none h-8 pl-3 pr-7 text-[12px] border border-gray-200 rounded-lg text-gray-700 bg-white cursor-pointer outline-none focus:border-gray-400"
            >
              <option value="">All modules</option>
              {functionOptions.map((fn) => (
                <option key={fn} value={fn}>{fn}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
          </div>

          {/* Model filter */}
          <div className="relative">
            <select
              value={filters.model}
              onChange={(e) => setFilter('model', e.target.value)}
              className="appearance-none h-8 pl-3 pr-7 text-[12px] border border-gray-200 rounded-lg text-gray-700 bg-white cursor-pointer outline-none focus:border-gray-400"
            >
              <option value="">All models</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
          </div>

          {/* Status filter */}
          <div className="relative">
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              className="appearance-none h-8 pl-3 pr-7 text-[12px] border border-gray-200 rounded-lg text-gray-700 bg-white cursor-pointer outline-none focus:border-gray-400"
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
          </div>

          {/* Date range */}
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilter('dateFrom', e.target.value)}
            className="h-8 px-2 text-[12px] border border-gray-200 rounded-lg text-gray-700 bg-white outline-none focus:border-gray-400 cursor-pointer"
            title="From date"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilter('dateTo', e.target.value)}
            className="h-8 px-2 text-[12px] border border-gray-200 rounded-lg text-gray-700 bg-white outline-none focus:border-gray-400 cursor-pointer"
            title="To date"
          />

          {hasFilters && (
            <button
              onClick={() => {
                setFilters({ search: '', functionName: '', model: '', status: '', dateFrom: '', dateTo: '' });
                setDebouncedSearch('');
                setPage(0);
              }}
              className="h-8 px-3 text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_160px_160px_100px_80px_72px_72px_40px] gap-0 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          {['Timestamp', 'Module', 'Model', 'Tokens', 'Duration', 'Cost', 'Status', ''].map((h) => (
            <span key={h} className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{h}</span>
          ))}
        </div>

        {loading && logs.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <p className="text-[12px]">Loading logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
            <Zap className="h-8 w-8 opacity-30" />
            <p className="text-[13px] font-medium">
              {hasFilters ? 'No logs match your filters' : 'No LLM calls recorded yet'}
            </p>
            <p className="text-[11px]">
              {hasFilters ? 'Try adjusting the filters above' : 'Use any module to start generating logs'}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {logs.map((log, idx) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.02 }}
              >
                <div
                  className={`grid grid-cols-[1fr_160px_160px_100px_80px_72px_72px_40px] gap-0 px-4 py-3 border-b border-gray-50 items-center hover:bg-gray-50/40 transition-colors cursor-pointer ${expandedId === log.id ? 'bg-gray-50/60' : ''}`}
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <span className="text-[11px] text-gray-600 font-mono">{formatDate(log.created_at)}</span>

                  <span className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border w-fit ${getFunctionColor(log.function_name)}`}>
                    {log.function_name}
                  </span>

                  <span className="text-[11px] text-gray-600 truncate pr-2">
                    {log.model || <span className="text-gray-300">--</span>}
                  </span>

                  <div className="text-[11px] text-gray-700">
                    {log.total_tokens != null ? (
                      <span>
                        <span className="font-medium">{formatTokens(log.total_tokens)}</span>
                        <span className="text-gray-400 text-[10px] ml-1">
                          ({formatTokens(log.prompt_tokens)}↑ {formatTokens(log.completion_tokens)}↓)
                        </span>
                      </span>
                    ) : <span className="text-gray-300">--</span>}
                  </div>

                  <span className="text-[11px] text-gray-600">{formatDuration(log.duration_ms)}</span>

                  <span className={`text-[11px] font-medium ${log.cost_usd && log.cost_usd > 0 ? 'text-teal-700' : 'text-gray-300'}`}>
                    {formatCost(log.cost_usd)}
                  </span>

                  <div>
                    {log.status === 'success' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="h-3 w-3" /> OK
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        <AlertCircle className="h-3 w-3" /> Error
                      </span>
                    )}
                  </div>

                  <div className="flex justify-center">
                    <motion.div animate={{ rotate: expandedId === log.id ? 90 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </motion.div>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedId === log.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <ExpandedRow log={log} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between px-1">
          <p className="text-[12px] text-gray-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()} entries
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-[12px] rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pageIdx = Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
              return (
                <button
                  key={pageIdx}
                  onClick={() => setPage(pageIdx)}
                  className={`w-8 h-8 text-[12px] rounded-lg border transition-colors ${
                    pageIdx === page
                      ? 'bg-[#DB0011] text-white border-[#DB0011]'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {pageIdx + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-[12px] rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpandedRow({ log }: { log: LogEntry }) {
  return (
    <div className="px-4 py-4 bg-gray-50/40 border-b border-gray-100 space-y-3">
      {log.error_message && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-[12px] text-red-700 font-medium">{log.error_message}</p>
        </div>
      )}
      {log.cost_usd != null && log.cost_usd > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 rounded-lg border border-teal-100">
          <DollarSign className="h-3.5 w-3.5 text-teal-600 shrink-0" />
          <p className="text-[12px] text-teal-800">
            <span className="font-semibold">Estimated cost:</span> {formatCost(log.cost_usd)}
            {log.prompt_tokens != null && log.completion_tokens != null && (
              <span className="text-teal-600 ml-2">
                ({log.prompt_tokens.toLocaleString()} input + {log.completion_tokens.toLocaleString()} output tokens)
              </span>
            )}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Prompt</p>
          <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
            {log.prompt_preview || <span className="text-gray-300 italic">No prompt recorded</span>}
          </pre>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Response</p>
          <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
            {log.response_preview || <span className="text-gray-300 italic">No response recorded</span>}
          </pre>
        </div>
      </div>
    </div>
  );
}
