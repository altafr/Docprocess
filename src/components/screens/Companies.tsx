import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Search, Building2, ChevronDown, ChevronUp, TriangleAlert as AlertTriangle, Award } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Company {
  id: string;
  company_code: string | null;
  company_name: string;
  legal_entity_type: string | null;
  cin_number: string | null;
  legal_entity_identifier: string | null;
  other_identifier: string | null;
  country_of_incorporation: string | null;
  top50: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompanySignatory {
  company_id: string;
  company_code: string | null;
  company_name: string;
  signatory_id: string;
  signatory_display_id: string | null;
  director_name_key: string | null;
  first_name: string | null;
  last_name: string | null;
  mandate_title: string | null;
}

type EditableField =
  | 'company_name'
  | 'legal_entity_type'
  | 'cin_number'
  | 'legal_entity_identifier'
  | 'other_identifier'
  | 'country_of_incorporation';

// ---------------------------------------------------------------------------
// Helpers exported for testing
// ---------------------------------------------------------------------------

export function buildCompanyRows(companies: Company[]): Company[] {
  return [...companies].sort((a, b) =>
    (a.company_code ?? '').localeCompare(b.company_code ?? ''),
  );
}

export function filterCompanies(companies: Company[], query: string): Company[] {
  if (!query.trim()) return companies;
  const q = query.toLowerCase();
  return companies.filter(
    (c) =>
      c.company_name.toLowerCase().includes(q) ||
      (c.company_code ?? '').toLowerCase().includes(q) ||
      (c.cin_number ?? '').toLowerCase().includes(q),
  );
}

export function looksLikeDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('template') || lower.includes('explanatory_notes');
}

export function groupSignatoriesByCompany(
  rows: CompanySignatory[],
): Map<string, CompanySignatory[]> {
  const map = new Map<string, CompanySignatory[]>();
  for (const row of rows) {
    if (!map.has(row.company_id)) map.set(row.company_id, []);
    map.get(row.company_id)!.push(row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// EditableCell — click to edit, blur/Enter to save
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  onSave,
  placeholder = '—',
  multiline = false,
}: {
  value: string | null;
  onSave: (val: string | null) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim() || null;
    if (trimmed !== value) onSave(trimmed);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) commit();
    if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); }
  };

  if (editing) {
    const baseClass =
      'w-full min-w-[80px] text-[12px] border border-blue-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300';
    return multiline ? (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={placeholder}
        className={`${baseClass} resize-none`}
      />
    ) : (
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={baseClass}
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="text-[12px] min-h-[28px] px-1 py-0.5 rounded cursor-text hover:bg-blue-50 transition-colors group select-none"
      title="Click to edit"
    >
      {value
        ? <span className="text-gray-800">{value}</span>
        : <span className="text-gray-300 italic group-hover:text-gray-400 transition-colors">{placeholder}</span>
      }
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompanyRow
// ---------------------------------------------------------------------------

function CompanyRow({
  company,
  index,
  signatoryCount,
  signatories,
  isExpanded,
  onToggleExpand,
  onUpdate,
}: {
  company: Company;
  index: number;
  signatoryCount: number;
  signatories: CompanySignatory[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<Company>) => void;
}) {
  const save = (field: EditableField) => (val: string | null) => onUpdate({ [field]: val });
  const hasNameIssue = looksLikeDocumentName(company.company_name);

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.015 }}
        className="border-b border-gray-100 hover:bg-gray-50/40 transition-colors group"
      >
        {/* Code */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded border border-gray-200">
            {company.company_code ?? '—'}
          </span>
        </td>

        {/* Company name */}
        <td className="px-3 py-2 min-w-[160px]">
          <div className="flex items-center gap-1.5">
            <EditableCell value={company.company_name} onSave={save('company_name')} placeholder="Unnamed company" />
            {company.top50 && (
              <span title="Top 50 company" className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
                <Award className="h-2.5 w-2.5" />
                TOP 50
              </span>
            )}
            {hasNameIssue && (
              <span title="Name may have leaked from a document — consider renaming" className="shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              </span>
            )}
          </div>
        </td>

        {/* Legal entity type */}
        <td className="px-3 py-2 min-w-[100px]">
          <EditableCell value={company.legal_entity_type} onSave={save('legal_entity_type')} placeholder="—" />
        </td>

        {/* CIN Number */}
        <td className="px-3 py-2 min-w-[120px]">
          <EditableCell value={company.cin_number} onSave={save('cin_number')} placeholder="—" />
        </td>

        {/* Legal Entity Identifier */}
        <td className="px-3 py-2 min-w-[120px]">
          <EditableCell value={company.legal_entity_identifier} onSave={save('legal_entity_identifier')} placeholder="—" />
        </td>

        {/* Other Identifier */}
        <td className="px-3 py-2 min-w-[120px]">
          <EditableCell value={company.other_identifier} onSave={save('other_identifier')} placeholder="—" />
        </td>

        {/* Country */}
        <td className="px-3 py-2 min-w-[100px]">
          <EditableCell value={company.country_of_incorporation} onSave={save('country_of_incorporation')} placeholder="—" />
        </td>

        {/* Top 50 toggle */}
        <td className="px-3 py-2 whitespace-nowrap">
          <button
            onClick={() => onUpdate({ top50: !company.top50 })}
            title={company.top50 ? 'Remove Top 50 flag' : 'Mark as Top 50'}
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
              company.top50
                ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200'
                : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
            }`}
          >
            {company.top50 ? 'Top 50' : 'Mark'}
          </button>
        </td>

        {/* Signatory count */}
        <td className="px-3 py-2 whitespace-nowrap">
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {signatoryCount} signator{signatoryCount !== 1 ? 'ies' : 'y'}
            {isExpanded
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />
            }
          </button>
        </td>
      </motion.tr>

      {/* Expanded signatory list */}
      <AnimatePresence>
        {isExpanded && (
          <motion.tr
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <td colSpan={9} className="px-3 py-3 bg-gray-50/60 border-b border-gray-100">
              {signatories.length === 0 ? (
                <p className="text-[12px] text-gray-400 italic px-2">
                  No signatories linked to this company yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Signer ID</th>
                        <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Name</th>
                        <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Title</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signatories.map((sig) => (
                        <tr key={sig.signatory_id} className="border-b border-gray-100 last:border-0">
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded border border-gray-200">
                              {sig.signatory_display_id ?? '—'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-[12px] text-gray-700 whitespace-nowrap">
                            {[sig.first_name, sig.last_name].filter(Boolean).join(' ') || sig.director_name_key || '—'}
                          </td>
                          <td className="px-2 py-1.5 text-[12px] text-gray-500">
                            {sig.mandate_title ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingCompaniesSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-3 px-3 py-3 border-b border-gray-100 animate-pulse last:border-0">
          <div className="h-4 w-12 bg-gray-100 rounded" />
          <div className="h-4 w-40 bg-gray-100 rounded" />
          <div className="h-4 w-20 bg-gray-100 rounded" />
          <div className="h-4 w-24 bg-gray-100 rounded" />
          <div className="h-4 w-24 bg-gray-100 rounded" />
          <div className="h-4 w-24 bg-gray-100 rounded" />
          <div className="h-4 w-20 bg-gray-100 rounded" />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyCompaniesState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200">
      <Building2 className="h-10 w-10 mb-3 opacity-20" />
      <p className="text-[13px] font-medium text-gray-500">No companies found</p>
      <p className="text-[11px] mt-1 text-gray-400">Companies are created automatically when board resolutions are processed.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [signatoryRows, setSignatoryRows] = useState<CompanySignatory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    const [{ data: comps, error: cErr }, { data: sigs, error: sErr }] = await Promise.all([
      supabase.from('companies').select('*').order('company_code'),
      supabase.from('company_signatories').select('*'),
    ]);
    if (cErr) {
      console.error('Failed to load companies:', cErr.message);
    } else if (comps) {
      setCompanies(comps as Company[]);
    }
    if (sErr) {
      console.error('Failed to load signatory links:', sErr.message);
    } else if (sigs) {
      setSignatoryRows(sigs as CompanySignatory[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const updateCompany = useCallback(async (id: string, patch: Partial<Company>) => {
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
    const { error } = await supabase
      .from('companies')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Save failed:', error.message);
      fetchCompanies();
    }
  }, [fetchCompanies]);

  const signatoriesByCompany = useMemo(() => groupSignatoriesByCompany(signatoryRows), [signatoryRows]);

  const filtered = useMemo(() => {
    const sorted = buildCompanyRows(companies);
    return filterCompanies(sorted, search);
  }, [companies, search]);

  return (
    <div className="font-['Inter',sans-serif] space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Companies</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Master directory of companies with identifiers and linked signatories. Click any cell to edit.
          </p>
        </div>
        <button
          onClick={fetchCompanies}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by company name, code, or CIN number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-[13px] border-gray-200"
        />
      </div>

      {/* Table */}
      {loading ? (
        <LoadingCompaniesSkeleton />
      ) : companies.length === 0 ? (
        <EmptyCompaniesState />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">
          <Search className="h-8 w-8 mb-2 opacity-20" />
          <p className="text-[13px] font-medium text-gray-500">No companies match your search</p>
          <p className="text-[11px] mt-1 text-gray-400">Try clearing the search.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Code', 'Company Name', 'Entity Type', 'CIN Number', 'LEI', 'Other ID', 'Country', 'Top 50', 'Signatories'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-3 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((c, i) => {
                    const sigs = signatoriesByCompany.get(c.id) ?? [];
                    return (
                      <CompanyRow
                        key={c.id}
                        company={c}
                        index={i}
                        signatoryCount={sigs.length}
                        signatories={sigs}
                        isExpanded={expandedId === c.id}
                        onToggleExpand={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        onUpdate={(patch) => updateCompany(c.id, patch)}
                      />
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
