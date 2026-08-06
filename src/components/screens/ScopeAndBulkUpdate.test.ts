/**
 * Tests for the scope-filter, signatory-search, and bulk-update helpers.
 *
 * Covers:
 * - filterByScope (mandates tab)
 * - filterSignatoriesByScope (signatories tab)
 * - buildBulkUpdateDiff (diff preview)
 * - BULK_EDITABLE_FIELDS validation (name field)
 *
 * Run with: npx vitest run src/components/screens/ScopeAndBulkUpdate.test.ts
 */

import {
  filterByScope,
  filterSignatoriesByScope,
  type CompanyGroup,
} from '@/hooks/use-company-groups';
import {
  buildBulkUpdateDiff,
  BULK_EDITABLE_FIELDS,
  type BulkUpdateMandateRow,
} from '@/lib/bulkUpdate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMandate(overrides: Partial<{ id: string; company_name: string; director_name: string }> = {}) {
  return {
    id: 'm1',
    company_name: 'Acme Corp',
    director_name: 'John Smith',
    ...overrides,
  };
}

function makeSignatory(overrides: Partial<{ id: string; related_companies: string[] }> = {}) {
  return {
    id: 's1',
    related_companies: ['Acme Corp'],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<CompanyGroup> = {}): CompanyGroup {
  return {
    id: 'g1',
    group_code: 'GRP-001',
    group_name: 'Asia Holdings',
    member_companies: ['Acme Corp', 'Beta Ltd'],
    notes: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMandateRow(overrides: Partial<BulkUpdateMandateRow> = {}): BulkUpdateMandateRow {
  return {
    id: 'm1',
    company_name: 'Acme Corp',
    director_name: 'John Smith',
    title: 'Director',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterByScope (mandates tab)
// ---------------------------------------------------------------------------

describe('filterByScope', () => {
  test('scope "all" returns all rows unchanged', () => {
    const rows = [makeMandate({ id: 'm1' }), makeMandate({ id: 'm2', company_name: 'Beta Ltd' })];
    expect(filterByScope(rows, 'all', null, null)).toHaveLength(2);
  });

  test('scope "company" keeps only rows matching the selected company', () => {
    const rows = [
      makeMandate({ id: 'm1', company_name: 'Acme Corp' }),
      makeMandate({ id: 'm2', company_name: 'Beta Ltd' }),
      makeMandate({ id: 'm3', company_name: 'Acme Corp' }),
    ];
    const filtered = filterByScope(rows, 'company', 'Acme Corp', null);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.company_name === 'Acme Corp')).toBe(true);
  });

  test('scope "company" with no selected company returns all rows', () => {
    const rows = [makeMandate(), makeMandate({ id: 'm2', company_name: 'Beta Ltd' })];
    expect(filterByScope(rows, 'company', null, null)).toHaveLength(2);
  });

  test('scope "group" keeps rows whose company is in the group member list', () => {
    const group = makeGroup({ member_companies: ['Acme Corp', 'Gamma Inc'] });
    const rows = [
      makeMandate({ id: 'm1', company_name: 'Acme Corp' }),
      makeMandate({ id: 'm2', company_name: 'Beta Ltd' }),
      makeMandate({ id: 'm3', company_name: 'Gamma Inc' }),
      makeMandate({ id: 'm4', company_name: 'Delta SA' }),
    ];
    const filtered = filterByScope(rows, 'group', null, group);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.company_name).sort()).toEqual(['Acme Corp', 'Gamma Inc']);
  });

  test('scope "group" with no selected group returns all rows', () => {
    const rows = [makeMandate(), makeMandate({ id: 'm2', company_name: 'Beta Ltd' })];
    expect(filterByScope(rows, 'group', null, null)).toHaveLength(2);
  });

  test('empty group member list returns no rows', () => {
    const group = makeGroup({ member_companies: [] });
    const rows = [makeMandate(), makeMandate({ id: 'm2', company_name: 'Beta Ltd' })];
    expect(filterByScope(rows, 'group', null, group)).toHaveLength(0);
  });

  test('does not mutate the input array', () => {
    const rows = [makeMandate(), makeMandate({ id: 'm2', company_name: 'Beta Ltd' })];
    const snapshot = [...rows];
    filterByScope(rows, 'company', 'Acme Corp', null);
    expect(rows).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// filterSignatoriesByScope (signatories tab)
// ---------------------------------------------------------------------------

describe('filterSignatoriesByScope', () => {
  test('scope "all" returns all signatories', () => {
    const rows = [
      makeSignatory({ id: 's1', related_companies: ['Acme Corp'] }),
      makeSignatory({ id: 's2', related_companies: ['Beta Ltd'] }),
    ];
    expect(filterSignatoriesByScope(rows, 'all', null, null)).toHaveLength(2);
  });

  test('scope "company" keeps signatories whose related_companies includes the company', () => {
    const rows = [
      makeSignatory({ id: 's1', related_companies: ['Acme Corp', 'Beta Ltd'] }),
      makeSignatory({ id: 's2', related_companies: ['Beta Ltd'] }),
      makeSignatory({ id: 's3', related_companies: ['Gamma Inc'] }),
    ];
    const filtered = filterSignatoriesByScope(rows, 'company', 'Acme Corp', null);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('s1');
  });

  test('scope "group" keeps signatories related to any company in the group', () => {
    const group = makeGroup({ member_companies: ['Acme Corp', 'Gamma Inc'] });
    const rows = [
      makeSignatory({ id: 's1', related_companies: ['Acme Corp'] }),
      makeSignatory({ id: 's2', related_companies: ['Beta Ltd'] }),
      makeSignatory({ id: 's3', related_companies: ['Beta Ltd', 'Gamma Inc'] }),
      makeSignatory({ id: 's4', related_companies: ['Delta SA'] }),
    ];
    const filtered = filterSignatoriesByScope(rows, 'group', null, group);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.id).sort()).toEqual(['s1', 's3']);
  });

  test('signatory spanning multiple companies in a group is returned once', () => {
    const group = makeGroup({ member_companies: ['Acme Corp', 'Beta Ltd'] });
    const rows = [
      makeSignatory({ id: 's1', related_companies: ['Acme Corp', 'Beta Ltd'] }),
    ];
    expect(filterSignatoriesByScope(rows, 'group', null, group)).toHaveLength(1);
  });

  test('signatory with empty related_companies is excluded by company scope', () => {
    const rows = [makeSignatory({ id: 's1', related_companies: [] })];
    expect(filterSignatoriesByScope(rows, 'company', 'Acme Corp', null)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildBulkUpdateDiff
// ---------------------------------------------------------------------------

describe('buildBulkUpdateDiff', () => {
  test('returns empty diff when no rows selected', () => {
    const rows = [makeMandateRow()];
    expect(buildBulkUpdateDiff(rows, [], { director_name: 'New Name' })).toEqual([]);
  });

  test('returns empty diff when patch value equals current value', () => {
    const rows = [makeMandateRow({ director_name: 'John Smith' })];
    expect(buildBulkUpdateDiff(rows, ['m1'], { director_name: 'John Smith' })).toEqual([]);
  });

  test('produces one diff entry per changed row × field', () => {
    const rows = [
      makeMandateRow({ id: 'm1', company_name: 'Acme', director_name: 'John Smith' }),
      makeMandateRow({ id: 'm2', company_name: 'Beta', director_name: 'John Smith' }),
      makeMandateRow({ id: 'm3', company_name: 'Gamma', director_name: 'Jane Doe' }),
    ];
    const diffs = buildBulkUpdateDiff(rows, ['m1', 'm2', 'm3'], { director_name: 'John Smith' });
    // m1 and m2 already equal -> no diff; m3 changes Jane Doe -> John Smith
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({
      mandateId: 'm3',
      companyName: 'Gamma',
      field: 'director_name',
      before: 'Jane Doe',
      after: 'John Smith',
    });
  });

  test('only selected rows are included in the diff', () => {
    const rows = [
      makeMandateRow({ id: 'm1', director_name: 'Old' }),
      makeMandateRow({ id: 'm2', director_name: 'Old' }),
    ];
    const diffs = buildBulkUpdateDiff(rows, ['m1'], { director_name: 'New' });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].mandateId).toBe('m1');
  });

  test('handles multiple fields in the patch', () => {
    const rows = [makeMandateRow({ id: 'm1', director_name: 'Old', title: 'Director' })];
    const diffs = buildBulkUpdateDiff(rows, ['m1'], { director_name: 'New', title: 'CEO' });
    expect(diffs).toHaveLength(2);
    expect(diffs.map((d) => d.field).sort()).toEqual(['director_name', 'title']);
  });

  test('treats null current value as empty string in the diff', () => {
    const rows = [makeMandateRow({ id: 'm1', title: null as unknown as string })];
    const diffs = buildBulkUpdateDiff(rows, ['m1'], { title: 'CEO' });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].before).toBe('');
    expect(diffs[0].after).toBe('CEO');
  });
});

// ---------------------------------------------------------------------------
// BULK_EDITABLE_FIELDS validation
// ---------------------------------------------------------------------------

describe('BULK_EDITABLE_FIELDS validation', () => {
  test('only the name field is enabled in this iteration', () => {
    expect(BULK_EDITABLE_FIELDS).toHaveLength(1);
    expect(BULK_EDITABLE_FIELDS[0].key).toBe('director_name');
  });

  test('empty name is invalid', () => {
    const validate = BULK_EDITABLE_FIELDS[0].validate!;
    expect(validate('')).not.toBeNull();
    expect(validate('   ')).not.toBeNull();
  });

  test('non-empty name within length limit is valid', () => {
    const validate = BULK_EDITABLE_FIELDS[0].validate!;
    expect(validate('John Smith')).toBeNull();
  });

  test('name over 200 characters is invalid', () => {
    const validate = BULK_EDITABLE_FIELDS[0].validate!;
    expect(validate('x'.repeat(201))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verification gate contract (canApply logic mirror)
// ---------------------------------------------------------------------------

describe('Bulk update verification gate', () => {
  test('gate blocks apply when no rows selected', () => {
    const rows = [makeMandateRow()];
    const selectedIds: string[] = [];
    const diffs = buildBulkUpdateDiff(rows, selectedIds, { director_name: 'New' });
    const canApply = selectedIds.length > 0 && diffs.length > 0;
    expect(canApply).toBe(false);
  });

  test('gate blocks apply when diff is empty (no actual change)', () => {
    const rows = [makeMandateRow({ director_name: 'Same' })];
    const selectedIds = ['m1'];
    const diffs = buildBulkUpdateDiff(rows, selectedIds, { director_name: 'Same' });
    const canApply = selectedIds.length > 0 && diffs.length > 0;
    expect(canApply).toBe(false);
  });

  test('gate allows apply when rows selected and diff exists and verified', () => {
    const rows = [makeMandateRow({ director_name: 'Old' })];
    const selectedIds = ['m1'];
    const diffs = buildBulkUpdateDiff(rows, selectedIds, { director_name: 'New' });
    const verified = true;
    const validationErrors = BULK_EDITABLE_FIELDS[0].validate!('New');
    const canApply =
      selectedIds.length > 0 &&
      diffs.length > 0 &&
      validationErrors === null &&
      verified;
    expect(canApply).toBe(true);
  });

  test('gate blocks apply when verified is false', () => {
    const rows = [makeMandateRow({ director_name: 'Old' })];
    const selectedIds = ['m1'];
    const diffs = buildBulkUpdateDiff(rows, selectedIds, { director_name: 'New' });
    const verified = false;
    const validationErrors = BULK_EDITABLE_FIELDS[0].validate!('New');
    const canApply =
      selectedIds.length > 0 &&
      diffs.length > 0 &&
      validationErrors === null &&
      verified;
    expect(canApply).toBe(false);
  });
});
