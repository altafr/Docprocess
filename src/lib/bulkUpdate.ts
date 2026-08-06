import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A field that can be bulk-updated across company mandates.
 * The registry pattern keeps the bulk-update flow field-agnostic: adding a new
 * editable field only requires registering it here and adding an input control
 * in the BulkUpdateModal — the diff preview and apply logic do not change.
 */
export interface EditableFieldDef {
  key: string;
  label: string;
  /** Validate the new value. Return null if valid, or an error message. */
  validate?: (value: string) => string | null;
}

/** Fields currently enabled for bulk update. Only the name is enabled in this iteration. */
export const BULK_EDITABLE_FIELDS: EditableFieldDef[] = [
  {
    key: 'director_name',
    label: 'Signer Name',
    validate: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return 'Name cannot be empty.';
      if (trimmed.length > 200) return 'Name is too long (max 200 characters).';
      return null;
    },
  },
];

/** A single mandate row shown in the bulk-update modal for verification. */
export interface BulkUpdateMandateRow {
  id: string;
  company_name: string;
  director_name: string;
  title: string | null;
}

/** A before/after entry in the diff preview. */
export interface BulkUpdateDiffEntry {
  mandateId: string;
  companyName: string;
  field: string;
  before: string;
  after: string;
}

/**
 * Build a diff preview for the selected mandate rows and the proposed patch.
 * Returns one entry per (row × field) where the value actually changes.
 */
export function buildBulkUpdateDiff(
  rows: BulkUpdateMandateRow[],
  selectedIds: string[],
  patch: Record<string, string>,
): BulkUpdateDiffEntry[] {
  const selected = rows.filter((r) => selectedIds.includes(r.id));
  const diffs: BulkUpdateDiffEntry[] = [];
  for (const row of selected) {
    for (const [field, newValue] of Object.entries(patch)) {
      const currentValue = String((row as any)[field] ?? '');
      if (currentValue !== newValue) {
        diffs.push({
          mandateId: row.id,
          companyName: row.company_name,
          field,
          before: currentValue,
          after: newValue,
        });
      }
    }
  }
  return diffs;
}

/**
 * Apply a bulk update to the selected mandate IDs.
 * Returns the number of rows updated.
 */
export async function applyBulkUpdate(
  selectedMandateIds: string[],
  patch: Record<string, string>,
): Promise<number> {
  if (selectedMandateIds.length === 0) return 0;
  const { data, error } = await supabase
    .from('company_mandates')
    .update({ ...patch, last_updated: new Date().toISOString() })
    .in('id', selectedMandateIds)
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * Fetch the mandate rows linked to a signatory by director_name_key.
 * These are the rows the user will verify before applying a bulk update.
 */
export async function fetchMandatesForSignatory(directorNameKey: string): Promise<BulkUpdateMandateRow[]> {
  const { data, error } = await supabase
    .from('company_mandates')
    .select('id, company_name, director_name, title')
    .eq('director_name', directorNameKey)
    .order('company_name');
  if (error) throw new Error(error.message);
  return (data ?? []) as BulkUpdateMandateRow[];
}
