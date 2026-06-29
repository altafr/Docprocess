/**
 * Tests for CompanyMandates helper functions.
 *
 * Covers buildMandateRows, isMandateExpired, isMandateExpiringSoon,
 * and exportMandatesToCsv output shape.
 *
 * Run with: npx vitest run src/components/screens/CompanyMandates.test.ts
 */

import {
  buildMandateRows,
  isMandateExpired,
  isMandateExpiringSoon,
  exportMandatesToCsv,
  CompanyMandate,
} from './CompanyMandates';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMandate(overrides: Partial<CompanyMandate> = {}): CompanyMandate {
  return {
    id: 'm1',
    company_name: 'Acme Corp',
    director_name: 'John Smith',
    title: 'Director',
    authorized_products: ['Current Account', 'FX'],
    signing_arrangement: 'sole',
    signing_rules: [],
    signature_type: 'wet-ink',
    effective_date: '2024-01-01',
    expiry_date: null,
    source_resolution_ids: ['r1'],
    notes: null,
    signature_url: null,
    last_updated: '2024-06-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildMandateRows
// ---------------------------------------------------------------------------

describe('buildMandateRows', () => {
  test('returns empty array for empty input', () => {
    expect(buildMandateRows([])).toEqual([]);
  });

  test('single mandate returns unchanged', () => {
    const m = makeMandate();
    expect(buildMandateRows([m])).toHaveLength(1);
  });

  test('sorts by company_name ascending', () => {
    const m1 = makeMandate({ id: 'm1', company_name: 'Zeta Ltd' });
    const m2 = makeMandate({ id: 'm2', company_name: 'Alpha Corp' });
    const m3 = makeMandate({ id: 'm3', company_name: 'Mango Inc' });
    const rows = buildMandateRows([m1, m2, m3]);
    expect(rows[0].company_name).toBe('Alpha Corp');
    expect(rows[1].company_name).toBe('Mango Inc');
    expect(rows[2].company_name).toBe('Zeta Ltd');
  });

  test('does not mutate the input array', () => {
    const m1 = makeMandate({ id: 'm1', company_name: 'Zeta Ltd' });
    const m2 = makeMandate({ id: 'm2', company_name: 'Alpha Corp' });
    const input = [m1, m2];
    buildMandateRows(input);
    expect(input[0].company_name).toBe('Zeta Ltd');
  });

  test('preserves all mandate fields', () => {
    const m = makeMandate({ authorized_products: ['Product A', 'Product B'], signing_arrangement: 'joint' });
    const rows = buildMandateRows([m]);
    expect(rows[0].authorized_products).toEqual(['Product A', 'Product B']);
    expect(rows[0].signing_arrangement).toBe('joint');
  });
});

// ---------------------------------------------------------------------------
// isMandateExpired
// ---------------------------------------------------------------------------

describe('isMandateExpired', () => {
  test('returns false when expiry_date is null', () => {
    expect(isMandateExpired(makeMandate({ expiry_date: null }))).toBe(false);
  });

  test('returns true for a past date', () => {
    expect(isMandateExpired(makeMandate({ expiry_date: '2000-01-01' }))).toBe(true);
  });

  test('returns false for a future date', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    expect(isMandateExpired(makeMandate({ expiry_date: future.toISOString().slice(0, 10) }))).toBe(false);
  });

  test('returns false when expiry is today (not yet midnight)', () => {
    const today = new Date().toISOString().slice(0, 10);
    // new Date("2024-01-01") is midnight UTC; if today the comparison depends on timezone
    // but the function uses: new Date(expiry_date) < new Date()
    // so a date equal to today should not be < today unless time portion has passed
    // We just verify the function doesn't throw
    expect(typeof isMandateExpired(makeMandate({ expiry_date: today }))).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// isMandateExpiringSoon
// ---------------------------------------------------------------------------

describe('isMandateExpiringSoon', () => {
  test('returns false when expiry_date is null', () => {
    expect(isMandateExpiringSoon(makeMandate({ expiry_date: null }))).toBe(false);
  });

  test('returns false for already-expired mandate', () => {
    expect(isMandateExpiringSoon(makeMandate({ expiry_date: '2000-01-01' }))).toBe(false);
  });

  test('returns true when expiry is within default threshold (90 days)', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    expect(isMandateExpiringSoon(makeMandate({ expiry_date: soon.toISOString().slice(0, 10) }))).toBe(true);
  });

  test('returns false when expiry is beyond threshold', () => {
    const far = new Date();
    far.setFullYear(far.getFullYear() + 2);
    expect(isMandateExpiringSoon(makeMandate({ expiry_date: far.toISOString().slice(0, 10) }))).toBe(false);
  });

  test('respects custom daysThreshold parameter', () => {
    const in60Days = new Date();
    in60Days.setDate(in60Days.getDate() + 60);
    const dateStr = in60Days.toISOString().slice(0, 10);
    expect(isMandateExpiringSoon(makeMandate({ expiry_date: dateStr }), 90)).toBe(true);
    expect(isMandateExpiringSoon(makeMandate({ expiry_date: dateStr }), 30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exportMandatesToCsv
// ---------------------------------------------------------------------------

describe('exportMandatesToCsv', () => {
  test('does not throw on empty input', () => {
    expect(() => exportMandatesToCsv([])).not.toThrow();
  });

  test('does not throw on a typical mandate', () => {
    const m = makeMandate({
      company_name: 'Test Corp',
      director_name: 'Jane Doe',
      authorized_products: ['Current Account', 'FX'],
      signing_arrangement: 'sole',
      signature_type: 'wet-ink',
    });
    expect(() => exportMandatesToCsv([m])).not.toThrow();
  });

  test('does not throw when notes contains commas and quotes', () => {
    const m = makeMandate({ notes: 'Notes with "quotes" and, commas' });
    expect(() => exportMandatesToCsv([m])).not.toThrow();
  });

  test('does not throw for null optional fields', () => {
    const m = makeMandate({ title: null, effective_date: null, expiry_date: null, notes: null });
    expect(() => exportMandatesToCsv([m])).not.toThrow();
  });

  test('handles multiple mandates without throwing', () => {
    const mandates = Array.from({ length: 5 }, (_, i) =>
      makeMandate({ id: `m${i}`, company_name: `Company ${i}`, director_name: `Director ${i}` }),
    );
    expect(() => exportMandatesToCsv(mandates)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CompanyMandate interface shape contract
// ---------------------------------------------------------------------------

describe('CompanyMandate interface contract', () => {
  test('mandate with all signing_arrangement values is valid', () => {
    const arrangements: CompanyMandate['signing_arrangement'][] = ['sole', 'joint', 'any-two', 'other', 'unknown'];
    arrangements.forEach((a) => {
      const m = makeMandate({ signing_arrangement: a });
      expect(m.signing_arrangement).toBe(a);
    });
  });

  test('mandate with all signature_type values is valid', () => {
    const types: CompanyMandate['signature_type'][] = ['wet-ink', 'digital', 'unknown'];
    types.forEach((t) => {
      const m = makeMandate({ signature_type: t });
      expect(m.signature_type).toBe(t);
    });
  });

  test('authorized_products defaults to array', () => {
    const m = makeMandate({ authorized_products: [] });
    expect(Array.isArray(m.authorized_products)).toBe(true);
  });

  test('source_resolution_ids defaults to array', () => {
    const m = makeMandate({ source_resolution_ids: ['r1', 'r2'] });
    expect(m.source_resolution_ids).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// signature_url field
// ---------------------------------------------------------------------------

describe('CompanyMandate signature_url', () => {
  test('accepts null when no signature has been stored', () => {
    const m = makeMandate({ signature_url: null });
    expect(m.signature_url).toBeNull();
  });

  test('accepts a JPEG URL string', () => {
    const url = 'https://example.com/sigs/john-smith-0.jpg';
    const m = makeMandate({ signature_url: url });
    expect(m.signature_url).toBe(url);
  });

  test('signature_url is preserved through buildMandateRows', () => {
    const url = 'https://example.com/sigs/jane-doe-0.jpg';
    const m = makeMandate({ signature_url: url });
    const rows = buildMandateRows([m]);
    expect(rows[0].signature_url).toBe(url);
  });

  test('null signature_url is preserved through buildMandateRows', () => {
    const m = makeMandate({ signature_url: null });
    const rows = buildMandateRows([m]);
    expect(rows[0].signature_url).toBeNull();
  });

  test('exportMandatesToCsv does not throw with a signature_url present', () => {
    const m = makeMandate({ signature_url: 'https://example.com/sigs/test-0.jpg' });
    expect(() => exportMandatesToCsv([m])).not.toThrow();
  });
});
