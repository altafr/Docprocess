import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Pencil, Trash2, Lock, Tag, X, Save, RefreshCw, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  is_default: boolean;
  user_id: string | null;
  created_at: string;
}

interface FormState {
  name: string;
  description: string;
  color: string;
}

const EMPTY_FORM: FormState = { name: '', description: '', color: 'blue' };

export const COLOR_OPTIONS = [
  { name: 'sky',     label: 'Sky',     dot: 'bg-sky-500',     badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  { name: 'blue',    label: 'Blue',    dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { name: 'teal',    label: 'Teal',    dot: 'bg-teal-500',    badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  { name: 'emerald', label: 'Emerald', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { name: 'green',   label: 'Green',   dot: 'bg-green-500',   badge: 'bg-green-50 text-green-700 border-green-200' },
  { name: 'lime',    label: 'Lime',    dot: 'bg-lime-500',    badge: 'bg-lime-50 text-lime-700 border-lime-200' },
  { name: 'yellow',  label: 'Yellow',  dot: 'bg-yellow-500',  badge: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { name: 'amber',   label: 'Amber',   dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { name: 'orange',  label: 'Orange',  dot: 'bg-orange-500',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  { name: 'rose',    label: 'Rose',    dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  { name: 'pink',    label: 'Pink',    dot: 'bg-pink-500',    badge: 'bg-pink-50 text-pink-700 border-pink-200' },
  { name: 'cyan',    label: 'Cyan',    dot: 'bg-cyan-500',    badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { name: 'slate',   label: 'Slate',   dot: 'bg-slate-500',   badge: 'bg-slate-50 text-slate-700 border-slate-200' },
  { name: 'stone',   label: 'Stone',   dot: 'bg-stone-500',   badge: 'bg-stone-50 text-stone-700 border-stone-200' },
  { name: 'zinc',    label: 'Zinc',    dot: 'bg-zinc-500',    badge: 'bg-zinc-50 text-zinc-700 border-zinc-200' },
  { name: 'gray',    label: 'Gray',    dot: 'bg-gray-400',    badge: 'bg-gray-50 text-gray-700 border-gray-200' },
];

export function getBadgeClass(color: string) {
  return COLOR_OPTIONS.find((c) => c.name === color)?.badge ?? 'bg-gray-50 text-gray-700 border-gray-200';
}

function validate(form: FormState): string | null {
  if (!form.name.trim()) return 'Category name is required.';
  if (form.name.trim().length > 60) return 'Name must be 60 characters or fewer.';
  if (form.description.length > 300) return 'Description must be 300 characters or fewer.';
  return null;
}

export function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('document_categories')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name');
    if (data) setCategories(data as Category[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setForm({ name: cat.name, description: cat.description, color: cat.color });
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); setEditing(null); };

  const save = async () => {
    const err = validate(form);
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError(null);

    if (editing) {
      const patch: Partial<Category> = { description: form.description, color: form.color };
      if (!editing.is_default) patch.name = form.name;
      const { error } = await supabase.from('document_categories').update(patch).eq('id', editing.id);
      if (error) { setFormError(error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('document_categories').insert({
        name: form.name.trim(),
        description: form.description.trim(),
        color: form.color,
        is_default: false,
        user_id: null,
      });
      if (error) { setFormError(error.message); setSaving(false); return; }
    }

    setSaving(false);
    closeForm();
    fetch();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await supabase.from('document_categories').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    fetch();
  };

  const defaults = categories.filter((c) => c.is_default);
  const custom = categories.filter((c) => !c.is_default);

  return (
    <div className="font-['Inter',sans-serif] space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Document Categories</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Manage how documents are classified. System defaults cannot be deleted.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetch}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <Button
            onClick={openAdd}
            className="bg-[#DB0011] hover:bg-[#B00010] text-white text-[13px] h-9 gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add Category
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* System defaults */}
          <Section title="System Defaults" count={defaults.length}>
            {defaults.map((cat, idx) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                index={idx}
                onEdit={() => openEdit(cat)}
                onDelete={null}
              />
            ))}
          </Section>

          {/* Custom categories */}
          <Section title="Custom Categories" count={custom.length} empty="No custom categories yet. Add one above.">
            {custom.map((cat, idx) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                index={idx}
                onEdit={() => openEdit(cat)}
                onDelete={() => setDeleteTarget(cat)}
              />
            ))}
          </Section>
        </div>
      )}

      {/* Add / Edit panel */}
      <AnimatePresence>
        {formOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={closeForm}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="text-[15px] font-semibold text-gray-900">
                  {editing ? 'Edit Category' : 'Add Category'}
                </h3>
                <button onClick={closeForm} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
                  <X className="h-4 w-4 text-gray-500" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* Name */}
                <div>
                  <label className="block text-[12px] font-medium text-gray-600 mb-1.5">
                    Category Name
                    {editing?.is_default && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-gray-400">
                        <Lock className="h-3 w-3" /> locked for system defaults
                      </span>
                    )}
                  </label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={!!editing?.is_default}
                    placeholder="e.g. Board Minutes"
                    className="h-9 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[12px] font-medium text-gray-600 mb-1.5">
                    Description
                    <span className="ml-1 text-gray-400 font-normal">(used as AI classification hint)</span>
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder="Describe what documents belong in this category..."
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#DB0011]/30 focus:border-[#DB0011] resize-none"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">{form.description.length}/300</p>
                </div>

                {/* Color picker */}
                <div>
                  <label className="block text-[12px] font-medium text-gray-600 mb-2">Badge Color</label>
                  <div className="grid grid-cols-8 gap-2">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.name}
                        title={c.label}
                        onClick={() => setForm((f) => ({ ...f, color: c.name }))}
                        className={`h-7 w-7 rounded-full border-2 transition-all ${c.dot} ${
                          form.color === c.name
                            ? 'border-gray-900 scale-110 shadow-sm'
                            : 'border-transparent hover:border-gray-400'
                        }`}
                      />
                    ))}
                  </div>
                  {/* Preview */}
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">Preview:</span>
                    <span className={`inline-flex text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${getBadgeClass(form.color)}`}>
                      {form.name || 'Category Name'}
                    </span>
                  </div>
                </div>

                {formError && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-[12px] text-red-700">{formError}</p>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
                <Button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 bg-[#DB0011] hover:bg-[#B00010] text-white text-[13px] h-9 gap-1.5"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" onClick={closeForm} className="h-9 text-[13px]">
                  Cancel
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setDeleteTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-9 w-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-gray-900">Delete Category</h3>
                </div>
                <p className="text-[13px] text-gray-600 mb-5">
                  Delete <strong>{deleteTarget.name}</strong>? This cannot be undone. Documents already classified
                  with this category will retain their label.
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={confirmDelete}
                    disabled={deleting}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[13px] h-9"
                  >
                    {deleting ? 'Deleting...' : 'Delete'}
                  </Button>
                  <Button variant="outline" onClick={() => setDeleteTarget(null)} className="flex-1 h-9 text-[13px]">
                    Cancel
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
        <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{count}</span>
      </div>
      {count === 0 && empty ? (
        <p className="text-[12px] text-gray-400 py-4 px-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          {empty}
        </p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-50">
          <AnimatePresence initial={false}>
            {children}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category: cat,
  index,
  onEdit,
  onDelete,
}: {
  category: Category;
  index: number;
  onEdit: () => void;
  onDelete: (() => void) | null;
}) {
  const badge = getBadgeClass(cat.color);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.03 }}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors"
    >
      {/* Badge preview */}
      <span className={`shrink-0 inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border min-w-[90px] justify-center ${badge}`}>
        {cat.name}
      </span>

      {/* Description */}
      <p className="flex-1 text-[12px] text-gray-500 line-clamp-1 min-w-0">
        {cat.description || <span className="italic text-gray-300">No description</span>}
      </p>

      {/* System badge */}
      {cat.is_default && (
        <span className="shrink-0 flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          <Lock className="h-2.5 w-2.5" />
          System
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {onDelete ? (
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="p-1.5 w-7 h-7" />
        )}
      </div>
    </motion.div>
  );
}
