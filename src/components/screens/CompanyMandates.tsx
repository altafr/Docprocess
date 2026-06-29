import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, RefreshCw, Download, ChevronDown, ChevronUp, ShieldCheck, Building2, Users, CircleAlert as AlertCircle, FileX, PenLine, CircleCheck as CheckCircle2, Circle as XCircle, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import type { StoredSignature } from '@/lib/signatureUtils';

export interface CompanyMandate {
  id: string;
  company_name: string;
  director_name: string;
  title: string | null;
  authorized_products: string[];
  signing_arrangement: 'sole' | 'joint' | 'any-two' | 'other' | 'unknown';
  signing_rules: string[];
  signature_type: 'wet-ink' | 'digital' | 'unknown';
  effective_date: string | null;
  expiry_date: string | null;
  source_resolution_ids: string[];
  notes: string | null;
  last_updated: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers exported for testing
// ---------------------------------------------------------------------------

export function buildMandateRows(mandates: CompanyMandate[]): CompanyMandate[] {
  return [...mandates].sort((a, b) => a.company_name.localeCompare(b.company_name));
}

export function isMandateExpired(mandate: CompanyMandate): boolean {
  if (!mandate.expiry_date) return false;
  return new Date(mandate.expiry_date) < new Date();
}

export function isMandateExpiringSoon(mandate: CompanyMandate, daysThreshold = 90): boolean {
  if (!mandate.expiry_date || isMandateExpired(mandate)) return false;
  const diff = new Date(mandate.expiry_date).getTime() - Date.now();
  return diff < daysThreshold * 86_400_000;
}

export function exportMandatesToCsv(mandates: CompanyMandate[]): void {
  const headers = [
    'Company', 'Director / Authorised Person', 'Title',
    'Authorised Products', 'Signing Arrangement', 'Signature Type',
    'Effective Date', 'Expiry Date', 'Notes',
  ];
  const rows = mandates.map((m) => [
    m.company_name,
    m.director_name,
    m.title ?? '',
    m.authorized_products.join('; '),
    m.signing_arrangement,
    m.signature_type,
    m.effective_date ?? '',
    m.expiry_date ?? '',
    m.notes ?? '',
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `company-mandates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ARRANGEMENT_LABELS: Record<string, string> = {
  sole: 'Sole', joint: 'Joint', 'any-two': 'Any Two', other: 'Other', unknown: 'Unknown',
};

const ARRANGEMENT_STYLES: Record<string, string> = {
  sole: 'bg-blue-50 text-blue-700 border-blue-200',
  joint: 'bg-purple-50 text-purple-700 border-purple-200',
  'any-two': 'bg-teal-50 text-teal-700 border-teal-200',
  other: 'bg-orange-50 text-orange-700 border-orange-200',
  unknown: 'bg-gray-50 text-gray-500 border-gray-200',
};

const SIG_TYPE_STYLES: Record<string, string> = {
  'wet-ink': 'bg-blue-50 text-blue-600 border-blue-200',
  digital: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  unknown: 'bg-gray-50 text-gray-400 border-gray-200',
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type SortField = 'company_name' | 'director_name' | 'signing_arrangement' | 'effective_date' | 'expiry_date';

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function CompanyMandates() {
  const [mandates, setMandates] = useState<CompanyMandate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('All');
  const [arrangementFilter, setArrangementFilter] = useState('All');
  const [sortField, setSortField] = useState<SortField>('company_name');
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMandates = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('company_mandates')
      .select('*')
      .order('company_name')
      .order('director_name');
    if (!error && data) setMandates(data as CompanyMandate[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchMandates(); }, [fetchMandates]);

  const updateMandate = useCallback(async (id: string, patch: Partial<CompanyMandate>) => {
    setMandates((prev) => prev.map((m) => m.id === id ? { ...m, ...patch } : m));
    const { error } = await supabase.from('company_mandates').update(patch).eq('id', id);
    if (error) {
      // Revert optimistic update on failure
      fetchMandates();
    }
  }, [fetchMandates]);

  const companies = ['All', ...Array.from(new Set(mandates.map((m) => m.company_name))).sort()];
  const arrangements = ['All', 'sole', 'joint', 'any-two', 'other', 'unknown'];

  const filtered = mandates
    .filter((m) => {
      if (companyFilter !== 'All' && m.company_name !== companyFilter) return false;
      if (arrangementFilter !== 'All' && m.signing_arrangement !== arrangementFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        m.director_name.toLowerCase().includes(q) ||
        m.company_name.toLowerCase().includes(q) ||
        (m.title ?? '').toLowerCase().includes(q) ||
        m.authorized_products.some((p) => p.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      const va = String(a[sortField] ?? '');
      const vb = String(b[sortField] ?? '');
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(true); }
  };

  const expiredCount = mandates.filter(isMandateExpired).length;
  const expiringSoonCount = mandates.filter((m) => isMandateExpiringSoon(m) && !isMandateExpired(m)).length;

  return (
    <div className="font-['Inter',sans-serif] space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Company Mandates</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Consolidated signing authority derived from processed board resolutions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportMandatesToCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-[12px] text-gray-600 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            onClick={fetchMandates}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {mandates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Mandates" value={mandates.length} color="text-gray-900" />
          <StatCard label="Companies" value={companies.length - 1} color="text-blue-700" />
          <StatCard label="Expiring Soon" value={expiringSoonCount} color="text-amber-600" />
          <StatCard label="Expired" value={expiredCount} color="text-red-600" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search director, company, product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px] border-gray-200"
          />
        </div>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="h-9 text-[13px] border border-gray-200 rounded-lg px-3 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#DB0011]/20"
        >
          {companies.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select
          value={arrangementFilter}
          onChange={(e) => setArrangementFilter(e.target.value)}
          className="h-9 text-[13px] border border-gray-200 rounded-lg px-3 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#DB0011]/20"
        >
          {arrangements.map((a) => (
            <option key={a} value={a}>{a === 'All' ? 'All Arrangements' : ARRANGEMENT_LABELS[a]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <LoadingSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState hasData={mandates.length > 0} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <SortableHeader label="Company" field="company_name" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
                  <SortableHeader label="Director / Person" field="director_name" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Authorised Products</th>
                  <SortableHeader label="Arrangement" field="signing_arrangement" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Sig. Type</th>
                  <SortableHeader label="Effective" field="effective_date" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
                  <SortableHeader label="Expires" field="expiry_date" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Notes</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <AnimatePresence>
                  {filtered.map((m, idx) => (
                    <MandateRow
                      key={m.id}
                      mandate={m}
                      index={idx}
                      expanded={expandedId === m.id}
                      onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                      onUpdate={(patch) => updateMandate(m.id, patch)}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row + expanded detail
// ---------------------------------------------------------------------------

function MandateRow({
  mandate: m,
  index,
  expanded,
  onToggle,
  onUpdate,
}: {
  mandate: CompanyMandate;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<CompanyMandate>) => void;
}) {
  const expired = isMandateExpired(m);
  const expiringSoon = isMandateExpiringSoon(m);

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.02 }}
        onClick={onToggle}
        className={`cursor-pointer transition-colors ${expanded ? 'bg-blue-50/40' : 'hover:bg-gray-50/60'}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-gray-300 shrink-0" />
            <span className="text-[12px] font-medium text-gray-900 truncate max-w-[140px]">{m.company_name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div>
            <p className="text-[12px] font-semibold text-gray-900">{m.director_name}</p>
            {m.title && <p className="text-[11px] text-gray-400">{m.title}</p>}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {m.authorized_products.slice(0, 2).map((p, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200">
                {p}
              </span>
            ))}
            {m.authorized_products.length > 2 && (
              <span className="text-[10px] text-gray-400">+{m.authorized_products.length - 2}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ARRANGEMENT_STYLES[m.signing_arrangement] ?? ARRANGEMENT_STYLES.unknown}`}>
            {ARRANGEMENT_LABELS[m.signing_arrangement] ?? m.signing_arrangement}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${SIG_TYPE_STYLES[m.signature_type] ?? SIG_TYPE_STYLES.unknown}`}>
            {m.signature_type === 'wet-ink' ? 'Wet Ink' : m.signature_type === 'digital' ? 'Digital' : '—'}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-[11px] text-gray-600">{formatDate(m.effective_date) ?? '—'}</span>
        </td>
        <td className="px-4 py-3">
          {m.expiry_date ? (
            <span className={`text-[11px] font-medium ${expired ? 'text-red-600' : expiringSoon ? 'text-amber-600' : 'text-gray-600'}`}>
              {formatDate(m.expiry_date)}
              {expired && <span className="ml-1 text-[9px] bg-red-100 text-red-600 px-1 py-0.5 rounded">EXPIRED</span>}
              {expiringSoon && !expired && <span className="ml-1 text-[9px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded">SOON</span>}
            </span>
          ) : (
            <span className="text-[11px] text-gray-300">—</span>
          )}
        </td>
        <td className="px-4 py-3 max-w-[120px]">
          <span className="text-[11px] text-gray-400 truncate block">{m.notes ?? '—'}</span>
        </td>
        <td className="px-3 py-3">
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </td>
      </motion.tr>

      {expanded && (
        <tr>
          <td colSpan={9} className="bg-blue-50/30 border-b border-blue-100">
            <ExpandedMandateDetail mandate={m} onUpdate={onUpdate} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedMandateDetail({
  mandate: m,
  onUpdate,
}: {
  mandate: CompanyMandate;
  onUpdate: (patch: Partial<CompanyMandate>) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(m.notes ?? '');
  const [editingArrangement, setEditingArrangement] = useState(false);
  const [signatures, setSignatures] = useState<StoredSignature[]>([]);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    supabase
      .from('document_signatures')
      .select('*')
      .ilike('person_name', m.director_name)
      .ilike('company_name', m.company_name)
      .then(({ data }) => { if (data) setSignatures(data as StoredSignature[]); });
  }, [m.director_name, m.company_name]);

  const saveNotes = () => {
    setEditingNotes(false);
    if (notesValue !== (m.notes ?? '')) {
      onUpdate({ notes: notesValue || null });
    }
  };

  const saveArrangement = (val: string) => {
    setEditingArrangement(false);
    if (val !== m.signing_arrangement) {
      onUpdate({ signing_arrangement: val as CompanyMandate['signing_arrangement'] });
    }
  };

  return (
    <div className="px-6 py-4 space-y-4">
      {/* Signature image gallery — shown when extracted PNGs exist */}
      {signatures.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Signature Images</p>
          <div className="flex flex-wrap gap-3">
            {signatures.filter((s) => s.element_type === 'signature').map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-1">
                <a href={s.storage_url ?? '#'} target="_blank" rel="noopener noreferrer"
                  className="block rounded-lg border border-blue-200 bg-blue-50 overflow-hidden w-32 h-16 flex items-center justify-center hover:border-blue-400 transition-colors">
                  <img
                    src={s.storage_url ?? ''}
                    alt={s.person_name ?? 'Signature'}
                    className="max-w-full max-h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </a>
                <span className="text-[10px] text-gray-500 text-center">
                  {s.signature_type !== 'unknown' ? s.signature_type : 'signature'}
                </span>
              </div>
            ))}
            {signatures.filter((s) => s.element_type !== 'signature').map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-1">
                <a href={s.storage_url ?? '#'} target="_blank" rel="noopener noreferrer"
                  className="block rounded-lg border border-amber-200 bg-amber-50 overflow-hidden w-16 h-16 flex items-center justify-center hover:border-amber-400 transition-colors">
                  <img
                    src={s.storage_url ?? ''}
                    alt={s.element_type}
                    className="max-w-full max-h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </a>
                <span className="text-[10px] text-amber-700 capitalize">{s.element_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {/* Signing rules */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Signing Rules</p>
        {m.signing_rules.length > 0 ? (
          <ul className="space-y-1.5">
            {m.signing_rules.map((rule, i) => (
              <li key={i} className="flex items-start gap-2">
                <ChevronRight className="h-3 w-3 text-[#DB0011] mt-0.5 shrink-0" />
                <span className="text-[12px] text-gray-700 leading-snug">{rule}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-gray-400 italic">No specific rules recorded.</p>
        )}

        {/* Arrangement override */}
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Signing Arrangement</p>
          {editingArrangement ? (
            <select
              autoFocus
              defaultValue={m.signing_arrangement}
              onChange={(e) => saveArrangement(e.target.value)}
              onBlur={(e) => saveArrangement(e.target.value)}
              className="text-[12px] border border-blue-300 rounded px-2 py-1 bg-white focus:outline-none"
            >
              {(['sole', 'joint', 'any-two', 'other', 'unknown'] as const).map((v) => (
                <option key={v} value={v}>{ARRANGEMENT_LABELS[v]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingArrangement(true)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer hover:opacity-75 transition-opacity ${ARRANGEMENT_STYLES[m.signing_arrangement] ?? ARRANGEMENT_STYLES.unknown}`}
            >
              {ARRANGEMENT_LABELS[m.signing_arrangement] ?? m.signing_arrangement} (click to change)
            </button>
          )}
        </div>
      </div>

      {/* Products */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Authorised Products</p>
        <div className="flex flex-wrap gap-1.5">
          {m.authorized_products.length > 0
            ? m.authorized_products.map((p, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 bg-white text-gray-700 rounded border border-gray-200">
                  {p}
                </span>
              ))
            : <p className="text-[11px] text-gray-400 italic">None recorded.</p>
          }
        </div>

        {m.source_resolution_ids.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Source Resolutions ({m.source_resolution_ids.length})
            </p>
            <p className="text-[11px] text-gray-400">{m.source_resolution_ids.length} board resolution{m.source_resolution_ids.length !== 1 ? 's' : ''} processed</p>
          </div>
        )}

        <div className="mt-3">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Last Updated</p>
          <p className="text-[11px] text-gray-500">{formatDate(m.last_updated.slice(0, 10)) ?? m.last_updated.slice(0, 10)}</p>
        </div>
      </div>

      {/* Notes (editable) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Notes</p>
          {!editingNotes && (
            <button
              onClick={() => { setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 50); }}
              className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1"
            >
              <PenLine className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div>
            <textarea
              ref={notesRef}
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={saveNotes}
              rows={4}
              placeholder="Add notes or annotations..."
              className="w-full text-[12px] border border-blue-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
            <div className="flex gap-2 mt-1">
              <button onClick={saveNotes} className="flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />Save
              </button>
              <button onClick={() => { setEditingNotes(false); setNotesValue(m.notes ?? ''); }} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600">
                <XCircle className="h-3 w-3" />Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className={`text-[12px] leading-relaxed ${m.notes ? 'text-gray-700' : 'text-gray-400 italic'}`}>
            {m.notes || 'No notes. Click Edit to add.'}
          </p>
        )}
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortableHeader({
  label, field, sortField, sortAsc, onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortAsc: boolean;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-800 select-none"
    >
      <div className="flex items-center gap-1">
        {label}
        {active ? (
          sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3 opacity-30" />
        )}
      </div>
    </th>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[11px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100 animate-pulse">
          <div className="h-4 w-32 bg-gray-100 rounded" />
          <div className="h-4 w-28 bg-gray-100 rounded" />
          <div className="h-4 w-24 bg-gray-100 rounded" />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasData }: { hasData: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-20 text-gray-400"
    >
      <ShieldCheck className="h-10 w-10 mb-3 opacity-20" />
      <p className="text-[14px] font-medium text-gray-500">
        {hasData ? 'No results match your filters' : 'No mandates extracted yet'}
      </p>
      <p className="text-[12px] mt-1 text-center max-w-xs text-gray-400">
        {hasData
          ? 'Try adjusting your search or filters.'
          : 'Process board resolution documents in the Document Processor. Signing mandates are extracted automatically.'}
      </p>
    </motion.div>
  );
}
