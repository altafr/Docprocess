import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanyGroup {
  id: string;
  group_code: string | null;
  group_name: string;
  member_companies: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type GroupScope = 'all' | 'group' | 'company';

// ---------------------------------------------------------------------------
// useCompanyGroups — fetch / create / update / delete company groups
// ---------------------------------------------------------------------------

export function useCompanyGroups() {
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('company_groups')
      .select('*')
      .order('group_name');
    if (!error && data) {
      setGroups(data as CompanyGroup[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const createGroup = useCallback(async (input: { group_name: string; member_companies: string[]; notes?: string | null }) => {
    const { data, error } = await supabase
      .from('company_groups')
      .insert({
        group_name: input.group_name,
        member_companies: input.member_companies,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (data) {
      const created = data as CompanyGroup;
      setGroups((prev) => [...prev, created].sort((a, b) => a.group_name.localeCompare(b.group_name)));
    }
    return data as CompanyGroup | null;
  }, []);

  const updateGroup = useCallback(async (id: string, patch: Partial<Pick<CompanyGroup, 'group_name' | 'member_companies' | 'notes'>>) => {
    const { data, error } = await supabase
      .from('company_groups')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (data) {
      const updated = data as CompanyGroup;
      setGroups((prev) => prev.map((g) => g.id === id ? updated : g).sort((a, b) => a.group_name.localeCompare(b.group_name)));
    }
    return data as CompanyGroup | null;
  }, []);

  const deleteGroup = useCallback(async (id: string) => {
    const { error } = await supabase.from('company_groups').delete().eq('id', id);
    if (error) throw new Error(error.message);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  return { groups, loading, fetchGroups, createGroup, updateGroup, deleteGroup };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Filter mandates by the active scope.
 * - 'all': no filtering
 * - 'company': keep rows whose company_name === selectedCompany
 * - 'group': keep rows whose company_name is in the selected group's member_companies
 */
export function filterByScope<T extends { company_name: string }>(
  rows: T[],
  scope: GroupScope,
  selectedCompany: string | null,
  selectedGroup: CompanyGroup | null,
): T[] {
  if (scope === 'all') return rows;
  if (scope === 'company') {
    if (!selectedCompany) return rows;
    return rows.filter((r) => r.company_name === selectedCompany);
  }
  if (scope === 'group') {
    if (!selectedGroup) return rows;
    const members = new Set(selectedGroup.member_companies);
    return rows.filter((r) => members.has(r.company_name));
  }
  return rows;
}

/**
 * Filter signatories by a company or group: keep signatories whose
 * related_companies array intersects the selected company or the group's members.
 */
export function filterSignatoriesByScope<T extends { related_companies: string[] }>(
  rows: T[],
  scope: GroupScope,
  selectedCompany: string | null,
  selectedGroup: CompanyGroup | null,
): T[] {
  if (scope === 'all') return rows;
  if (scope === 'company') {
    if (!selectedCompany) return rows;
    return rows.filter((r) => r.related_companies.includes(selectedCompany));
  }
  if (scope === 'group') {
    if (!selectedGroup) return rows;
    const members = new Set(selectedGroup.member_companies);
    return rows.filter((r) => r.related_companies.some((c) => members.has(c)));
  }
  return rows;
}
