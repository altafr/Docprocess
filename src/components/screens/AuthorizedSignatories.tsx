import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Plus, Trash2, X, FileText, ZoomIn, RotateCcw, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import type { CompanyMandate } from './CompanyMandates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthorizedSignatory {
  id: string;
  director_name_key: string | null;
  first_name: string | null;
  last_name: string | null;
  id_type: string | null;
  id_number: string | null;
  id_expiry_date: string | null;
  nationality: string | null;
  signature_url: string | null;
  email_address: string | null;
  residential_address: string | null;
  date_of_birth: string | null;
  related_companies: string[];
  source_resolution_ids: string[];
  created_at: string;
  last_updated: string;
}

interface BoardResolutionRef {
  id: string;
  document_name: string;
  resolution_number: string | null;
  resolution_date: string | null;
  company_name: string | null;
  purpose_summary: string | null;
}

type EditableField = keyof Pick<
  AuthorizedSignatory,
  | 'first_name' | 'last_name' | 'id_type' | 'id_number' | 'id_expiry_date'
  | 'nationality' | 'email_address' | 'residential_address' | 'date_of_birth'
>;

// ---------------------------------------------------------------------------
// EditableCell — click to edit, blur/Enter to save
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  onSave,
  placeholder = '—',
  type = 'text',
  multiline = false,
}: {
  value: string | null;
  onSave: (val: string | null) => void;
  placeholder?: string;
  type?: string;
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
        type={type}
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
// ResolutionModal — shows board resolution details for source IDs
// ---------------------------------------------------------------------------

function ResolutionModal({
  resolutionIds,
  boardResolutions,
  onClose,
}: {
  resolutionIds: string[];
  boardResolutions: BoardResolutionRef[];
  onClose: () => void;
}) {
  const items = boardResolutions.filter((r) => resolutionIds.includes(r.id));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.14 }}
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-400" />
            <p className="text-[13px] font-semibold text-gray-900">Source Board Resolutions</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {items.length === 0 ? (
            <p className="text-[12px] text-gray-400 italic">No matching board resolution records found.</p>
          ) : (
            items.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-1">
                <p className="text-[12px] font-semibold text-gray-900">{r.document_name || 'Unnamed document'}</p>
                <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
                  {r.resolution_number && <span>Res. #{r.resolution_number}</span>}
                  {r.resolution_date && <span>{r.resolution_date}</span>}
                  {r.company_name && <span className="text-blue-600">{r.company_name}</span>}
                </div>
                {r.purpose_summary && (
                  <p className="text-[11px] text-gray-600 leading-snug mt-1">{r.purpose_summary}</p>
                )}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// SignatureCell — thumbnail + lightbox
// ---------------------------------------------------------------------------

function SignatureCell({ url, name }: { url: string | null; name: string }) {
  const [open, setOpen] = useState(false);

  if (!url) {
    return <span className="text-[11px] text-gray-300 px-1">—</span>;
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group relative flex items-center justify-center w-20 h-10 rounded border border-gray-200 bg-gray-50 overflow-hidden hover:border-blue-300 hover:bg-blue-50 transition-colors"
        title="Click to view signature"
      >
        <img
          src={url}
          alt={`${name} signature`}
          className="max-w-full max-h-full object-contain p-0.5"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-blue-600/0 group-hover:bg-blue-600/8 transition-colors rounded">
          <ZoomIn className="h-3 w-3 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 cursor-pointer"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-sm w-full cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <p className="text-[13px] font-semibold text-gray-900">{name}</p>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-5 bg-gray-50 flex items-center justify-center min-h-[120px]">
                <img src={url} alt={`${name} signature`} className="max-w-full max-h-[280px] object-contain drop-shadow-sm" />
              </div>
              <div className="px-4 py-2.5 border-t">
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline">
                  Open full size
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// SignatoryRow
// ---------------------------------------------------------------------------

function SignatoryRow({
  signatory: s,
  index,
  boardResolutions,
  onUpdate,
  onDelete,
}: {
  signatory: AuthorizedSignatory;
  index: number;
  boardResolutions: BoardResolutionRef[];
  onUpdate: (patch: Partial<AuthorizedSignatory>) => void;
  onDelete: () => void;
}) {
  const [showResolutions, setShowResolutions] = useState(false);
  const [hovering, setHovering] = useState(false);

  const save = (field: EditableField) => (val: string | null) => onUpdate({ [field]: val });

  const resolutionDocs = boardResolutions.filter((r) => s.source_resolution_ids.includes(r.id));
  const displayName = [s.first_name, s.last_name].filter(Boolean).join(' ') || s.director_name_key || 'New signatory';

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.015 }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="border-b border-gray-100 hover:bg-gray-50/40 transition-colors group"
      >
        {/* First name */}
        <td className="px-3 py-2 min-w-[110px]">
          <EditableCell value={s.first_name} onSave={save('first_name')} placeholder="First name" />
        </td>

        {/* Last name */}
        <td className="px-3 py-2 min-w-[110px]">
          <EditableCell value={s.last_name} onSave={save('last_name')} placeholder="Last name" />
        </td>

        {/* ID type */}
        <td className="px-3 py-2 min-w-[100px]">
          <EditableCell value={s.id_type} onSave={save('id_type')} placeholder="e.g. Passport" />
        </td>

        {/* ID number */}
        <td className="px-3 py-2 min-w-[120px]">
          <EditableCell value={s.id_number} onSave={save('id_number')} placeholder="ID number" />
        </td>

        {/* ID expiry */}
        <td className="px-3 py-2 min-w-[110px]">
          <EditableCell value={s.id_expiry_date} onSave={save('id_expiry_date')} placeholder="Expiry date" />
        </td>

        {/* Nationality */}
        <td className="px-3 py-2 min-w-[110px]">
          <EditableCell value={s.nationality} onSave={save('nationality')} placeholder="Nationality" />
        </td>

        {/* Signature */}
        <td className="px-3 py-2 min-w-[90px]">
          <SignatureCell url={s.signature_url} name={displayName} />
        </td>

        {/* Email */}
        <td className="px-3 py-2 min-w-[170px]">
          <EditableCell value={s.email_address} onSave={save('email_address')} placeholder="Email address" type="email" />
        </td>

        {/* Residential address */}
        <td className="px-3 py-2 min-w-[190px]">
          <EditableCell value={s.residential_address} onSave={save('residential_address')} placeholder="Residential address" multiline />
        </td>

        {/* Date of birth */}
        <td className="px-3 py-2 min-w-[110px]">
          <EditableCell value={s.date_of_birth} onSave={save('date_of_birth')} placeholder="Date of birth" />
        </td>

        {/* Related companies */}
        <td className="px-3 py-2 min-w-[160px]">
          {s.related_companies.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {s.related_companies.map((c, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100 whitespace-nowrap">
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-gray-300 px-1">—</span>
          )}
        </td>

        {/* Board resolution link */}
        <td className="px-3 py-2 min-w-[160px]">
          {s.source_resolution_ids.length > 0 ? (
            <button
              onClick={() => setShowResolutions(true)}
              className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-800 hover:underline transition-colors"
            >
              <FileText className="h-3 w-3 shrink-0" />
              {resolutionDocs.length > 0
                ? resolutionDocs[0].document_name.length > 22
                  ? `${resolutionDocs[0].document_name.slice(0, 22)}…`
                  : resolutionDocs[0].document_name
                : `${s.source_resolution_ids.length} resolution${s.source_resolution_ids.length !== 1 ? 's' : ''}`
              }
              {resolutionDocs.length > 1 && (
                <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded">+{resolutionDocs.length - 1}</span>
              )}
            </button>
          ) : (
            <span className="text-[11px] text-gray-300 px-1">—</span>
          )}
        </td>

        {/* Delete */}
        <td className="px-2 py-2 w-10">
          <AnimatePresence>
            {hovering && (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onDelete}
                className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                title="Delete signatory"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </td>
      </motion.tr>

      <AnimatePresence>
        {showResolutions && (
          <ResolutionModal
            resolutionIds={s.source_resolution_ids}
            boardResolutions={boardResolutions}
            onClose={() => setShowResolutions(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// AuthorizedSignatories — main tab component
// ---------------------------------------------------------------------------

export function AuthorizedSignatories() {
  const [signatories, setSignatories] = useState<AuthorizedSignatory[]>([]);
  const [boardResolutions, setBoardResolutions] = useState<BoardResolutionRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  const fetchSignatories = useCallback(async () => {
    setLoading(true);
    const [{ data: sigs }, { data: brs }] = await Promise.all([
      supabase.from('authorized_signatories').select('*').order('last_name').order('first_name'),
      supabase.from('board_resolutions').select('id, document_name, resolution_number, resolution_date, company_name, purpose_summary'),
    ]);
    if (sigs) setSignatories(sigs as AuthorizedSignatory[]);
    if (brs) setBoardResolutions(brs as BoardResolutionRef[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSignatories(); }, [fetchSignatories]);

  const updateSignatory = useCallback(async (id: string, patch: Partial<AuthorizedSignatory>) => {
    setSignatories((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
    const { error } = await supabase
      .from('authorized_signatories')
      .update({ ...patch, last_updated: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      fetchSignatories();
    }
  }, [fetchSignatories, toast]);

  const addSignatory = useCallback(async () => {
    const { data, error } = await supabase
      .from('authorized_signatories')
      .insert({ related_companies: [], source_resolution_ids: [], last_updated: new Date().toISOString() })
      .select()
      .single();
    if (!error && data) {
      setSignatories((prev) => [data as AuthorizedSignatory, ...prev]);
    }
  }, []);

  const deleteSignatory = useCallback(async (id: string) => {
    setSignatories((prev) => prev.filter((s) => s.id !== id));
    await supabase.from('authorized_signatories').delete().eq('id', id);
  }, []);

  const syncFromMandates = useCallback(async () => {
    setSyncing(true);
    try {
      const [{ data: mandates, error: mErr }, { data: existing, error: sErr }] = await Promise.all([
        supabase.from('company_mandates').select('*'),
        supabase.from('authorized_signatories').select('*'),
      ]);

      if (mErr) throw new Error(mErr.message);
      if (sErr) throw new Error(sErr.message);
      if (!mandates || mandates.length === 0) {
        toast({ title: 'Nothing to sync', description: 'No company mandates found. Process a board resolution first.' });
        return;
      }

      // Group mandates by director_name
      const byDirector = new Map<string, typeof mandates[0][]>();
      for (const m of mandates as CompanyMandate[]) {
        if (!byDirector.has(m.director_name)) byDirector.set(m.director_name, []);
        byDirector.get(m.director_name)!.push(m as any);
      }

      const existingMap = new Map((existing ?? []).map((s) => [s.director_name_key, s]));
      let created = 0;
      let updated = 0;

      for (const [directorName, dirMandates] of byDirector) {
        const companies = [...new Set((dirMandates as any[]).map((m) => m.company_name).filter(Boolean))];
        const resolutionIds = [...new Set((dirMandates as any[]).flatMap((m) => m.source_resolution_ids ?? []))];
        const signatureUrl = (dirMandates as any[]).find((m) => m.signature_url)?.signature_url ?? null;
        const prev = existingMap.get(directorName);

        if (!prev) {
          const parts = directorName.trim().split(/\s+/);
          await supabase.from('authorized_signatories').insert({
            director_name_key: directorName,
            first_name: parts[0] ?? null,
            last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
            related_companies: companies,
            source_resolution_ids: resolutionIds,
            signature_url: signatureUrl,
            last_updated: new Date().toISOString(),
          });
          created++;
        } else {
          const mergedCompanies = [...new Set([...(prev.related_companies ?? []), ...companies])];
          const mergedIds = [...new Set([...(prev.source_resolution_ids ?? []), ...resolutionIds])];
          await supabase.from('authorized_signatories').update({
            related_companies: mergedCompanies,
            source_resolution_ids: mergedIds,
            signature_url: prev.signature_url ?? signatureUrl,
            last_updated: new Date().toISOString(),
          }).eq('id', prev.id);
          updated++;
        }
      }

      toast({
        title: 'Sync complete',
        description: `${created} added, ${updated} updated from ${byDirector.size} signatories.`,
      });
      fetchSignatories();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }, [fetchSignatories, toast]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[13px] text-gray-500">
            {signatories.length > 0
              ? `${signatories.length} signator${signatories.length !== 1 ? 'ies' : 'y'} — click any cell to edit`
              : 'No signatories yet. Sync from mandates or add manually.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchSignatories}
            disabled={loading}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={syncFromMandates}
            disabled={syncing}
            className="flex items-center gap-1.5 text-[12px] text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Mandates'}
          </button>
          <button
            onClick={addSignatory}
            className="flex items-center gap-1.5 text-[12px] text-white bg-[#DB0011] hover:bg-[#B00010] px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Signatory
          </button>
        </div>
      </div>

      {/* Legend */}
      <p className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        Fields auto-populated from board resolutions: <span className="font-medium text-gray-600">Name, Signature, Related Companies, Board Resolution link.</span>
        {' '}All other fields require manual entry by operations staff.
      </p>

      {/* Table */}
      {loading ? (
        <LoadingSignatoriesSkeleton />
      ) : signatories.length === 0 ? (
        <EmptySignatoriesState onSync={syncFromMandates} onAdd={addSignatory} syncing={syncing} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {[
                    'First Name', 'Last Name', 'ID Type', 'ID Number', 'ID Expiry',
                    'Nationality', 'Signature', 'Email Address', 'Residential Address',
                    'Date of Birth', 'Companies', 'Board Resolution', '',
                  ].map((h) => (
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
                  {signatories.map((s, i) => (
                    <SignatoryRow
                      key={s.id}
                      signatory={s}
                      index={i}
                      boardResolutions={boardResolutions}
                      onUpdate={(patch) => updateSignatory(s.id, patch)}
                      onDelete={() => deleteSignatory(s.id)}
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
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSignatoriesSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 px-3 py-3 border-b border-gray-100 animate-pulse">
          {[100, 110, 80, 110, 90, 90, 80, 150, 170, 90, 130, 130].map((w, j) => (
            <div key={j} className="h-4 bg-gray-100 rounded shrink-0" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptySignatoriesState({
  onSync,
  onAdd,
  syncing,
}: {
  onSync: () => void;
  onAdd: () => void;
  syncing: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200"
    >
      <UserCheck className="h-10 w-10 mb-3 opacity-20" />
      <p className="text-[14px] font-medium text-gray-500">No authorized signatories yet</p>
      <p className="text-[12px] mt-1 text-center max-w-xs text-gray-400">
        Sync from company mandates to auto-populate, or add signatories manually.
      </p>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-1.5 text-[12px] text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          Sync from Mandates
        </button>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 text-[12px] text-white bg-[#DB0011] hover:bg-[#B00010] px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Manually
        </button>
      </div>
    </motion.div>
  );
}
