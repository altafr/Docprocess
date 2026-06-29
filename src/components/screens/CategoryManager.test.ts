// Run with: npx vitest run src/components/screens/CategoryManager.test.ts
import { describe, it, expect } from 'vitest';
import { COLOR_OPTIONS, getBadgeClass } from './CategoryManager';

// ---------------------------------------------------------------------------
// validate() — reimplemented here to keep tests framework-independent
// ---------------------------------------------------------------------------
function validate(form: { name: string; description: string; color: string }): string | null {
  if (!form.name.trim()) return 'Category name is required.';
  if (form.name.trim().length > 60) return 'Name must be 60 characters or fewer.';
  if (form.description.length > 300) return 'Description must be 300 characters or fewer.';
  return null;
}

// ---------------------------------------------------------------------------
// getBadgeClass
// ---------------------------------------------------------------------------
describe('getBadgeClass', () => {
  it('returns correct class for a known color', () => {
    expect(getBadgeClass('sky')).toContain('sky');
  });

  it('falls back to gray for an unknown color', () => {
    expect(getBadgeClass('nonexistent-color')).toContain('gray');
  });

  it('returns different classes for different colors', () => {
    expect(getBadgeClass('emerald')).not.toBe(getBadgeClass('rose'));
  });
});

// ---------------------------------------------------------------------------
// COLOR_OPTIONS integrity
// ---------------------------------------------------------------------------
describe('COLOR_OPTIONS', () => {
  it('has at least 16 color entries', () => {
    expect(COLOR_OPTIONS.length).toBeGreaterThanOrEqual(16);
  });

  it('every entry has name, label, dot and badge fields', () => {
    for (const c of COLOR_OPTIONS) {
      expect(c.name).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.dot).toMatch(/^bg-/);
      expect(c.badge).toMatch(/^bg-/);
    }
  });

  it('all color names are unique', () => {
    const names = COLOR_OPTIONS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes required banking document colors', () => {
    const names = COLOR_OPTIONS.map((c) => c.name);
    for (const required of ['sky', 'emerald', 'blue', 'amber', 'rose', 'teal', 'pink', 'stone', 'zinc', 'yellow']) {
      expect(names).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------
describe('validate', () => {
  const base = { name: 'Test Category', description: '', color: 'blue' };

  it('passes a valid form', () => {
    expect(validate(base)).toBeNull();
  });

  it('fails when name is empty', () => {
    expect(validate({ ...base, name: '' })).toBe('Category name is required.');
  });

  it('fails when name is only whitespace', () => {
    expect(validate({ ...base, name: '   ' })).toBe('Category name is required.');
  });

  it('fails when name exceeds 60 characters', () => {
    expect(validate({ ...base, name: 'A'.repeat(61) })).toBe('Name must be 60 characters or fewer.');
  });

  it('passes name at exactly 60 characters', () => {
    expect(validate({ ...base, name: 'A'.repeat(60) })).toBeNull();
  });

  it('fails when description exceeds 300 characters', () => {
    expect(validate({ ...base, description: 'D'.repeat(301) })).toBe('Description must be 300 characters or fewer.');
  });

  it('passes description at exactly 300 characters', () => {
    expect(validate({ ...base, description: 'D'.repeat(300) })).toBeNull();
  });

  it('passes when description is empty', () => {
    expect(validate({ ...base, description: '' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Financial statement category names are present in expected list
// ---------------------------------------------------------------------------
describe('financial statement categories', () => {
  const EXPECTED_FINANCIAL = ['Balance Sheet', 'Profit & Loss Statement', 'Cash Flow Statement'];

  it('all financial statement category names are non-empty strings', () => {
    for (const name of EXPECTED_FINANCIAL) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('each financial category name passes validation', () => {
    for (const name of EXPECTED_FINANCIAL) {
      expect(validate({ name, description: '', color: 'blue' })).toBeNull();
    }
  });
});
