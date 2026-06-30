import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Scale, Building2, Calendar, Users, UserCheck, ListChecks, ChevronDown, FileX, RefreshCw, ChartBar as BarChart2, Loader as Loader2, Sparkles, CircleAlert as AlertCircle, Network, X, Plus, Check, Pencil, PenLine, Stamp } from 'lucide-react';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import type { StoredSignature } from '@/lib/signatureUtils';

export interface BoardResolution {
  id: string;
  document_name: string;
  company_name: string | null;
  resolution_number: string | null;
  resolution_date: string | null;
  resolution_type: string | null;
  purpose_summary: string | null;
  key_decisions: string[];
  signatories: string[];
  authorized_persons: string[];
  effective_date: string | null;
  expiry_date: string | null;
  confidence: number | null;
  created_at: string;
}

type AnalysisState = { status: 'idle' | 'loading' | 'done' | 'error'; text: string };

const RESOLUTION_TYPES = ['All', 'Authorization', 'Appointment', 'Approval', 'Ratification', 'Amendment', 'Dissolution', 'Other'];

const TYPE_STYLES: Record<string, string> = {
  Authorization: 'bg-blue-50 text-blue-700 border-blue-200',
  Appointment:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  Approval:      'bg-green-50 text-green-700 border-green-200',
  Ratification:  'bg-teal-50 text-teal-700 border-teal-200',
  Amendment:     'bg-orange-50 text-orange-700 border-orange-200',
  Dissolution:   'bg-rose-50 text-rose-700 border-rose-200',
  Other:         'bg-gray-50 text-gray-600 border-gray-200',
};

const TYPE_DOT: Record<string, string> = {
  Authorization: 'bg-blue-500',
  Appointment:   'bg-emerald-500',
  Approval:      'bg-green-500',
  Ratification:  'bg-teal-500',
  Amendment:     'bg-orange-500',
  Dissolution:   'bg-rose-500',
  Other:         'bg-gray-400',
};

export function getTypeStyle(type: string | null) {
  return TYPE_STYLES[type ?? ''] || TYPE_STYLES['Other'];
}

function getTypeDot(type: string | null) {
  return TYPE_DOT[type ?? ''] || TYPE_DOT['Other'];
}

export function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return dateStr;
}

// Groups resolutions by company name (null → 'Unknown Company').
export function groupByCompany(resolutions: BoardResolution[]): Record<string, BoardResolution[]> {
  return resolutions.reduce<Record<string, BoardResolution[]>>((acc, r) => {
    const key = r.company_name?.trim() || 'Unknown Company';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});
}

// Returns a count per resolution type for a set of resolutions.
export function getTypeBreakdown(resolutions: BoardResolution[]): Record<string, number> {
  return resolutions.reduce<Record<string, number>>((acc, r) => {
    const t = r.resolution_type || 'Other';
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
}

export interface CompanyGroup {
  id?: string;
  groupName: string;
  members: string[];
  isManual: boolean;
}

const GROUP_STOP_WORDS = new Set([
  'limited', 'ltd', 'inc', 'corp', 'plc', 'llc', 'company',
  'the', 'and', 'for', 'holdings', 'group', 'international',
]);

// Returns the primary "brand" token of a company name for auto-grouping.
export function detectGroupKey(companyName: string): string {
  const words = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !GROUP_STOP_WORDS.has(w));
  return words[0] || companyName.toLowerCase();
}

// Builds a list of CompanyGroups from company names + saved manual groups.
export function buildCompanyGroups(
  companies: string[],
  savedGroups: Array<{ id: string; group_name: string; member_companies: string[] }>,
): CompanyGroup[] {
  const manuallyGrouped = new Set(savedGroups.flatMap((g) => g.member_companies));

  // Add saved groups first
  const result: CompanyGroup[] = savedGroups.map((g) => ({
    id: g.id,
    groupName: g.group_name,
    members: g.member_companies.filter((c) => companies.includes(c)),
    isManual: true,
  }));

  // Auto-detect groups for remaining companies
  const ungrouped = companies.filter((c) => !manuallyGrouped.has(c));
  const autoMap: Record<string, string[]> = {};
  for (const c of ungrouped) {
    const key = detectGroupKey(c);
    if (!autoMap[key]) autoMap[key] = [];
    autoMap[key].push(c);
  }

  for (const [key, members] of Object.entries(autoMap)) {
    // Only auto-form a group when 2+ companies share the same brand key
    const groupName = members.length > 1
      ? key.charAt(0).toUpperCase() + key.slice(1) + ' Group'
      : members[0];
    result.push({ groupName, members, isManual: false });
  }

  return result
    .filter((g) => g.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || a.groupName.localeCompare(b.groupName));
}

export function BoardResolutions() {
  const [resolutions, setResolutions] = useState<BoardResolution[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'resolutions' | 'analysis' | 'groups' | 'signatures'>('resolutions');
  const [analysisCache, setAnalysisCache] = useState<Record<string, AnalysisState>>({});
  const [savedGroups, setSavedGroups] = useState<Array<{ id: string; group_name: string; member_companies: string[] }>>([]);

  const fetchSavedGroups = useCallback(async () => {
    const { data } = await supabase.from('company_groups').select('id, group_name, member_companies');
    if (data) setSavedGroups(data);
  }, []);

  const fetchResolutions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('board_resolutions')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setResolutions(data as BoardResolution[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchResolutions(); }, [fetchResolutions]);
  useEffect(() => { fetchSavedGroups(); }, [fetchSavedGroups]);

  const analyzeCompany = useCallback(async (company: string, companyResolutions: BoardResolution[]) => {
    setAnalysisCache((prev) => ({ ...prev, [company]: { status: 'loading', text: '' } }));
    try {
      const payload = {
        company,
        resolutions: companyResolutions.map((r) => ({
          date: r.resolution_date,
          type: r.resolution_type,
          purpose: r.purpose_summary,
          keyDecisions: r.key_decisions ?? [],
          authorizedPersons: r.authorized_persons ?? [],
          signatories: r.signatories ?? [],
        })),
      };
      const result = await callEdgeFunction('analyze-company', payload);
      setAnalysisCache((prev) => ({ ...prev, [company]: { status: 'done', text: result.analysis ?? '' } }));
    } catch (err: any) {
      setAnalysisCache((prev) => ({ ...prev, [company]: { status: 'error', text: err?.message || 'Analysis failed.' } }));
    }
  }, []);

  const filtered = resolutions.filter((r) => {
    const matchesType = typeFilter === 'All' || r.resolution_type === typeFilter;
    if (!matchesType) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.company_name?.toLowerCase().includes(q) ||
      r.resolution_number?.toLowerCase().includes(q) ||
      r.purpose_summary?.toLowerCase().includes(q) ||
      r.document_name?.toLowerCase().includes(q) ||
      r.key_decisions?.some((d) => d.toLowerCase().includes(q)) ||
      r.signatories?.some((s) => s.toLowerCase().includes(q))
    );
  });

  const typeCounts = RESOLUTION_TYPES.slice(1).reduce<Record<string, number>>((acc, t) => {
    acc[t] = resolutions.filter((r) => r.resolution_type === t).length;
    return acc;
  }, {});

  return (
    <div className="font-['Inter',sans-serif] space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Board Resolutions</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Structured view of all processed board resolutions for operations review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setView('resolutions')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                view === 'resolutions' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Resolutions
            </button>
            <button
              onClick={() => setView('analysis')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                view === 'analysis' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <BarChart2 className="h-3.5 w-3.5" />
              Company Analysis
            </button>
            <button
              onClick={() => setView('groups')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                view === 'groups' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Network className="h-3.5 w-3.5" />
              Group View
            </button>
            <button
              onClick={() => setView('signatures')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                view === 'signatures' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Stamp className="h-3.5 w-3.5" />
              Signatures
            </button>
          </div>
          <button
            onClick={fetchResolutions}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {resolutions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={resolutions.length} color="text-gray-900" />
          <StatCard label="Authorizations" value={typeCounts['Authorization'] || 0} color="text-blue-700" />
          <StatCard label="Approvals" value={typeCounts['Approval'] || 0} color="text-green-700" />
          <StatCard label="Appointments" value={typeCounts['Appointment'] || 0} color="text-emerald-700" />
        </div>
      )}

      {/* Resolutions view */}
      {view === 'resolutions' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search company, resolution number, decision text..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-[13px] border-gray-200"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {RESOLUTION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                    typeFilter === t
                      ? 'bg-[#DB0011] text-white border-[#DB0011]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                  <div className="flex gap-3 items-start">
                    <div className="h-4 w-24 bg-gray-100 rounded" />
                    <div className="h-4 w-48 bg-gray-100 rounded" />
                  </div>
                  <div className="mt-3 h-3 w-3/4 bg-gray-100 rounded" />
                  <div className="mt-2 h-3 w-1/2 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 text-gray-400"
            >
              <FileX className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-[14px] font-medium text-gray-500">
                {resolutions.length === 0 ? 'No board resolutions processed yet' : 'No results match your filters'}
              </p>
              <p className="text-[12px] mt-1 text-center max-w-xs">
                {resolutions.length === 0
                  ? 'Upload board resolution documents in the Document Processor to see them here.'
                  : 'Try adjusting your search or filter.'}
              </p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {filtered.map((res, idx) => (
                  <ResolutionCard
                    key={res.id}
                    resolution={res}
                    index={idx}
                    expanded={expandedId === res.id}
                    onToggle={() => setExpandedId(expandedId === res.id ? null : res.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {/* Analysis view */}
      {view === 'analysis' && (
        <CompanyAnalysisView
          resolutions={resolutions}
          loading={loading}
          analysisCache={analysisCache}
          onAnalyse={analyzeCompany}
        />
      )}

      {/* Group view */}
      {view === 'groups' && (
        <GroupView
          resolutions={resolutions}
          loading={loading}
          savedGroups={savedGroups}
          onGroupsChange={fetchSavedGroups}
          analysisCache={analysisCache}
          onAnalyse={analyzeCompany}
        />
      )}

      {/* Signatures & Stamps view */}
      {view === 'signatures' && <SignaturesView />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Company Analysis view
// ---------------------------------------------------------------------------

function CompanyAnalysisView({
  resolutions,
  loading,
  analysisCache,
  onAnalyse,
}: {
  resolutions: BoardResolution[];
  loading: boolean;
  analysisCache: Record<string, AnalysisState>;
  onAnalyse: (company: string, resolutions: BoardResolution[]) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-5 w-48 bg-gray-100 rounded mb-3" />
            <div className="h-3 w-32 bg-gray-100 rounded mb-4" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-5/6 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (resolutions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-20 text-gray-400"
      >
        <BarChart2 className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-[14px] font-medium text-gray-500">No resolutions to analyse</p>
        <p className="text-[12px] mt-1 text-center max-w-xs">
          Process board resolution documents first, then return here for company-level insights.
        </p>
      </motion.div>
    );
  }

  const grouped = groupByCompany(resolutions);
  const companies = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-gray-400">
        {companies.length} {companies.length === 1 ? 'company' : 'companies'} · {resolutions.length} total resolutions
      </p>
      <AnimatePresence>
        {companies.map(([company, companyResolutions], idx) => (
          <motion.div
            key={company}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
          >
            <CompanyAnalysisCard
              company={company}
              resolutions={companyResolutions}
              analysis={analysisCache[company] ?? { status: 'idle', text: '' }}
              onAnalyse={() => onAnalyse(company, companyResolutions)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function CompanyAnalysisCard({
  company,
  resolutions,
  analysis,
  onAnalyse,
}: {
  company: string;
  resolutions: BoardResolution[];
  analysis: AnalysisState;
  onAnalyse: () => void;
}) {
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const sorted = [...resolutions].sort(
    (a, b) => (b.resolution_date ?? b.created_at).localeCompare(a.resolution_date ?? a.created_at),
  );
  const dates = resolutions.map((r) => r.resolution_date).filter(Boolean).sort() as string[];
  const breakdown = getTypeBreakdown(resolutions);
  const visibleResolutions = timelineExpanded ? sorted : sorted.slice(0, 4);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
              <h3 className="text-[15px] font-semibold text-gray-900 truncate">{company}</h3>
              <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {resolutions.length} resolution{resolutions.length !== 1 ? 's' : ''}
              </span>
            </div>

            {dates.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                {dates.length === 1
                  ? formatDate(dates[0])
                  : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`}
              </p>
            )}

            {/* Type breakdown */}
            <div className="flex flex-wrap gap-1.5 mt-2.5 ml-6">
              {Object.entries(breakdown).map(([type, count]) => (
                <span
                  key={type}
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getTypeStyle(type)}`}
                >
                  {type}
                  {count > 1 && <span className="opacity-60 font-normal">×{count}</span>}
                </span>
              ))}
            </div>
          </div>

          {/* Analyse button */}
          {analysis.status === 'idle' && (
            <button
              onClick={onAnalyse}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#DB0011] text-white text-[11px] font-medium rounded-lg hover:bg-[#b5000e] transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Analyse
            </button>
          )}
          {analysis.status === 'loading' && (
            <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-500 text-[11px] rounded-lg">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analysing…
            </div>
          )}
          {(analysis.status === 'done' || analysis.status === 'error') && (
            <button
              onClick={onAnalyse}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-500 text-[11px] font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Re-analyse
            </button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="px-5 py-3 space-y-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Resolution History</p>
        {visibleResolutions.map((r) => {
          const desc = derivePurpose(r);
          return (
            <div key={r.id} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${getTypeDot(r.resolution_type)}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {formatDate(r.resolution_date) || 'Unknown date'}
                  </span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${getTypeStyle(r.resolution_type)}`}>
                    {r.resolution_type || 'Other'}
                  </span>
                </div>
                {desc && (
                  <p className="text-[12px] text-gray-700 mt-0.5 line-clamp-2 leading-snug">{desc}</p>
                )}
              </div>
            </div>
          );
        })}

        {sorted.length > 4 && (
          <button
            onClick={() => setTimelineExpanded((v) => !v)}
            className="text-[11px] text-[#DB0011] hover:underline mt-1 ml-5"
          >
            {timelineExpanded ? 'Show less' : `Show ${sorted.length - 4} more`}
          </button>
        )}
      </div>

      {/* Analysis result */}
      <AnimatePresence>
        {analysis.status === 'done' && analysis.text && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                  <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">AI Analysis</p>
                </div>
                <div className="space-y-3">
                  {analysis.text.split(/\n\n+/).filter(Boolean).map((para, i) => (
                    <p key={i} className="text-[12px] text-blue-900 leading-relaxed">{para.trim()}</p>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {analysis.status === 'error' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="px-5 pb-5">
              <div className="flex items-start gap-2 px-3.5 py-3 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-red-700">{analysis.text || 'Analysis failed. Please retry.'}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers and sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[11px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

export function derivePurpose(r: BoardResolution): string | null {
  if (r.purpose_summary) return r.purpose_summary;
  if ((r.key_decisions ?? []).length > 0) {
    const first = r.key_decisions[0];
    return r.key_decisions.length === 1
      ? first
      : `${first} (and ${r.key_decisions.length - 1} other decision${r.key_decisions.length > 2 ? 's' : ''})`;
  }
  if (r.resolution_type && r.resolution_type !== 'Other') {
    const subject = (r.authorized_persons ?? []).length > 0
      ? r.authorized_persons.slice(0, 2).join(', ')
      : r.company_name || 'the company';
    return `${r.resolution_type} resolution relating to ${subject}.`;
  }
  return null;
}

function ResolutionCard({
  resolution: r,
  index,
  expanded,
  onToggle,
}: {
  resolution: BoardResolution;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const purpose = derivePurpose(r);
  const [signatures, setSignatures] = useState<StoredSignature[]>([]);

  useEffect(() => {
    if (!expanded) return;
    supabase
      .from('document_signatures')
      .select('*')
      .eq('board_resolution_id', r.id)
      .then(({ data }) => { if (data) setSignatures(data as StoredSignature[]); });
  }, [expanded, r.id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden"
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 hover:bg-gray-50/60 transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getTypeStyle(r.resolution_type)}`}>
            {r.resolution_type || 'Other'}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-gray-900">
                {r.company_name || 'Unknown Company'}
              </span>
              {r.resolution_number && (
                <span className="text-[11px] text-gray-400 font-mono">{r.resolution_number}</span>
              )}
            </div>

            {purpose ? (
              <p className={`text-[13px] mt-1 leading-relaxed line-clamp-2 ${r.purpose_summary ? 'text-gray-600' : 'text-gray-400 italic'}`}>
                {purpose}
              </p>
            ) : (
              <p className="text-[12px] text-gray-300 italic mt-1">No description available — expand for details.</p>
            )}

            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {r.resolution_date && (
                <MetaChip icon={Calendar} label={formatDate(r.resolution_date) || r.resolution_date} />
              )}
              {(r.signatories ?? []).length > 0 && (
                <MetaChip icon={Users} label={`${r.signatories.length} signator${r.signatories.length === 1 ? 'y' : 'ies'}`} />
              )}
              {(r.authorized_persons ?? []).length > 0 && (
                <MetaChip icon={UserCheck} label={`${r.authorized_persons.length} authorized`} />
              )}
              {(r.key_decisions ?? []).length > 0 && (
                <MetaChip icon={ListChecks} label={`${r.key_decisions.length} decision${r.key_decisions.length === 1 ? '' : 's'}`} />
              )}
            </div>
          </div>

          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 mt-1"
          >
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 border-t border-gray-100 space-y-4">
              {(r.effective_date || r.expiry_date) && (
                <div className="flex gap-3 flex-wrap pt-4">
                  {r.effective_date && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                      <Calendar className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-[11px] text-gray-500">Effective:</span>
                      <span className="text-[11px] font-medium text-gray-800">{formatDate(r.effective_date) || r.effective_date}</span>
                    </div>
                  )}
                  {r.expiry_date && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                      <Calendar className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-[11px] text-gray-500">Expires:</span>
                      <span className="text-[11px] font-medium text-gray-800">{formatDate(r.expiry_date) || r.expiry_date}</span>
                    </div>
                  )}
                </div>
              )}

              {(r.key_decisions ?? []).length > 0 && (
                <Section icon={ListChecks} title="Key Decisions / Resolved Items">
                  <ul className="space-y-2">
                    {r.key_decisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#DB0011] shrink-0" />
                        <span className="text-[13px] text-gray-800 leading-relaxed">{d}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {(r.authorized_persons ?? []).length > 0 && (
                <Section icon={UserCheck} title="Authorized Persons">
                  <div className="flex flex-wrap gap-2">
                    {r.authorized_persons.map((p, i) => (
                      <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 text-[12px] font-medium rounded-full border border-blue-200">
                        {p}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {(r.signatories ?? []).length > 0 && (
                <Section icon={Users} title="Signatories">
                  <div className="flex flex-wrap gap-2">
                    {r.signatories.map((s, i) => (
                      <span key={i} className="px-3 py-1 bg-gray-100 text-gray-700 text-[12px] font-medium rounded-full border border-gray-200">
                        {s}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Extracted signature/seal images */}
              {signatures.length > 0 && (
                <Section icon={PenLine} title={`Extracted Images (${signatures.length})`}>
                  <div className="flex flex-wrap gap-3">
                    {signatures.filter((s) => s.element_type === 'signature').map((sig) => (
                      <div key={sig.id} className="flex flex-col items-center gap-1">
                        <a
                          href={sig.storage_url ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 overflow-hidden w-32 h-16 hover:border-blue-400 transition-colors"
                        >
                          <img
                            src={sig.storage_url ?? ''}
                            alt={sig.person_name ?? 'Signature'}
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </a>
                        <span className="text-[10px] text-gray-500 max-w-[8rem] truncate text-center">
                          {sig.person_name ?? 'Signature'}
                        </span>
                      </div>
                    ))}
                    {signatures.filter((s) => s.element_type !== 'signature').map((sig) => (
                      <div key={sig.id} className="flex flex-col items-center gap-1">
                        <a
                          href={sig.storage_url ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 overflow-hidden w-16 h-16 hover:border-amber-400 transition-colors"
                        >
                          <img
                            src={sig.storage_url ?? ''}
                            alt={sig.element_type}
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </a>
                        <span className="text-[10px] text-amber-700 capitalize">{sig.element_type}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <div className="flex items-center gap-3 pt-1 flex-wrap text-[11px] text-gray-400">
                <span className="flex items-center gap-1">
                  <Scale className="h-3 w-3" />
                  Source: {r.document_name || 'Unknown document'}
                </span>
                {r.confidence != null && (
                  <span>Confidence: {Math.round(r.confidence * 100)}%</span>
                )}
                <span>Processed: {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-[#DB0011]" />
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </div>
  );
}

function MetaChip({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-400">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Group View
// ---------------------------------------------------------------------------

function GroupView({
  resolutions,
  loading,
  savedGroups,
  onGroupsChange,
  analysisCache,
  onAnalyse,
}: {
  resolutions: BoardResolution[];
  loading: boolean;
  savedGroups: Array<{ id: string; group_name: string; member_companies: string[] }>;
  onGroupsChange: () => void;
  analysisCache: Record<string, AnalysisState>;
  onAnalyse: (company: string, companyResolutions: BoardResolution[]) => void;
}) {
  const [editingGroup, setEditingGroup] = useState<CompanyGroup | null>(null);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-5 w-48 bg-gray-100 rounded mb-3" />
            <div className="h-3 w-32 bg-gray-100 rounded mb-4" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-5/6 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (resolutions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-20 text-gray-400"
      >
        <Network className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-[14px] font-medium text-gray-500">No resolutions to group</p>
        <p className="text-[12px] mt-1 text-center max-w-xs">
          Process board resolution documents first to see group-level analysis here.
        </p>
      </motion.div>
    );
  }

  const byCompany = groupByCompany(resolutions);
  const allCompanies = Object.keys(byCompany);
  const groups = buildCompanyGroups(allCompanies, savedGroups);

  const handleSaveGroup = async (group: CompanyGroup) => {
    if (group.id) {
      await supabase
        .from('company_groups')
        .update({ group_name: group.groupName, member_companies: group.members })
        .eq('id', group.id);
    } else {
      await supabase
        .from('company_groups')
        .insert({ group_name: group.groupName, member_companies: group.members });
    }
    onGroupsChange();
    setEditingGroup(null);
  };

  const handleDeleteGroup = async (id: string) => {
    await supabase.from('company_groups').delete().eq('id', id);
    onGroupsChange();
  };

  // Aggregate resolutions for a group
  const groupResolutions = (group: CompanyGroup) =>
    group.members.flatMap((c) => byCompany[c] ?? []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-gray-400">
          {groups.length} {groups.length === 1 ? 'group' : 'groups'} · {allCompanies.length} companies · {resolutions.length} total resolutions
        </p>
        <button
          onClick={() => setEditingGroup({ groupName: '', members: [], isManual: true })}
          className="flex items-center gap-1.5 text-[12px] text-white bg-[#DB0011] hover:bg-[#b5000e] px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Group
        </button>
      </div>

      <AnimatePresence>
        {groups.map((group, idx) => (
          <motion.div
            key={group.id ?? group.groupName}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
          >
            <GroupCard
              group={group}
              resolutions={groupResolutions(group)}
              byCompany={byCompany}
              analysis={analysisCache[group.groupName] ?? { status: 'idle', text: '' }}
              onEdit={() => setEditingGroup(group)}
              onDelete={group.isManual && group.id ? () => handleDeleteGroup(group.id!) : undefined}
              onAnalyse={() => onAnalyse(group.groupName, groupResolutions(group))}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {editingGroup && (
        <EditGroupModal
          group={editingGroup}
          allCompanies={allCompanies}
          onSave={handleSaveGroup}
          onCancel={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

function GroupCard({
  group,
  resolutions,
  byCompany,
  analysis,
  onEdit,
  onDelete,
  onAnalyse,
}: {
  group: CompanyGroup;
  resolutions: BoardResolution[];
  byCompany: Record<string, BoardResolution[]>;
  analysis: AnalysisState;
  onEdit: () => void;
  onDelete?: () => void;
  onAnalyse: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const breakdown = getTypeBreakdown(resolutions);
  const dates = resolutions.map((r) => r.resolution_date).filter(Boolean).sort() as string[];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Network className="h-4 w-4 text-gray-400 shrink-0" />
              <h3 className="text-[15px] font-semibold text-gray-900">{group.groupName}</h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                group.isManual
                  ? 'bg-blue-50 text-blue-600 border-blue-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}>
                {group.isManual ? 'Manual' : 'Auto-detected'}
              </span>
              <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {group.members.length} {group.members.length === 1 ? 'company' : 'companies'}
              </span>
              <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {resolutions.length} resolution{resolutions.length !== 1 ? 's' : ''}
              </span>
            </div>

            {dates.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1 ml-6">
                {dates.length === 1
                  ? formatDate(dates[0])
                  : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5 mt-2 ml-6">
              {Object.entries(breakdown).map(([type, count]) => (
                <span
                  key={type}
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getTypeStyle(type)}`}
                >
                  {type}
                  {count > 1 && <span className="opacity-60 font-normal">×{count}</span>}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onEdit}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <X className="h-3 w-3" />
                Delete
              </button>
            )}
            {analysis.status === 'idle' && (
              <button
                onClick={onAnalyse}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#DB0011] text-white text-[11px] font-medium rounded-lg hover:bg-[#b5000e] transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Analyse
              </button>
            )}
            {analysis.status === 'loading' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-500 text-[11px] rounded-lg">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analysing…
              </div>
            )}
            {(analysis.status === 'done' || analysis.status === 'error') && (
              <button
                onClick={onAnalyse}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-500 text-[11px] font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Re-analyse
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Member companies */}
      <div className="px-5 py-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Member Companies</p>
        <div className="flex flex-wrap gap-2">
          {group.members.map((company) => {
            const count = (byCompany[company] ?? []).length;
            return (
              <div key={company} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                <Building2 className="h-3 w-3 text-gray-400" />
                <span className="text-[11px] font-medium text-gray-700">{company}</span>
                <span className="text-[10px] text-gray-400">({count})</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expandable combined timeline */}
      <div className="px-5 pb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-[#DB0011] hover:underline"
        >
          {expanded ? 'Hide' : 'Show'} combined timeline
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-2">
              {[...resolutions]
                .sort((a, b) => (b.resolution_date ?? b.created_at).localeCompare(a.resolution_date ?? a.created_at))
                .map((r) => {
                  const desc = derivePurpose(r);
                  return (
                    <div key={r.id} className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${getTypeDot(r.resolution_type)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {formatDate(r.resolution_date) || 'Unknown date'}
                          </span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${getTypeStyle(r.resolution_type)}`}>
                            {r.resolution_type || 'Other'}
                          </span>
                          <span className="text-[10px] text-gray-400 italic">{r.company_name}</span>
                        </div>
                        {desc && (
                          <p className="text-[12px] text-gray-700 mt-0.5 line-clamp-2 leading-snug">{desc}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analysis result */}
      <AnimatePresence>
        {analysis.status === 'done' && analysis.text && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                  <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Group AI Analysis</p>
                </div>
                <div className="space-y-3">
                  {analysis.text.split(/\n\n+/).filter(Boolean).map((para, i) => (
                    <p key={i} className="text-[12px] text-blue-900 leading-relaxed">{para.trim()}</p>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
        {analysis.status === 'error' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="px-5 pb-5">
              <div className="flex items-start gap-2 px-3.5 py-3 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-red-700">{analysis.text || 'Analysis failed. Please retry.'}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EditGroupModal({
  group,
  allCompanies,
  onSave,
  onCancel,
}: {
  group: CompanyGroup;
  allCompanies: string[];
  onSave: (g: CompanyGroup) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(group.groupName);
  const [members, setMembers] = useState<string[]>(group.members);

  const toggleMember = (company: string) => {
    setMembers((prev) =>
      prev.includes(company) ? prev.filter((c) => c !== company) : [...prev, company],
    );
  };

  const canSave = name.trim().length > 0 && members.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-[15px] font-semibold text-gray-900">
            {group.id ? 'Edit Group' : 'New Group'}
          </h3>
          <p className="text-[12px] text-gray-400 mt-0.5">
            Name the group and select which companies belong to it.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
              Group Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Group"
              className="w-full h-9 text-[13px] border border-gray-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-[#DB0011]/20 focus:border-[#DB0011]/40"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
              Member Companies
            </label>
            <div className="max-h-52 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2">
              {allCompanies.length === 0 && (
                <p className="text-[12px] text-gray-400 p-2">No companies available.</p>
              )}
              {allCompanies.map((company) => {
                const checked = members.includes(company);
                return (
                  <button
                    key={company}
                    onClick={() => toggleMember(company)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                      checked ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      checked ? 'bg-[#DB0011] border-[#DB0011]' : 'border-gray-300'
                    }`}>
                      {checked && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className="text-[12px] font-medium">{company}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{members.length} selected</p>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[12px] font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...group, groupName: name.trim(), members, isManual: true })}
            disabled={!canSave}
            className="px-4 py-2 text-[12px] font-medium text-white bg-[#DB0011] rounded-lg hover:bg-[#b5000e] transition-colors disabled:opacity-40"
          >
            Save Group
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signatures & Stamps view
// ---------------------------------------------------------------------------

function SignatureTile({ sig, onClick }: { sig: StoredSignature; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  const isSignature = sig.element_type === 'signature';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        className={`flex items-center justify-center rounded-xl border overflow-hidden hover:shadow-md hover:scale-105 transition-all cursor-pointer ${
          isSignature
            ? 'border-blue-200 bg-blue-50 w-36 h-[72px]'
            : sig.element_type === 'seal'
            ? 'border-emerald-200 bg-emerald-50 w-20 h-20 rounded-full'
            : 'border-amber-200 bg-amber-50 w-20 h-20'
        }`}
      >
        {sig.storage_url && !imgError ? (
          <img
            src={sig.storage_url}
            alt={sig.person_name ?? sig.element_type}
            className="max-w-full max-h-full object-contain p-1.5"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="text-[9px] text-gray-400 italic px-2 text-center">
            {imgError ? 'Failed' : 'No image'}
          </span>
        )}
      </button>
      <div className="text-center" style={{ maxWidth: 144 }}>
        <p className="text-[10px] font-medium text-gray-700 truncate">
          {sig.person_name ?? sig.element_type}
        </p>
        <p className={`text-[9px] capitalize ${
          isSignature ? 'text-blue-500' : sig.element_type === 'seal' ? 'text-emerald-500' : 'text-amber-500'
        }`}>
          {sig.element_type}
          {sig.signature_type && sig.signature_type !== 'unknown' && sig.signature_type !== 'stamp'
            ? ` · ${sig.signature_type}`
            : ''}
        </p>
      </div>
    </div>
  );
}

function SignaturesView() {
  const [sigs, setSigs] = useState<StoredSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<StoredSignature | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('document_signatures')
      .select('*')
      .order('company_name')
      .order('element_type')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setSigs(data as StoredSignature[]);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-wrap gap-4 pt-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-36 h-[72px] bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (sigs.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-20 text-gray-400"
      >
        <PenLine className="h-10 w-10 mb-3 opacity-20" />
        <p className="text-[14px] font-medium text-gray-500">No signatures extracted yet</p>
        <p className="text-[12px] mt-1 text-center max-w-xs text-gray-400">
          Signatures and stamps are automatically detected and cropped when board resolution documents are processed through the Document Processor.
        </p>
      </motion.div>
    );
  }

  // Group by company
  const grouped = sigs.reduce<Record<string, StoredSignature[]>>((acc, s) => {
    const key = s.company_name ?? 'Unknown Company';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  const sigCount = sigs.filter((s) => s.element_type === 'signature').length;
  const stampCount = sigs.filter((s) => s.element_type !== 'signature').length;

  return (
    <>
      <div className="space-y-6">
        {/* Summary strip */}
        <div className="flex gap-4 text-[12px] text-gray-500">
          <span>{sigCount} signature{sigCount !== 1 ? 's' : ''}</span>
          <span className="text-gray-300">·</span>
          <span>{stampCount} stamp{stampCount !== 1 ? 's' : ''} / seal{stampCount !== 1 ? 's' : ''}</span>
          <span className="text-gray-300">·</span>
          <span>{Object.keys(grouped).length} compan{Object.keys(grouped).length === 1 ? 'y' : 'ies'}</span>
        </div>

        {Object.entries(grouped).map(([company, items]) => (
          <motion.div
            key={company}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-gray-200 p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <h3 className="text-[13px] font-semibold text-gray-800">{company}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Signatures row */}
            {items.some((s) => s.element_type === 'signature') && (
              <div className="mb-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Signatures</p>
                <div className="flex flex-wrap gap-4">
                  {items
                    .filter((s) => s.element_type === 'signature')
                    .map((sig) => (
                      <SignatureTile key={sig.id} sig={sig} onClick={() => setLightbox(sig)} />
                    ))}
                </div>
              </div>
            )}

            {/* Stamps & seals row */}
            {items.some((s) => s.element_type !== 'signature') && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Stamps & Seals</p>
                <div className="flex flex-wrap gap-4">
                  {items
                    .filter((s) => s.element_type !== 'signature')
                    .map((sig) => (
                      <SignatureTile key={sig.id} sig={sig} onClick={() => setLightbox(sig)} />
                    ))}
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-lg w-full cursor-default"
            >
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-semibold text-gray-900">
                    {lightbox.person_name ?? lightbox.element_type}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {lightbox.company_name}
                    {lightbox.signature_type && lightbox.signature_type !== 'unknown'
                      ? ` · ${lightbox.signature_type}`
                      : ''}
                    {' · '}
                    <span className="capitalize">{lightbox.element_type}</span>
                  </p>
                </div>
                <button
                  onClick={() => setLightbox(null)}
                  className="text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-6 bg-gray-50 flex items-center justify-center min-h-[180px]">
                <img
                  src={lightbox.storage_url ?? ''}
                  alt={lightbox.person_name ?? lightbox.element_type}
                  className="max-w-full max-h-[360px] object-contain drop-shadow-sm"
                />
              </div>
              {lightbox.storage_url && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                  <a
                    href={lightbox.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-blue-600 hover:underline"
                  >
                    Open full size
                  </a>
                  <span className="text-[10px] text-gray-400">Page {lightbox.page_number}</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
