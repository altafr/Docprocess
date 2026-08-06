import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Check, CreditCard as Edit2, FolderPlus, Folder } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useCompanyGroups, type CompanyGroup } from '@/hooks/use-company-groups';

// ---------------------------------------------------------------------------
// ManageGroupsModal — create / edit / delete company groups from the Mandates tab
// ---------------------------------------------------------------------------

export function ManageGroupsModal({
  open,
  onOpenChange,
  availableCompanies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCompanies: string[];
}) {
  const { groups, loading, createGroup, updateGroup, deleteGroup, fetchGroups } = useCompanyGroups();
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMembers, setEditMembers] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CompanyGroup | null>(null);

  useEffect(() => {
    if (open) fetchGroups();
  }, [open, fetchGroups]);

  const resetCreate = () => {
    setCreating(false);
    setNewName('');
    setNewMembers(new Set());
  };

  const toggleNewMember = (company: string) => {
    setNewMembers((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  };

  const toggleEditMember = (company: string) => {
    setEditMembers((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast({ title: 'Group name required', variant: 'destructive' });
      return;
    }
    try {
      await createGroup({ group_name: newName.trim(), member_companies: [...newMembers] });
      toast({ title: 'Group created', description: `${newName.trim()} with ${newMembers.size} compan${newMembers.size === 1 ? 'y' : 'ies'}.` });
      resetCreate();
    } catch (e: any) {
      toast({ title: 'Create failed', description: e.message, variant: 'destructive' });
    }
  };

  const startEdit = (g: CompanyGroup) => {
    setEditingId(g.id);
    setEditName(g.group_name);
    setEditMembers(new Set(g.member_companies));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditMembers(new Set());
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) {
      toast({ title: 'Group name required', variant: 'destructive' });
      return;
    }
    try {
      await updateGroup(id, { group_name: editName.trim(), member_companies: [...editMembers] });
      toast({ title: 'Group updated' });
      cancelEdit();
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup(deleteTarget.id);
      toast({ title: 'Group deleted', description: deleteTarget.group_name });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
              <Folder className="h-4 w-4 text-[#DB0011]" />
              Manage Company Groups
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Create button / form */}
            {!creating ? (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 text-[12px] text-[#DB0011] hover:text-[#B00010] px-3 py-1.5 rounded-lg border border-[#DB0011]/30 hover:bg-[#DB0011]/5 transition-colors"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New Group
              </button>
            ) : (
              <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    placeholder="Group name (e.g. Asia Pacific Holdings)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-8 text-[12px] flex-1"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Member Companies ({newMembers.size} selected)
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                    {availableCompanies.length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic px-3 py-2">No companies available.</p>
                    ) : (
                      availableCompanies.map((c) => (
                        <label key={c} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                          <Checkbox
                            checked={newMembers.has(c)}
                            onCheckedChange={() => toggleNewMember(c)}
                            className="data-[state=checked]:bg-[#DB0011] data-[state=checked]:border-[#DB0011]"
                          />
                          <span className="text-[12px] text-gray-700">{c}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    className="flex items-center gap-1 text-[11px] text-white bg-[#DB0011] hover:bg-[#B00010] px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Check className="h-3 w-3" />Create
                  </button>
                  <button
                    onClick={resetCreate}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <X className="h-3 w-3" />Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Existing groups list */}
            <div className="space-y-2">
              {loading ? (
                <p className="text-[12px] text-gray-400 italic">Loading groups…</p>
              ) : groups.length === 0 && !creating ? (
                <p className="text-[12px] text-gray-400 italic py-4 text-center">
                  No groups yet. Click "New Group" to create one.
                </p>
              ) : (
                <AnimatePresence>
                  {groups.map((g) => (
                    <motion.div
                      key={g.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="rounded-lg border border-gray-200 bg-white"
                    >
                      {editingId === g.id ? (
                        // Edit mode
                        <div className="p-3 space-y-3 bg-blue-50/30 rounded-lg">
                          <Input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8 text-[12px]"
                          />
                          <div>
                            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                              Member Companies ({editMembers.size} selected)
                            </p>
                            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                              {availableCompanies.map((c) => (
                                <label key={c} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                                  <Checkbox
                                    checked={editMembers.has(c)}
                                    onCheckedChange={() => toggleEditMember(c)}
                                    className="data-[state=checked]:bg-[#DB0011] data-[state=checked]:border-[#DB0011]"
                                  />
                                  <span className="text-[12px] text-gray-700">{c}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(g.id)}
                              className="flex items-center gap-1 text-[11px] text-white bg-[#DB0011] hover:bg-[#B00010] px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <Check className="h-3 w-3" />Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                            >
                              <X className="h-3 w-3" />Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <div className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded border border-gray-200">
                                {g.group_code ?? '—'}
                              </span>
                              <span className="text-[13px] font-semibold text-gray-900">{g.group_name}</span>
                              <span className="text-[10px] text-gray-400">
                                {g.member_companies.length} compan{g.member_companies.length === 1 ? 'y' : 'ies'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => startEdit(g)}
                                className="p-1 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Edit group"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(g)}
                                className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                                title="Delete group"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          {g.member_companies.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {g.member_companies.map((c) => (
                                <span key={c} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100">
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px]">Delete group "{deleteTarget?.group_name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px]">
              This removes the group only. The member companies and their mandates are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-[12px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="h-8 text-[12px] bg-[#DB0011] hover:bg-[#B00010] text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
