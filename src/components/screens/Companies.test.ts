/**
 * Tests for Companies screen helper functions.
 *
 * Covers buildCompanyRows, filterCompanies, looksLikeDocumentName,
 * and groupSignatoriesByCompany.
 *
 * Run with: npx vitest run src/components/screens/Companies.test.ts
 */

import {
  buildCompanyRows,
  filterCompanies,
  looksLikeDocumentName,
  groupSignatoriesByCompany,
  Company,
  CompanySignatory,
} from './Companies';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c1',
    company_code: 'CMP-001',
    company_name: 'Acme Corp',
    legal_entity_type: null,
    cin_number: null,
    legal_entity_identifier: null,
    other_identifier: null,
    country_of_incorporation: null,
    top50: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSignatoryRow(overrides: Partial<CompanySignatory> = {}): CompanySignatory {
  return {
    company_id: 'c1',
    company_code: 'CMP-001',
    company_name: 'Acme Corp',
    signatory_id: 's1',
    signatory_display_id: 'SIG-001',
    director_name_key: 'John Smith',
    first_name: 'John',
    last_name: 'Smith',
    mandate_title: 'Director',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCompanyRows
// ---------------------------------------------------------------------------

describe('buildCompanyRows', () => {
  test('returns empty array for empty input', () => {
    expect(buildCompanyRows([])).toEqual([]);
  });

  test('single company returns unchanged', () => {
    const c = makeCompany();
    expect(buildCompanyRows([c])).toHaveLength(1);
  });

  test('sorts by company_code ascending', () => {
    const c1 = makeCompany({ id: 'c1', company_code: 'CMP-003' });
    const c2 = makeCompany({ id: 'c2', company_code: 'CMP-001' });
    const c3 = makeCompany({ id: 'c3', company_code: 'CMP-002' });
    const rows = buildCompanyRows([c1, c2, c3]);
    expect(rows[0].company_code).toBe('CMP-001');
    expect(rows[1].company_code).toBe('CMP-002');
    expect(rows[2].company_code).toBe('CMP-003');
  });

  test('does not mutate the input array', () => {
    const c1 = makeCompany({ id: 'c1', company_code: 'CMP-003' });
    const c2 = makeCompany({ id: 'c2', company_code: 'CMP-001' });
    const input = [c1, c2];
    buildCompanyRows(input);
    expect(input[0].company_code).toBe('CMP-003');
  });

  test('preserves all company fields', () => {
    const c = makeCompany({ legal_entity_type: 'Ltd', cin_number: 'U12345' });
    const rows = buildCompanyRows([c]);
    expect(rows[0].legal_entity_type).toBe('Ltd');
    expect(rows[0].cin_number).toBe('U12345');
  });
});

// ---------------------------------------------------------------------------
// filterCompanies
// ---------------------------------------------------------------------------

describe('filterCompanies', () => {
  test('returns all companies when query is empty', () => {
    const companies = [makeCompany(), makeCompany({ id: 'c2', company_name: 'Beta Ltd' })];
    expect(filterCompanies(companies, '')).toHaveLength(2);
  });

  test('filters by company name (case-insensitive)', () => {
    const companies = [
      makeCompany({ id: 'c1', company_name: 'Alpha Corp' }),
      makeCompany({ id: 'c2', company_name: 'Beta Ltd' }),
      makeCompany({ id: 'c3', company_name: 'Gamma Inc' }),
    ];
    const result = filterCompanies(companies, 'alpha');
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe('Alpha Corp');
  });

  test('filters by company code', () => {
    const companies = [
      makeCompany({ id: 'c1', company_code: 'CMP-001' }),
      makeCompany({ id: 'c2', company_code: 'CMP-002' }),
    ];
    const result = filterCompanies(companies, 'cmp-002');
    expect(result).toHaveLength(1);
    expect(result[0].company_code).toBe('CMP-002');
  });

  test('filters by CIN number', () => {
    const companies = [
      makeCompany({ id: 'c1', cin_number: 'U12345MH' }),
      makeCompany({ id: 'c2', cin_number: 'U67890DL' }),
    ];
    const result = filterCompanies(companies, 'u67890');
    expect(result).toHaveLength(1);
    expect(result[0].cin_number).toBe('U67890DL');
  });

  test('returns empty when no match', () => {
    const companies = [makeCompany({ company_name: 'Alpha Corp' })];
    expect(filterCompanies(companies, 'zzz')).toHaveLength(0);
  });

  test('handles whitespace-only query as empty', () => {
    const companies = [makeCompany(), makeCompany({ id: 'c2' })];
    expect(filterCompanies(companies, '   ')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// looksLikeDocumentName
// ---------------------------------------------------------------------------

describe('looksLikeDocumentName', () => {
  test('returns true for name containing "template"', () => {
    expect(looksLikeDocumentName('Anna OTR Co Ltd - Global_Authority_template')).toBe(true);
  });

  test('returns true for name containing "explanatory_notes"', () => {
    expect(looksLikeDocumentName('Some Company - explanatory_notes')).toBe(true);
  });

  test('returns true for name containing both', () => {
    expect(looksLikeDocumentName('Company - template_and_explanatory_notes')).toBe(true);
  });

  test('returns false for a normal company name', () => {
    expect(looksLikeDocumentName('Brookfield Industries Limited')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(looksLikeDocumentName('')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(looksLikeDocumentName('Company - TEMPLATE')).toBe(true);
    expect(looksLikeDocumentName('Company - Explanatory_Notes')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// groupSignatoriesByCompany
// ---------------------------------------------------------------------------

describe('groupSignatoriesByCompany', () => {
  test('returns empty map for empty input', () => {
    const map = groupSignatoriesByCompany([]);
    expect(map.size).toBe(0);
  });

  test('groups signatories by company_id', () => {
    const rows = [
      makeSignatoryRow({ company_id: 'c1', signatory_id: 's1' }),
      makeSignatoryRow({ company_id: 'c1', signatory_id: 's2' }),
      makeSignatoryRow({ company_id: 'c2', signatory_id: 's3' }),
    ];
    const map = groupSignatoriesByCompany(rows);
    expect(map.size).toBe(2);
    expect(map.get('c1')).toHaveLength(2);
    expect(map.get('c2')).toHaveLength(1);
  });

  test('handles single signatory per company', () => {
    const rows = [makeSignatoryRow({ company_id: 'c1', signatory_id: 's1' })];
    const map = groupSignatoriesByCompany(rows);
    expect(map.size).toBe(1);
    expect(map.get('c1')).toHaveLength(1);
  });

  test('preserves signatory fields', () => {
    const rows = [
      makeSignatoryRow({
        company_id: 'c1',
        signatory_display_id: 'SIG-042',
        first_name: 'Jane',
        last_name: 'Doe',
        mandate_title: 'CFO',
      }),
    ];
    const map = groupSignatoriesByCompany(rows);
    const sig = map.get('c1')![0];
    expect(sig.signatory_display_id).toBe('SIG-042');
    expect(sig.first_name).toBe('Jane');
    expect(sig.last_name).toBe('Doe');
    expect(sig.mandate_title).toBe('CFO');
  });

  test('returns map with get() returning undefined for unknown company', () => {
    const map = groupSignatoriesByCompany([makeSignatoryRow({ company_id: 'c1' })]);
    expect(map.get('unknown')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Company interface contract
// ---------------------------------------------------------------------------

describe('Company interface contract', () => {
  test('company with all identifier fields populated is valid', () => {
    const c = makeCompany({
      legal_entity_type: 'Private Limited',
      cin_number: 'U12345MH2019PTC123456',
      legal_entity_identifier: '529900T8BM49AURSDO55',
      other_identifier: 'TAX-12345',
      country_of_incorporation: 'India',
    });
    expect(c.legal_entity_type).toBe('Private Limited');
    expect(c.cin_number).toBe('U12345MH2019PTC123456');
    expect(c.legal_entity_identifier).toBe('529900T8BM49AURSDO55');
    expect(c.other_identifier).toBe('TAX-12345');
    expect(c.country_of_incorporation).toBe('India');
  });

  test('company with all identifier fields null is valid', () => {
    const c = makeCompany({
      legal_entity_type: null,
      cin_number: null,
      legal_entity_identifier: null,
      other_identifier: null,
      country_of_incorporation: null,
    });
    expect(c.legal_entity_type).toBeNull();
    expect(c.cin_number).toBeNull();
    expect(c.legal_entity_identifier).toBeNull();
    expect(c.other_identifier).toBeNull();
    expect(c.country_of_incorporation).toBeNull();
  });

  test('company_code can be null', () => {
    const c = makeCompany({ company_code: null });
    expect(c.company_code).toBeNull();
  });
});
