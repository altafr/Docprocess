import { useState } from 'react';
import { Database, Key, Link, Hash, ChevronDown, ChevronRight, Tag, Layers } from 'lucide-react';

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

type ColKind = 'pk' | 'fk' | 'uk' | 'col';

interface Column {
  name: string;
  type: string;
  kind?: ColKind;
  nullable?: boolean;
  note?: string;
}

interface TableDef {
  id: string;
  name: string;
  color: string;
  group: string;
  columns: Column[];
}

interface RelationDef {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
  label?: string;
}

const TABLES: TableDef[] = [
  {
    id: 'api_settings',
    name: 'api_settings',
    color: '#6366f1',
    group: 'Config',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'key', type: 'text', kind: 'uk', note: 'Setting key name' },
      { name: 'value', type: 'text', note: 'Encrypted value' },
      { name: 'description', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamptz' },
      { name: 'updated_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'document_categories',
    name: 'document_categories',
    color: '#8b5cf6',
    group: 'Config',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'user_id', type: 'uuid', kind: 'fk', nullable: true, note: '→ auth.users (null = system default)' },
      { name: 'name', type: 'text' },
      { name: 'description', type: 'text' },
      { name: 'color', type: 'text', note: 'Tailwind color token' },
      { name: 'is_default', type: 'boolean' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'document_processing_jobs',
    name: 'document_processing_jobs',
    color: '#0891b2',
    group: 'Processing',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'status', type: 'text', note: 'pending | processing | completed | partial | failed' },
      { name: 'file_count', type: 'integer' },
      { name: 'error_count', type: 'integer' },
      { name: 'started_at', type: 'timestamptz', nullable: true },
      { name: 'completed_at', type: 'timestamptz', nullable: true },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'processed_documents',
    name: 'processed_documents',
    color: '#0891b2',
    group: 'Processing',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'file_name', type: 'text' },
      { name: 'file_hash', type: 'text', kind: 'uk', note: 'SHA-256' },
      { name: 'file_size', type: 'integer' },
      { name: 'category', type: 'text', nullable: true },
      { name: 'summary', type: 'text', nullable: true },
      { name: 'board_resolution_id', type: 'uuid', kind: 'fk', nullable: true, note: '→ board_resolutions' },
      { name: 'job_id', type: 'text', nullable: true },
      { name: 'search_vector', type: 'tsvector', nullable: true },
      { name: 'embedding', type: 'vector(1024)', nullable: true },
      { name: 'processed_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'llm_usage_logs',
    name: 'llm_usage_logs',
    color: '#059669',
    group: 'Observability',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'function_name', type: 'text' },
      { name: 'model', type: 'text', nullable: true },
      { name: 'prompt_tokens', type: 'integer', nullable: true },
      { name: 'completion_tokens', type: 'integer', nullable: true },
      { name: 'total_tokens', type: 'integer', nullable: true },
      { name: 'prompt_preview', type: 'text', nullable: true },
      { name: 'response_preview', type: 'text', nullable: true },
      { name: 'duration_ms', type: 'integer', nullable: true },
      { name: 'status', type: 'text', note: 'success | error' },
      { name: 'error_message', type: 'text', nullable: true },
      { name: 'cost_usd', type: 'numeric(12,8)', nullable: true },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'board_resolutions',
    name: 'board_resolutions',
    color: '#d97706',
    group: 'Knowledge',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'document_name', type: 'text' },
      { name: 'company_name', type: 'text', nullable: true },
      { name: 'resolution_number', type: 'text', nullable: true },
      { name: 'resolution_date', type: 'text', nullable: true },
      { name: 'resolution_type', type: 'text', nullable: true },
      { name: 'purpose_summary', type: 'text', nullable: true },
      { name: 'key_decisions', type: 'jsonb' },
      { name: 'signatories', type: 'jsonb' },
      { name: 'authorized_persons', type: 'jsonb' },
      { name: 'effective_date', type: 'text', nullable: true },
      { name: 'expiry_date', type: 'text', nullable: true },
      { name: 'full_text', type: 'text', nullable: true },
      { name: 'confidence', type: 'numeric(4,3)', nullable: true },
      { name: 'visual_elements', type: 'jsonb', nullable: true },
      { name: 'search_vector', type: 'tsvector', nullable: true },
      { name: 'embedding', type: 'vector(1024)', nullable: true },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'document_signatures',
    name: 'document_signatures',
    color: '#d97706',
    group: 'Knowledge',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'board_resolution_id', type: 'uuid', kind: 'fk', note: '→ board_resolutions (CASCADE)' },
      { name: 'person_name', type: 'text', nullable: true },
      { name: 'company_name', type: 'text', nullable: true },
      { name: 'element_type', type: 'text', note: 'signature | seal | stamp' },
      { name: 'signature_type', type: 'text', note: 'wet-ink | digital | unknown' },
      { name: 'storage_path', type: 'text' },
      { name: 'storage_url', type: 'text', nullable: true },
      { name: 'page_number', type: 'integer' },
      { name: 'bounding_box', type: 'jsonb', nullable: true },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'company_groups',
    name: 'company_groups',
    color: '#DB0011',
    group: 'Mandates',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'group_name', type: 'text' },
      { name: 'member_companies', type: 'jsonb', note: 'Array of company names' },
      { name: 'notes', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamptz' },
      { name: 'updated_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'company_mandates',
    name: 'company_mandates',
    color: '#DB0011',
    group: 'Mandates',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'company_name', type: 'text' },
      { name: 'director_name', type: 'text' },
      { name: 'title', type: 'text', nullable: true },
      { name: 'authorized_products', type: 'jsonb' },
      { name: 'signing_arrangement', type: 'text', note: 'sole | joint | any-two | other | unknown' },
      { name: 'signing_rules', type: 'jsonb' },
      { name: 'signature_type', type: 'text', note: 'wet-ink | digital | unknown' },
      { name: 'effective_date', type: 'text', nullable: true },
      { name: 'expiry_date', type: 'text', nullable: true },
      { name: 'source_resolution_ids', type: 'jsonb', note: '[] board_resolution ids' },
      { name: 'notes', type: 'text', nullable: true },
      { name: 'signature_url', type: 'text', nullable: true },
      { name: 'search_vector', type: 'tsvector', nullable: true },
      { name: 'embedding', type: 'vector(1024)', nullable: true },
      { name: 'last_updated', type: 'timestamptz' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    id: 'authorized_signatories',
    name: 'authorized_signatories',
    color: '#DB0011',
    group: 'Mandates',
    columns: [
      { name: 'id', type: 'uuid', kind: 'pk' },
      { name: 'director_name_key', type: 'text', kind: 'uk', note: 'Canonical name from company_mandates' },
      { name: 'first_name', type: 'text', nullable: true },
      { name: 'last_name', type: 'text', nullable: true },
      { name: 'id_type', type: 'text', nullable: true, note: 'Passport | HKID | etc.' },
      { name: 'id_number', type: 'text', nullable: true },
      { name: 'id_expiry_date', type: 'text', nullable: true },
      { name: 'nationality', type: 'text', nullable: true },
      { name: 'signature_url', type: 'text', nullable: true },
      { name: 'email_address', type: 'text', nullable: true },
      { name: 'residential_address', type: 'text', nullable: true },
      { name: 'date_of_birth', type: 'text', nullable: true },
      { name: 'related_companies', type: 'text[]', note: '[] company names' },
      { name: 'source_resolution_ids', type: 'text[]', note: '[] board_resolution UUIDs' },
      { name: 'created_at', type: 'timestamptz' },
      { name: 'last_updated', type: 'timestamptz' },
    ],
  },
];

const RELATIONS: RelationDef[] = [
  { from: 'processed_documents', fromCol: 'board_resolution_id', to: 'board_resolutions', toCol: 'id', label: 'SET NULL' },
  { from: 'document_signatures', fromCol: 'board_resolution_id', to: 'board_resolutions', toCol: 'id', label: 'CASCADE' },
];

const GROUPS: Record<string, { color: string; desc: string }> = {
  Config:        { color: '#6366f1', desc: 'Settings & document categories' },
  Processing:    { color: '#0891b2', desc: 'Job tracking & processed files' },
  Knowledge:     { color: '#d97706', desc: 'Board resolutions & signatures' },
  Mandates:      { color: '#DB0011', desc: 'Company mandates & signatories' },
  Observability: { color: '#059669', desc: 'LLM usage & cost tracking' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KindBadge({ kind }: { kind?: ColKind }) {
  if (!kind) return null;
  const styles: Record<ColKind, string> = {
    pk: 'bg-amber-100 text-amber-700 border-amber-200',
    fk: 'bg-blue-100 text-blue-700 border-blue-200',
    uk: 'bg-purple-100 text-purple-700 border-purple-200',
    col: '',
  };
  const labels: Record<ColKind, string> = { pk: 'PK', fk: 'FK', uk: 'UK', col: '' };
  if (kind === 'col') return null;
  return (
    <span className={`inline-flex items-center text-[9px] font-bold px-1 py-0.5 rounded border shrink-0 ${styles[kind]}`}>
      {labels[kind]}
    </span>
  );
}

function TableCard({ table, expanded, onToggle }: { table: TableDef; expanded: boolean; onToggle: () => void }) {
  const pkCols = table.columns.filter((c) => c.kind === 'pk');
  const fkCols = table.columns.filter((c) => c.kind === 'fk');
  const otherCols = table.columns.filter((c) => !c.kind || c.kind === 'col' || c.kind === 'uk');

  return (
    <div className="rounded-xl border-2 overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow" style={{ borderColor: table.color }}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left"
        style={{ backgroundColor: table.color }}
      >
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-white/80 shrink-0" />
          <span className="text-[12px] font-bold text-white tracking-tight">{table.name}</span>
          <span className="text-[10px] text-white/60 font-normal">{table.columns.length} cols</span>
        </div>
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-white/70" />
          : <ChevronRight className="h-3.5 w-3.5 text-white/70" />
        }
      </button>

      {/* Columns */}
      {expanded && (
        <div className="divide-y divide-gray-100">
          {/* PKs first */}
          {pkCols.map((c) => (
            <ColumnRow key={c.name} col={c} />
          ))}
          {/* FKs second */}
          {fkCols.length > 0 && (
            <>
              <div className="px-3.5 py-1 bg-blue-50">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-blue-500">Foreign Keys</span>
              </div>
              {fkCols.map((c) => (
                <ColumnRow key={c.name} col={c} />
              ))}
            </>
          )}
          {/* Other columns */}
          {otherCols.length > 0 && (
            <>
              <div className="px-3.5 py-1 bg-gray-50">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Columns</span>
              </div>
              {otherCols.map((c) => (
                <ColumnRow key={c.name} col={c} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Collapsed summary */}
      {!expanded && (
        <div className="px-3.5 py-2 flex flex-wrap gap-1">
          {pkCols.map((c) => (
            <span key={c.name} className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">{c.name}</span>
          ))}
          {fkCols.map((c) => (
            <span key={c.name} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{c.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnRow({ col }: { col: Column }) {
  return (
    <div className="flex items-start gap-2 px-3.5 py-1.5 hover:bg-gray-50 transition-colors">
      <KindBadge kind={col.kind} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-[11px] font-medium ${col.nullable ? 'text-gray-500' : 'text-gray-800'}`}>
            {col.name}
            {col.nullable && <span className="text-[9px] text-gray-400 ml-0.5">?</span>}
          </span>
          <span className="text-[10px] font-mono text-indigo-500 shrink-0">{col.type}</span>
        </div>
        {col.note && (
          <p className="text-[9px] text-gray-400 mt-0.5 leading-snug">{col.note}</p>
        )}
      </div>
    </div>
  );
}

function RelationItem({ rel }: { rel: RelationDef }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-colors">
      <Link className="h-3.5 w-3.5 text-blue-400 shrink-0" />
      <div className="text-[11px] min-w-0">
        <span className="font-semibold text-gray-800">{rel.from}</span>
        <span className="text-gray-400">.</span>
        <span className="text-blue-600">{rel.fromCol}</span>
        <span className="text-gray-400 mx-1.5">→</span>
        <span className="font-semibold text-gray-800">{rel.to}</span>
        <span className="text-gray-400">.</span>
        <span className="text-blue-600">{rel.toCol}</span>
        {rel.label && (
          <span className="ml-2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{rel.label}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function DbDiagram() {
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set(TABLES.map((t) => t.id)));
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const collapseAll = () => setExpandedTables(new Set());
  const expandAll = () => setExpandedTables(new Set(TABLES.map((t) => t.id)));

  const visibleTables = activeGroup
    ? TABLES.filter((t) => t.group === activeGroup)
    : TABLES;

  const tablesByGroup = Object.keys(GROUPS).reduce<Record<string, TableDef[]>>((acc, g) => {
    acc[g] = visibleTables.filter((t) => t.group === g);
    return acc;
  }, {});

  return (
    <div className="font-['Inter',sans-serif] space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Database Schema</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            {TABLES.length} tables &middot; {TABLES.reduce((n, t) => n + t.columns.length, 0)} columns &middot; {RELATIONS.length} foreign key relations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Group filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveGroup(null)}
          className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
            activeGroup === null
              ? 'bg-gray-800 text-white border-gray-800'
              : 'text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          All Groups
        </button>
        {Object.entries(GROUPS).map(([g, meta]) => (
          <button
            key={g}
            onClick={() => setActiveGroup(activeGroup === g ? null : g)}
            className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
              activeGroup === g
                ? 'text-white border-transparent'
                : 'text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
            style={activeGroup === g ? { backgroundColor: meta.color, borderColor: meta.color } : {}}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
            {g}
            <span className="text-[10px] opacity-70">
              {TABLES.filter((t) => t.group === g).length}
            </span>
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[11px]">
        <span className="flex items-center gap-1.5 text-gray-500 font-medium">Legend:</span>
        {[
          { label: 'PK — Primary Key', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
          { label: 'FK — Foreign Key', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
          { label: 'UK — Unique Key', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
        ].map((l) => (
          <span key={l.label} className={`px-2 py-0.5 rounded border font-medium ${l.cls}`}>{l.label}</span>
        ))}
        <span className="text-gray-400 flex items-center gap-1">
          <Hash className="h-3 w-3" />
          <span className="text-gray-500">? = nullable</span>
        </span>
        <span className="text-gray-400 flex items-center gap-1">
          <Tag className="h-3 w-3" />
          <span className="font-mono text-indigo-500 text-[10px]">type</span>
          <span className="text-gray-500">= column type</span>
        </span>
      </div>

      {/* Tables grid by group */}
      <div className="space-y-6">
        {Object.entries(tablesByGroup).map(([group, tables]) => {
          if (tables.length === 0) return null;
          const meta = GROUPS[group];
          return (
            <div key={group}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: meta.color }} />
                <h3 className="text-[12px] font-bold text-gray-700 uppercase tracking-wider">{group}</h3>
                <span className="text-[11px] text-gray-400">{meta.desc}</span>
                <span className="text-[10px] text-gray-400 ml-1">({tables.length} table{tables.length !== 1 ? 's' : ''})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {tables.map((t) => (
                  <TableCard
                    key={t.id}
                    table={t}
                    expanded={expandedTables.has(t.id)}
                    onToggle={() => toggle(t.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Relations */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Link className="h-4 w-4 text-blue-500" />
          <h3 className="text-[12px] font-bold text-gray-700 uppercase tracking-wider">Foreign Key Relations</h3>
          <span className="text-[10px] text-gray-400">({RELATIONS.length} explicit FK{RELATIONS.length !== 1 ? 's' : ''})</span>
        </div>
        <div className="space-y-2">
          {RELATIONS.map((r, i) => (
            <RelationItem key={i} rel={r} />
          ))}
        </div>
        <div className="mt-3 px-3 py-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50">
          <p className="text-[11px] text-gray-500">
            <span className="font-semibold text-gray-700">Soft relations (via JSONB / text arrays):</span>
            {' '}company_mandates.source_resolution_ids and authorized_signatories.source_resolution_ids
            reference board_resolutions.id &middot; company_mandates UNIQUE(company_name, director_name)
            links logically to authorized_signatories.director_name_key
          </p>
        </div>
      </div>

      {/* RPCs */}
      <div>
        <h3 className="text-[12px] font-bold text-gray-700 uppercase tracking-wider mb-3">RPC Functions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            {
              group: 'Full-Text Search',
              color: '#d97706',
              fns: [
                'search_board_resolutions(query, limit)',
                'search_processed_documents(query, limit)',
                'search_company_mandates(query, limit)',
                'search_knowledge_keyword(query, limit)',
              ],
            },
            {
              group: 'Semantic Search',
              color: '#6366f1',
              fns: [
                'search_board_resolutions_semantic(embedding, match_threshold, limit)',
                'search_processed_documents_semantic(...)',
                'search_company_mandates_semantic(...)',
                'search_knowledge_semantic(...)',
              ],
            },
            {
              group: 'Embeddings',
              color: '#059669',
              fns: [
                'knowledge_embedding_stats()',
                'bulk_update_embeddings(table, id_array, embedding_array)',
              ],
            },
            {
              group: 'LLM Observability',
              color: '#059669',
              fns: [
                'get_llm_usage_stats(start_date, end_date, fn_name, model, status)',
                'get_llm_usage_options()',
              ],
            },
          ].map((section) => (
            <div key={section.group} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
              <div className="px-3.5 py-2 text-white text-[11px] font-semibold" style={{ backgroundColor: section.color }}>
                {section.group}
              </div>
              <div className="p-2 space-y-1">
                {section.fns.map((fn) => (
                  <div key={fn} className="text-[11px] font-mono text-gray-700 px-2 py-1 bg-gray-50 rounded">
                    {fn}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Extensions */}
      <div className="flex flex-wrap gap-2">
        <span className="text-[11px] text-gray-500 self-center">Extensions:</span>
        {['pgvector (vector similarity search)', 'pg_trgm (fuzzy text matching)', 'unaccent (text normalization)'].map((e) => (
          <span key={e} className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono">
            {e}
          </span>
        ))}
      </div>
    </div>
  );
}
