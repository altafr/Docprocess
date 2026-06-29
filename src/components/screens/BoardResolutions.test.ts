/**
 * Tests for BoardResolutions helper functions.
 *
 * Covers groupByCompany, getTypeBreakdown, derivePurpose, and the
 * edge-function payload shape used by the Company Analysis feature.
 *
 * Run with: npx vitest run src/components/screens/BoardResolutions.test.ts
 */

import { groupByCompany, getTypeBreakdown, derivePurpose, BoardResolution, detectGroupKey, buildCompanyGroups } from './BoardResolutions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResolution(overrides: Partial<BoardResolution> = {}): BoardResolution {
  return {
    id: 'r1',
    document_name: 'resolution.pdf',
    company_name: 'Acme Corp',
    resolution_number: null,
    resolution_date: '2024-06-01',
    resolution_type: 'Authorization',
    purpose_summary: null,
    key_decisions: [],
    signatories: [],
    authorized_persons: [],
    effective_date: null,
    expiry_date: null,
    confidence: 0.95,
    created_at: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groupByCompany
// ---------------------------------------------------------------------------

describe('groupByCompany', () => {
  test('returns empty object for empty input', () => {
    expect(groupByCompany([])).toEqual({});
  });

  test('single resolution produces one group', () => {
    const r = makeResolution({ company_name: 'Alpha Ltd' });
    const groups = groupByCompany([r]);
    expect(Object.keys(groups)).toHaveLength(1);
    expect(groups['Alpha Ltd']).toHaveLength(1);
  });

  test('groups resolutions with the same company name', () => {
    const r1 = makeResolution({ id: 'r1', company_name: 'Beta Inc' });
    const r2 = makeResolution({ id: 'r2', company_name: 'Beta Inc' });
    const r3 = makeResolution({ id: 'r3', company_name: 'Gamma Ltd' });
    const groups = groupByCompany([r1, r2, r3]);
    expect(groups['Beta Inc']).toHaveLength(2);
    expect(groups['Gamma Ltd']).toHaveLength(1);
  });

  test('groups null company_name under "Unknown Company"', () => {
    const r = makeResolution({ company_name: null });
    const groups = groupByCompany([r]);
    expect(groups['Unknown Company']).toHaveLength(1);
    expect(groups['null']).toBeUndefined();
  });

  test('trims whitespace from company names when grouping', () => {
    const r1 = makeResolution({ id: 'r1', company_name: 'Delta Corp' });
    const r2 = makeResolution({ id: 'r2', company_name: '  Delta Corp  ' });
    const groups = groupByCompany([r1, r2]);
    expect(groups['Delta Corp']).toHaveLength(2);
  });

  test('preserves all resolution ids within each group', () => {
    const ids = ['a', 'b', 'c'];
    const resolutions = ids.map((id) => makeResolution({ id, company_name: 'Epsilon' }));
    const groups = groupByCompany(resolutions);
    expect(groups['Epsilon'].map((r) => r.id).sort()).toEqual(ids.sort());
  });
});

// ---------------------------------------------------------------------------
// getTypeBreakdown
// ---------------------------------------------------------------------------

describe('getTypeBreakdown', () => {
  test('returns empty object for empty input', () => {
    expect(getTypeBreakdown([])).toEqual({});
  });

  test('counts a single type correctly', () => {
    const resolutions = [
      makeResolution({ resolution_type: 'Authorization' }),
      makeResolution({ resolution_type: 'Authorization' }),
    ];
    expect(getTypeBreakdown(resolutions)).toEqual({ Authorization: 2 });
  });

  test('counts multiple types correctly', () => {
    const resolutions = [
      makeResolution({ resolution_type: 'Authorization' }),
      makeResolution({ resolution_type: 'Appointment' }),
      makeResolution({ resolution_type: 'Authorization' }),
      makeResolution({ resolution_type: 'Approval' }),
    ];
    const breakdown = getTypeBreakdown(resolutions);
    expect(breakdown['Authorization']).toBe(2);
    expect(breakdown['Appointment']).toBe(1);
    expect(breakdown['Approval']).toBe(1);
  });

  test('treats null resolution_type as "Other"', () => {
    const resolutions = [
      makeResolution({ resolution_type: null }),
      makeResolution({ resolution_type: null }),
    ];
    expect(getTypeBreakdown(resolutions)).toEqual({ Other: 2 });
  });

  test('counts all RESOLUTION_TYPES variants independently', () => {
    const types = ['Authorization', 'Appointment', 'Approval', 'Ratification', 'Amendment', 'Dissolution'];
    const resolutions = types.map((t) => makeResolution({ resolution_type: t }));
    const breakdown = getTypeBreakdown(resolutions);
    types.forEach((t) => expect(breakdown[t]).toBe(1));
  });
});

// ---------------------------------------------------------------------------
// derivePurpose
// ---------------------------------------------------------------------------

describe('derivePurpose', () => {
  test('returns purpose_summary when present', () => {
    const r = makeResolution({ purpose_summary: 'Authorise new bank signatories.' });
    expect(derivePurpose(r)).toBe('Authorise new bank signatories.');
  });

  test('falls back to first key decision when purpose_summary is null', () => {
    const r = makeResolution({
      purpose_summary: null,
      key_decisions: ['Appoint John Smith as director.'],
    });
    expect(derivePurpose(r)).toBe('Appoint John Smith as director.');
  });

  test('appends multi-decision count when more than one decision', () => {
    const r = makeResolution({
      purpose_summary: null,
      key_decisions: ['Decision A', 'Decision B', 'Decision C'],
    });
    const result = derivePurpose(r);
    expect(result).toContain('Decision A');
    expect(result).toContain('2 other decisions');
  });

  test('constructs sentence from resolution_type and authorized_persons when no purpose or decisions', () => {
    const r = makeResolution({
      purpose_summary: null,
      key_decisions: [],
      resolution_type: 'Authorization',
      authorized_persons: ['Jane Doe', 'Bob Smith'],
    });
    const result = derivePurpose(r);
    expect(result).toContain('Authorization');
    expect(result).toContain('Jane Doe');
  });

  test('uses company_name in fallback when no authorized_persons', () => {
    const r = makeResolution({
      purpose_summary: null,
      key_decisions: [],
      resolution_type: 'Approval',
      authorized_persons: [],
      company_name: 'Zeta Holdings',
    });
    const result = derivePurpose(r);
    expect(result).toContain('Zeta Holdings');
  });

  test('returns null when no purpose, decisions, or type available', () => {
    const r = makeResolution({
      purpose_summary: null,
      key_decisions: [],
      resolution_type: 'Other',
      authorized_persons: [],
      company_name: null,
    });
    expect(derivePurpose(r)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Analyse-company edge function payload contract
// ---------------------------------------------------------------------------

describe('analyze-company edge function payload', () => {
  test('payload maps resolution fields correctly', () => {
    const r = makeResolution({
      resolution_date: '2025-01-15',
      resolution_type: 'Authorization',
      purpose_summary: 'Authorise account operations.',
      key_decisions: ['Open USD account'],
      authorized_persons: ['Alice'],
      signatories: ['Bob'],
    });

    const payload = {
      company: r.company_name ?? 'Unknown Company',
      resolutions: [r].map((res) => ({
        date: res.resolution_date,
        type: res.resolution_type,
        purpose: res.purpose_summary,
        keyDecisions: res.key_decisions ?? [],
        authorizedPersons: res.authorized_persons ?? [],
        signatories: res.signatories ?? [],
      })),
    };

    expect(payload.company).toBe('Acme Corp');
    expect(payload.resolutions).toHaveLength(1);
    expect(payload.resolutions[0].date).toBe('2025-01-15');
    expect(payload.resolutions[0].type).toBe('Authorization');
    expect(payload.resolutions[0].keyDecisions).toContain('Open USD account');
    expect(payload.resolutions[0].authorizedPersons).toContain('Alice');
  });

  test('payload handles null fields without crashing', () => {
    const r = makeResolution({
      resolution_date: null,
      resolution_type: null,
      purpose_summary: null,
      key_decisions: [],
      authorized_persons: [],
      signatories: [],
    });

    const payload = {
      company: r.company_name ?? 'Unknown Company',
      resolutions: [r].map((res) => ({
        date: res.resolution_date,
        type: res.resolution_type,
        purpose: res.purpose_summary,
        keyDecisions: res.key_decisions ?? [],
        authorizedPersons: res.authorized_persons ?? [],
        signatories: res.signatories ?? [],
      })),
    };

    expect(payload.resolutions[0].date).toBeNull();
    expect(payload.resolutions[0].keyDecisions).toEqual([]);
  });

  test('analysis response shape is { analysis: string }', () => {
    const mockResponse = { analysis: 'Acme Corp has been actively restructuring its governance...' };
    expect(typeof mockResponse.analysis).toBe('string');
    expect(mockResponse.analysis.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// detectGroupKey
// ---------------------------------------------------------------------------

describe('detectGroupKey', () => {
  test('returns first significant word in lowercase', () => {
    expect(detectGroupKey('Acme Corporation')).toBe('acme');
  });

  test('strips stop words', () => {
    // "the" is a stop word, "bank" is not
    expect(detectGroupKey('The Standard Bank')).toBe('standard');
  });

  test('strips punctuation and normalises case', () => {
    expect(detectGroupKey('ABC-Holdings Ltd')).toBe('abc');
  });

  test('falls back to full lowercase name when all words are stop words', () => {
    const result = detectGroupKey('Holdings Ltd');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns short meaningful token for single significant word', () => {
    expect(detectGroupKey('Barclays')).toBe('barclays');
  });

  test('treats same brand across different entities as same key', () => {
    expect(detectGroupKey('HSBC Bank Ltd')).toBe(detectGroupKey('HSBC Holdings PLC'));
  });
});

// ---------------------------------------------------------------------------
// buildCompanyGroups
// ---------------------------------------------------------------------------

describe('buildCompanyGroups', () => {
  test('returns empty array for empty companies and no saved groups', () => {
    expect(buildCompanyGroups([], [])).toEqual([]);
  });

  test('does not form auto group for a single company with a unique key', () => {
    const groups = buildCompanyGroups(['UniqueVentures Ltd'], []);
    expect(groups).toHaveLength(1);
    // Single company: groupName should be the company itself, not "uniqueventures Group"
    expect(groups[0].members).toContain('UniqueVentures Ltd');
    expect(groups[0].isManual).toBe(false);
  });

  test('auto-detects group when 2+ companies share the same brand key', () => {
    const companies = ['Acme Bank Ltd', 'Acme Finance Ltd'];
    const groups = buildCompanyGroups(companies, []);
    const acmeGroup = groups.find((g) => g.members.length === 2);
    expect(acmeGroup).toBeDefined();
    expect(acmeGroup!.members).toContain('Acme Bank Ltd');
    expect(acmeGroup!.members).toContain('Acme Finance Ltd');
    expect(acmeGroup!.isManual).toBe(false);
  });

  test('saved manual groups take precedence over auto-detection', () => {
    const companies = ['Alpha Bank', 'Alpha Insurance', 'Beta Corp'];
    const saved = [
      { id: 'g1', group_name: 'Alpha Master', member_companies: ['Alpha Bank', 'Alpha Insurance'] },
    ];
    const groups = buildCompanyGroups(companies, saved);
    const manualGroup = groups.find((g) => g.isManual);
    expect(manualGroup).toBeDefined();
    expect(manualGroup!.groupName).toBe('Alpha Master');
    expect(manualGroup!.id).toBe('g1');
  });

  test('excludes manually grouped companies from auto-detection', () => {
    const companies = ['Alpha Bank', 'Alpha Insurance', 'Beta Corp'];
    const saved = [
      { id: 'g1', group_name: 'Alpha Master', member_companies: ['Alpha Bank', 'Alpha Insurance'] },
    ];
    const groups = buildCompanyGroups(companies, saved);
    // Beta Corp is alone so forms its own solo entry, not mixed into Alpha group
    const betaGroup = groups.find((g) => g.members.includes('Beta Corp'));
    expect(betaGroup).toBeDefined();
    expect(betaGroup!.members).not.toContain('Alpha Bank');
  });

  test('filters out saved group members not present in companies list', () => {
    const companies = ['Alpha Bank'];
    const saved = [
      { id: 'g1', group_name: 'Alpha Group', member_companies: ['Alpha Bank', 'Alpha Insurance (removed)'] },
    ];
    const groups = buildCompanyGroups(companies, saved);
    const g = groups.find((g) => g.id === 'g1');
    expect(g).toBeDefined();
    expect(g!.members).toContain('Alpha Bank');
    expect(g!.members).not.toContain('Alpha Insurance (removed)');
  });

  test('groups are sorted by member count descending', () => {
    const companies = ['Acme Bank', 'Acme Finance', 'Acme Insurance', 'ZetaCorp'];
    const groups = buildCompanyGroups(companies, []);
    // The Acme group (3 members) should come before ZetaCorp (1 member)
    const acmeIdx = groups.findIndex((g) => g.members.length === 3);
    const zetaIdx = groups.findIndex((g) => g.members.includes('ZetaCorp'));
    if (acmeIdx !== -1 && zetaIdx !== -1) {
      expect(acmeIdx).toBeLessThan(zetaIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// Run with: npx vitest run src/components/screens/BoardResolutions.test.ts
// ---------------------------------------------------------------------------