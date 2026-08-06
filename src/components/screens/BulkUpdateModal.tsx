import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TriangleAlert as AlertTriangle, Check, Loader as Loader2, UserCog } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { AuthorizedSignatory } from './AuthorizedSignatories';
import {
  BULK_EDITABLE_FIELDS,
  buildBulkUpdateDiff,
  fetchMandatesForSignatory,
  applyBulkUpdate,
  type BulkUpdateMandateRow,
  type BulkUpdateDiffEntry,
} from '@/lib/bulkUpdate';

// ---------------------------------------------------------------------------
// BulkUpdateModal — Approach A: per-signer modal with per-row selection + verification gate
// ---------------------------------------------------------------------------

export function BulkUpdateModal({
  signatory,
  open,
  onOpenChange,
  onApplied,
}: {
  signatory: AuthorizedSignatory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [mandateRows, setMandateRows] = useState<BulkUpdateMandateRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [verified, setVerified] = useState(false);

  const loadMandates = useCallback(async () => {
    if (!signatory?.director_name_key) return;
    setLoading(true);
    setVerified(false);
    try {
      const rows = await fetchMandatesForSignatory(signatory.director_name_key);
      setMandateRows(rows);
      setSelectedIds(new Set(rows.map((r) => r.id)));
      // Pre-fill with current name
      setFieldValues({ director_name: signatory.director_name_key ?? '' });
    } catch (e: any) {
      toast({ title: 'Failed to load mandates', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [signatory, toast]);

  useEffect(() => {
    if (open && signatory) loadMandates();
  }, [open, signatory, loadMandates]);

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === mandateRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mandateRows.map((r) => r.id)));
    }
  };

  const diffs: BulkUpdateDiffEntry[] = buildBulkUpdateDiff(
    mandateRows,
    [...selectedIds],
    fieldValues,
  );

  const validationErrors = BULK_EDITABLE_FIELDS
    .map((f) => ({ field: f, error: f.validate ? f.validate(fieldValues[f.key] ?? '') : null }))
    .filter((v) => v.error !== null);

  const canApply =
    selectedIds.size > 0 &&
    diffs.length > 0 &&
    validationErrors.length === 0 &&
    verified &&
    !applying;

  const handleApply = async () => {
    if (!canApply) return;
    setApplying(true);
    try {
      const count = await applyBulkUpdate([...selectedIds], fieldValues);
      toast({
        title: 'Bulk update complete',
        description: `${count} mandate${count !== 1 ? 's' : ''} updated for ${signatory?.director_name_key}.`,
      });
      onApplied();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  const displayName = signatory
    ? [signatory.first_name, signatory.last_name].filter(Boolean).join(' ') || signatory.director_name_key || 'Unknown'
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
            <UserCog className="h-4 w-4 text-[#DB0011]" />
            Bulk Update Signer
          </DialogTitle>
        </DialogHeader>

        {signatory && (
          <div className="space-y-4">
            {/* Signatory identification */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white text-gray-600 rounded border border-gray-200">
                {signatory.signatory_display_id ?? '—'}
              </span>
              <span className="text-[13px] font-semibold text-gray-900">{displayName}</span>
              <span className="text-[11px] text-gray-400">·</span>
              <span className="text-[11px] text-gray-500">
                {mandateRows.length} linked mandate{mandateRows.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Editable fields */}
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                New Value
              </p>
              <div className="space-y-2">
                {BULK_EDITABLE_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="text-[11px] text-gray-600 mb-1 block">{field.label}</label>
                    <Input
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="h-8 text-[12px]"
                      placeholder={`Enter new ${field.label.toLowerCase()}`}
                    />
                    {validationErrors.find((v) => v.field.key === field.key)?.error && (
                      <p className="text-[10px] text-red-600 mt-1">
                        {validationErrors.find((v) => v.field.key === field.key)?.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Only the signer name is editable in this release. Additional fields will be added here.
              </p>
            </div>

            {/* Mandate rows for verification */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Mandates to Update ({selectedIds.size} of {mandateRows.length} selected)
                </p>
                <button
                  onClick={toggleAll}
                  className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {selectedIds.size === mandateRows.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                </div>
              ) : mandateRows.length === 0 ? (
                <p className="text-[12px] text-gray-400 italic py-4 text-center">
                  No mandates linked to this signer.
                </p>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="w-8 px-2 py-2"></th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Mandate ID</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Current Name</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mandateRows.map((row) => (
                        <tr key={row.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40">
                          <td className="px-2 py-2">
                            <Checkbox
                              checked={selectedIds.has(row.id)}
                              onCheckedChange={() => toggleRow(row.id)}
                              className="data-[state=checked]:bg-[#DB0011] data-[state=checked]:border-[#DB0011]"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <span className="text-[10px] font-mono text-gray-500">
                              {row.id.slice(0, 8)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-[12px] text-gray-800">{row.company_name}</td>
                          <td className="px-2 py-2 text-[12px] text-gray-700">{row.director_name}</td>
                          <td className="px-2 py-2 text-[11px] text-gray-500">{row.title ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Diff preview */}
            {diffs.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Changes Preview ({diffs.length})
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {diffs.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono text-gray-400">{d.mandateId.slice(0, 8)}</span>
                      <span className="text-gray-600">{d.companyName}</span>
                      <span className="text-red-500 line-through">{d.before}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-green-700 font-medium">{d.after}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verification gate */}
            {diffs.length > 0 && (
              <label className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                <Checkbox
                  checked={verified}
                  onCheckedChange={(v) => setVerified(v === true)}
                  className="data-[state=checked]:bg-[#DB0011] data-[state=checked]:border-[#DB0011] mt-0.5"
                />
                <span className="text-[11px] text-gray-600 leading-snug">
                  I have verified that the selected mandates belong to this signer
                  {' '}(<span className="font-mono">{signatory.signatory_display_id}</span>) and should be updated.
                </span>
              </label>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <X className="h-3.5 w-3.5" />Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={!canApply}
                className="flex items-center gap-1 text-[12px] text-white bg-[#DB0011] hover:bg-[#B00010] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Apply to {selectedIds.size} mandate{selectedIds.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
