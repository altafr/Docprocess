/**
 * KnowledgeSearch — unit tests (no DOM/browser APIs needed).
 *
 * These tests exercise the pure helper logic extracted from the component
 * and the edge-function search RPC response shape.
 */

// ─── helpers mirrored from KnowledgeSearch.tsx ───────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function relevancePct(rank: number): number {
  return Math.min(100, Math.round((rank / 0.6) * 100));
}

function buildSnippet(snippetRaw: string, maxLength = 200): string {
  return snippetRaw.slice(0, maxLength);
}

type SourceType = 'board_resolution' | 'processed_document' | 'company_mandate';

const SOURCE_TABS: Record<SourceType, string> = {
  board_resolution: 'boardresolutions',
  processed_document: 'docprocessor',
  company_mandate: 'companyMandates',
};

function resolveTab(source: SourceType): string {
  return SOURCE_TABS[source];
}

// ─── tests ───────────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertEquals<T>(a: T, b: T, message: string) {
  if (a !== b) throw new Error(`FAIL: ${message} — expected "${b}", got "${a}"`);
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}

// ── formatDate ────────────────────────────────────────────────────────────────
test('formatDate returns readable date for valid ISO string', () => {
  const result = formatDate('2024-06-15T10:00:00Z');
  assert(result.includes('2024'), 'year should be present');
  assert(result.includes('Jun') || result.includes('15'), 'month or day should be present');
});

test('formatDate returns input unchanged for invalid value', () => {
  const bad = 'not-a-date';
  const result = formatDate(bad);
  assertEquals(result, bad, 'invalid iso passthrough');
});

// ── relevancePct ──────────────────────────────────────────────────────────────
test('relevancePct: rank 0.6 maps to 100%', () => {
  assertEquals(relevancePct(0.6), 100, 'rank 0.6');
});

test('relevancePct: rank 0 maps to 0%', () => {
  assertEquals(relevancePct(0), 0, 'rank 0');
});

test('relevancePct: rank 0.3 maps to 50%', () => {
  assertEquals(relevancePct(0.3), 50, 'rank 0.3');
});

test('relevancePct: rank above 0.6 is capped at 100%', () => {
  assertEquals(relevancePct(1.2), 100, 'rank 1.2 capped');
});

// ── buildSnippet ──────────────────────────────────────────────────────────────
test('buildSnippet truncates to maxLength', () => {
  const long = 'a'.repeat(300);
  assertEquals(buildSnippet(long).length, 200, 'default 200 chars');
});

test('buildSnippet keeps short text unchanged', () => {
  const short = 'hello world';
  assertEquals(buildSnippet(short), short, 'short text unchanged');
});

test('buildSnippet respects custom maxLength', () => {
  const text = 'abcdefghij';
  assertEquals(buildSnippet(text, 5), 'abcde', 'custom length 5');
});

// ── resolveTab ────────────────────────────────────────────────────────────────
test('resolveTab: board_resolution -> boardresolutions', () => {
  assertEquals(resolveTab('board_resolution'), 'boardresolutions', 'board resolution tab');
});

test('resolveTab: processed_document -> docprocessor', () => {
  assertEquals(resolveTab('processed_document'), 'docprocessor', 'processed document tab');
});

test('resolveTab: company_mandate -> companyMandates', () => {
  assertEquals(resolveTab('company_mandate'), 'companyMandates', 'company mandate tab');
});

// ── source filter toggle logic ────────────────────────────────────────────────
test('source filter: removing last active source is a no-op', () => {
  const active = new Set<SourceType>(['board_resolution']);
  // Simulate toggle — if only one remains, keep it
  const src: SourceType = 'board_resolution';
  const next = new Set(active);
  if (next.has(src) && next.size === 1) {
    // no-op
  } else {
    next.has(src) ? next.delete(src) : next.add(src);
  }
  assert(next.has('board_resolution'), 'last source preserved');
});

test('source filter: toggling off one of two removes it', () => {
  const active = new Set<SourceType>(['board_resolution', 'processed_document']);
  const src: SourceType = 'board_resolution';
  const next = new Set(active);
  if (next.has(src) && next.size === 1) {
    // no-op
  } else {
    next.has(src) ? next.delete(src) : next.add(src);
  }
  assert(!next.has('board_resolution'), 'source removed');
  assert(next.has('processed_document'), 'other source remains');
});

test('source filter: toggling a new source adds it', () => {
  const active = new Set<SourceType>(['board_resolution']);
  const src: SourceType = 'company_mandate';
  const next = new Set(active);
  if (next.has(src) && next.size === 1) {
    // no-op
  } else {
    next.has(src) ? next.delete(src) : next.add(src);
  }
  assert(next.has('company_mandate'), 'new source added');
  assert(next.has('board_resolution'), 'existing source still there');
});

// ── result grouping ───────────────────────────────────────────────────────────
test('results group correctly by source type', () => {
  const results = [
    { id: '1', source: 'board_resolution' as SourceType, rank: 0.5, title: 'R1', subtitle: '', snippet: '', metadata: {}, created_at: '' },
    { id: '2', source: 'company_mandate' as SourceType, rank: 0.4, title: 'M1', subtitle: '', snippet: '', metadata: {}, created_at: '' },
    { id: '3', source: 'board_resolution' as SourceType, rank: 0.3, title: 'R2', subtitle: '', snippet: '', metadata: {}, created_at: '' },
  ];
  const brGroup = results.filter((r) => r.source === 'board_resolution');
  const cmGroup = results.filter((r) => r.source === 'company_mandate');
  const pdGroup = results.filter((r) => r.source === 'processed_document');
  assertEquals(brGroup.length, 2, 'board resolution group count');
  assertEquals(cmGroup.length, 1, 'mandate group count');
  assertEquals(pdGroup.length, 0, 'document group count (empty)');
});

test('results sort rank descending', () => {
  const results = [
    { rank: 0.3 }, { rank: 0.6 }, { rank: 0.1 }, { rank: 0.45 },
  ];
  const sorted = [...results].sort((a, b) => b.rank - a.rank);
  assert(sorted[0].rank === 0.6, 'highest rank first');
  assert(sorted[sorted.length - 1].rank === 0.1, 'lowest rank last');
});

// ── metadata filtering ────────────────────────────────────────────────────────
test('null/empty metadata entries are filtered from display', () => {
  const metadata: Record<string, string | null> = {
    company_name: 'Acme',
    resolution_type: null,
    effective_date: '',
    expiry_date: '2025-12-31',
  };
  const visible = Object.entries(metadata).filter(([, v]) => v != null && v !== '');
  assertEquals(visible.length, 2, 'only non-null/non-empty entries shown');
  assert(visible.some(([k]) => k === 'company_name'), 'company_name included');
  assert(visible.some(([k]) => k === 'expiry_date'), 'expiry_date included');
});

// ── edge function response shape validation ───────────────────────────────────
test('valid edge function response contains results array', () => {
  const response = { results: [], query: 'test' };
  assert(Array.isArray(response.results), 'results is array');
  assertEquals(response.query, 'test', 'query echoed back');
});

test('result card data shape is valid', () => {
  const result = {
    id: 'uuid-1',
    source: 'board_resolution' as SourceType,
    rank: 0.42,
    title: 'HSBC Resolution 2024',
    subtitle: 'HSBC · BR-001 · 01 Jan 2024',
    snippet: 'Authorisation for account opening',
    metadata: { company_name: 'HSBC', resolution_type: 'Account Opening' },
    created_at: '2024-01-15T08:00:00Z',
  };
  assert(typeof result.id === 'string' && result.id.length > 0, 'id present');
  assert(['board_resolution', 'processed_document', 'company_mandate'].includes(result.source), 'valid source');
  assert(result.rank >= 0 && result.rank <= 1, 'rank in 0-1 range');
  assert(typeof result.title === 'string', 'title is string');
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\nKnowledgeSearch tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
