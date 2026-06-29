import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Building2, ChevronDown, ZoomIn, ZoomOut, RotateCcw, X, Calendar, Shield, Briefcase, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Director {
  name: string;
  title: string | null;
  signingArrangement: 'sole' | 'joint' | 'any-two' | 'other' | 'unknown';
  authorizedProducts: string[];
  signingRules: string[];
  effectiveDate: string | null;
  expiryDate: string | null;
  hasMandateDetail: boolean;
}

interface EntityData {
  companyName: string;
  directors: Director[];
  resolutionType: string | null;
}

interface GroupOption { type: 'group'; label: string; prefix: string; members: string[] }
interface CompanyOption { type: 'company'; label: string; name: string }
type SelectOption = GroupOption | CompanyOption;
type Pos = { x: number; y: number };

// ── Layout math ────────────────────────────────────────────────────────────────

function radialPos(n: number, cx: number, cy: number, r: number, startAngle = -Math.PI / 2): Pos[] {
  if (n === 0) return [];
  if (n === 1) return [{ x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }];
  return Array.from({ length: n }, (_, i) => {
    const a = startAngle + (2 * Math.PI / n) * i;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function fanPos(n: number, px: number, py: number, cx: number, cy: number, r: number): Pos[] {
  const dir = Math.atan2(py - cy, px - cx);
  if (n === 0) return [];
  if (n === 1) return [{ x: px + r * Math.cos(dir), y: py + r * Math.sin(dir) }];
  const spread = Math.min(Math.PI * 0.8, (n - 1) * 0.45);
  return Array.from({ length: n }, (_, i) => {
    const a = dir + spread * (i / (n - 1) - 0.5);
    return { x: px + r * Math.cos(a), y: py + r * Math.sin(a) };
  });
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function arrangementStyle(a: string) {
  switch (a) {
    case 'sole':    return { fill: '#15803d', label: 'SOLE' };
    case 'joint':   return { fill: '#b45309', label: 'JOINT' };
    case 'any-two': return { fill: '#7c3aed', label: 'ANY TWO' };
    default:        return { fill: '#64748b', label: a === 'unknown' ? '?' : a.toUpperCase() };
  }
}

function isExpired(d: string | null) {
  return d ? new Date(d) < new Date() : false;
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchEntityData(companies: string[]): Promise<EntityData[]> {
  const [brRes, cmRes] = await Promise.all([
    supabase.from('board_resolutions')
      .select('company_name,resolution_type,signatories,authorized_persons,key_decisions')
      .in('company_name', companies)
      .order('created_at', { ascending: false }),
    supabase.from('company_mandates')
      .select('company_name,director_name,title,signing_arrangement,authorized_products,signing_rules,effective_date,expiry_date')
      .in('company_name', companies),
  ]);

  const rawBR   = brRes.data ?? [];
  const rawCM   = cmRes.data ?? [];

  return companies.map(companyName => {
    const resolution = rawBR.find(r => r.company_name === companyName) ?? null;
    const mandates   = rawCM.filter(m => m.company_name === companyName);

    const dirMap = new Map<string, Director>();

    mandates.forEach(m => {
      dirMap.set(m.director_name, {
        name:               m.director_name,
        title:              m.title ?? null,
        signingArrangement: (m.signing_arrangement ?? 'unknown') as Director['signingArrangement'],
        authorizedProducts: Array.isArray(m.authorized_products) ? m.authorized_products : [],
        signingRules:       Array.isArray(m.signing_rules) ? m.signing_rules : [],
        effectiveDate:      m.effective_date ?? null,
        expiryDate:         m.expiry_date ?? null,
        hasMandateDetail:   true,
      });
    });

    if (resolution) {
      const signatories: string[] = [
        ...(Array.isArray(resolution.signatories) ? resolution.signatories : []),
        ...(Array.isArray(resolution.authorized_persons) ? resolution.authorized_persons : []),
      ];
      const keyDecisions: string[] = Array.isArray(resolution.key_decisions) ? resolution.key_decisions : [];

      signatories.forEach(name => {
        const n = name.trim();
        if (n && !dirMap.has(n)) {
          dirMap.set(n, {
            name: n, title: null,
            signingArrangement: 'unknown',
            authorizedProducts: [],
            signingRules: keyDecisions.slice(0, 3),
            effectiveDate: null, expiryDate: null,
            hasMandateDetail: false,
          });
        }
      });
    }

    return {
      companyName,
      directors:      Array.from(dirMap.values()),
      resolutionType: resolution?.resolution_type ?? null,
    };
  }).filter(e => e.directors.length > 0);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CompanyAnalysis() {
  const [options, setOptions]       = useState<SelectOption[]>([]);
  const [selected, setSelected]     = useState<SelectOption | null>(null);
  const [entities, setEntities]     = useState<EntityData[]>([]);
  const [loading, setLoading]       = useState(false);
  const [dropOpen, setDropOpen]     = useState(false);
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<{ entity: string; dir: Director } | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [transform, setTransform]   = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);

  // ── Load company options ───────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const [brRes, cmRes, grpRes] = await Promise.all([
        supabase.from('board_resolutions').select('company_name').not('company_name', 'is', null),
        supabase.from('company_mandates').select('company_name'),
        supabase.from('company_groups').select('group_name,member_companies'),
      ]);

      const names = new Set<string>();
      (brRes.data ?? []).forEach(r => r.company_name && names.add(r.company_name));
      (cmRes.data ?? []).forEach(r => r.company_name && names.add(r.company_name));
      const allNames = Array.from(names).sort();

      // Auto-detect groups by shared first word (2+ members)
      const byPrefix = new Map<string, string[]>();
      allNames.forEach(n => {
        const p = n.split(/[\s\-_]/)[0];
        byPrefix.set(p, [...(byPrefix.get(p) ?? []), n]);
      });

      const opts: SelectOption[] = [];

      // DB-defined groups
      (grpRes.data ?? []).forEach(g => {
        opts.push({ type: 'group', label: `${g.group_name} Group`, prefix: g.group_name, members: g.member_companies as string[] });
      });

      // Auto-detected groups not already covered
      byPrefix.forEach((members, prefix) => {
        if (members.length >= 2) {
          const covered = (grpRes.data ?? []).some(g =>
            (g.member_companies as string[]).some(m => m.startsWith(prefix))
          );
          if (!covered) opts.push({ type: 'group', label: `${prefix} Group`, prefix, members });
        }
      });

      opts.sort((a, b) => a.label.localeCompare(b.label));
      allNames.forEach(n => opts.push({ type: 'company', label: n, name: n }));
      setOptions(opts);
    }
    load();
  }, []);

  // ── Load data for selection ────────────────────────────────────────────────

  useEffect(() => {
    if (!selected) { setEntities([]); return; }
    const companies = selected.type === 'group' ? selected.members : [selected.name];
    setLoading(true);
    setExpandedEntity(null);
    setSelectedDir(null);
    setTransform({ x: 0, y: 0, scale: 1 });
    fetchEntityData(companies).then(data => {
      setEntities(data);
      if (selected.type === 'company' && data.length === 1) setExpandedEntity(data[0].companyName);
      setLoading(false);
    });
  }, [selected]);

  // ── Zoom / Pan ─────────────────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setTransform(t => ({ ...t, scale: Math.max(0.25, Math.min(3, t.scale * (e.deltaY > 0 ? 0.9 : 1.1))) }));
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setTransform(t => ({ ...t, x: dragRef.current!.tx + e.clientX - dragRef.current!.sx, y: dragRef.current!.ty + e.clientY - dragRef.current!.sy }));
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);
  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  // ── SVG rendering — single company ─────────────────────────────────────────

  function renderSingle(entity: EntityData) {
    const n = entity.directors.length;
    const dPos = radialPos(n, 0, 0, 240);
    const edges: JSX.Element[] = [];
    const nodes: JSX.Element[] = [];

    entity.directors.forEach((dir, i) => {
      const dp = dPos[i];
      const hk = `dir-${dir.name}`;
      const hot = hoveredKey === hk;
      const sel = selectedDir?.dir.name === dir.name;
      const { fill, label } = arrangementStyle(dir.signingArrangement);
      const leaves = dir.authorizedProducts.length > 0 ? dir.authorizedProducts : dir.signingRules.slice(0, 2);
      const lPos = fanPos(leaves.length, dp.x, dp.y, 0, 0, 175);

      // Director → leaf edges
      leaves.forEach((_, j) => {
        const lp = lPos[j];
        edges.push(
          <path key={`el-${i}-${j}`} d={curve(dp.x, dp.y, lp.x, lp.y)}
            fill="none" stroke={hot ? '#1e3a8a' : '#e2e8f0'} strokeWidth={1} strokeOpacity={0.8}
            className="transition-all duration-200"
          />
        );
      });

      // Company → director edge
      edges.push(
        <path key={`ec-${i}`} d={curve(0, 0, dp.x, dp.y)}
          fill="none" stroke={hot || sel ? '#DB0011' : '#cbd5e1'}
          strokeWidth={hot || sel ? 2 : 1.5} strokeOpacity={hot || sel ? 1 : 0.5}
          className="transition-all duration-200"
        />
      );

      // Leaf nodes
      leaves.forEach((leaf, j) => {
        const lp = lPos[j];
        const isProduct = dir.authorizedProducts.length > 0;
        nodes.push(
          <g key={`leaf-${i}-${j}`} transform={`translate(${lp.x} ${lp.y})`}>
            <rect x={-50} y={-13} width={100} height={26} rx={13}
              fill={hot ? (isProduct ? '#1e3a8a' : '#334155') : '#f1f5f9'}
              stroke={hot ? 'none' : '#e2e8f0'} strokeWidth={1}
              className="transition-all duration-200"
            />
            <title>{leaf}</title>
            <text x={0} y={4} textAnchor="middle" fontSize={9} fontWeight={500}
              fill={hot ? 'white' : '#475569'}
              className="transition-all duration-200"
            >
              {truncate(leaf, 14)}
            </text>
          </g>
        );
      });

      // Director node
      nodes.push(
        <g key={`dn-${i}`} transform={`translate(${dp.x} ${dp.y})`}
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredKey(hk)}
          onMouseLeave={() => setHoveredKey(null)}
          onClick={() => setSelectedDir(prev => prev?.dir.name === dir.name ? null : { entity: entity.companyName, dir })}
        >
          <title>{dir.name}{dir.title ? ` — ${dir.title}` : ''}</title>
          <circle r={40}
            fill={sel ? '#DB0011' : '#1e3a8a'}
            filter={hot || sel ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.35))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))'}
            className="transition-all duration-200"
          />
          <circle r={36} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          <text x={0} y={-5} textAnchor="middle" fill="white" fontSize={9} fontWeight={600}>
            {truncate(dir.name.split(' ').slice(-1)[0], 10)}
          </text>
          <text x={0} y={7} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize={8}>
            {truncate(dir.name.split(' ').slice(0, -1).join(' '), 12)}
          </text>
          <rect x={-18} y={27} width={36} height={14} rx={7} fill={fill} />
          <text x={0} y={37} textAnchor="middle" fill="white" fontSize={7} fontWeight={700}>{label}</text>
          {dir.hasMandateDetail && <circle r={5} cx={33} cy={-33} fill="#22c55e" stroke="white" strokeWidth={1.5} />}
          {isExpired(dir.expiryDate) && <circle r={5} cx={-33} cy={-33} fill="#ef4444" stroke="white" strokeWidth={1.5} />}
        </g>
      );
    });

    // Company centre node
    nodes.push(
      <g key="centre">
        <circle r={62} fill="#DB0011" filter="drop-shadow(0 6px 20px rgba(219,0,17,0.45))" />
        <circle r={57} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
        <text x={0} y={-14} textAnchor="middle" fill="white" fontSize={11} fontWeight={700}>
          {truncate(entity.companyName.split(' ').slice(0, 2).join(' '), 16)}
        </text>
        <text x={0} y={2} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={9}>
          {truncate(entity.companyName.split(' ').slice(2).join(' '), 18)}
        </text>
        <text x={0} y={18} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={8}>
          {entity.directors.length} authorised persons
        </text>
      </g>
    );

    return { edges, nodes };
  }

  // ── SVG rendering — group ──────────────────────────────────────────────────

  function renderGroup() {
    const n = entities.length;
    const ePos = radialPos(n, 0, 0, 255);
    const edges: JSX.Element[] = [];
    const nodes: JSX.Element[] = [];

    entities.forEach((entity, i) => {
      const ep = ePos[i];
      const expanded = expandedEntity === entity.companyName;
      const ehk = `entity-${entity.companyName}`;
      const ehot = hoveredKey === ehk;

      // Group → entity edge
      edges.push(
        <path key={`ge-${i}`} d={curve(0, 0, ep.x, ep.y)}
          fill="none" stroke={expanded ? '#DB0011' : '#cbd5e1'}
          strokeWidth={expanded ? 2 : 1.5} strokeOpacity={expanded ? 0.8 : 0.45}
          className="transition-all duration-200"
        />
      );

      // Expanded directors
      if (expanded) {
        const dPos = fanPos(entity.directors.length, ep.x, ep.y, 0, 0, 180);
        entity.directors.forEach((dir, j) => {
          const dp = dPos[j];
          const { fill, label } = arrangementStyle(dir.signingArrangement);
          const sel = selectedDir?.dir.name === dir.name && selectedDir.entity === entity.companyName;
          const dhk = `dir-${entity.companyName}-${dir.name}`;
          const dhot = hoveredKey === dhk;

          edges.push(
            <path key={`de-${i}-${j}`} d={curve(ep.x, ep.y, dp.x, dp.y)}
              fill="none" stroke={dhot ? '#1e3a8a' : '#94a3b8'}
              strokeWidth={dhot ? 1.5 : 1} strokeOpacity={0.6}
              className="transition-all duration-200"
            />
          );

          nodes.push(
            <g key={`dn-${i}-${j}`} transform={`translate(${dp.x} ${dp.y})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredKey(dhk)}
              onMouseLeave={() => setHoveredKey(null)}
              onClick={e => { e.stopPropagation(); setSelectedDir(prev => prev?.dir.name === dir.name && prev.entity === entity.companyName ? null : { entity: entity.companyName, dir }); }}
            >
              <title>{dir.name}</title>
              <circle r={30} fill={sel ? '#DB0011' : '#1e3a8a'}
                filter={dhot || sel ? 'drop-shadow(0 3px 10px rgba(0,0,0,0.3))' : 'drop-shadow(0 1px 4px rgba(0,0,0,0.2))'}
                className="transition-all duration-200"
              />
              <text x={0} y={-3} textAnchor="middle" fill="white" fontSize={8} fontWeight={600}>
                {truncate(dir.name.split(' ').slice(-1)[0], 9)}
              </text>
              <text x={0} y={8} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={7}>
                {truncate(dir.name.split(' ').slice(0, -1).join(' '), 10)}
              </text>
              <rect x={-14} y={21} width={28} height={11} rx={5.5} fill={fill} />
              <text x={0} y={29} textAnchor="middle" fill="white" fontSize={6} fontWeight={700}>{label}</text>
              {dir.hasMandateDetail && <circle r={4} cx={24} cy={-24} fill="#22c55e" stroke="white" strokeWidth={1} />}
            </g>
          );
        });
      }

      // Entity node
      nodes.push(
        <g key={`en-${i}`} transform={`translate(${ep.x} ${ep.y})`}
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredKey(ehk)}
          onMouseLeave={() => setHoveredKey(null)}
          onClick={() => { setExpandedEntity(prev => prev === entity.companyName ? null : entity.companyName); setSelectedDir(null); }}
        >
          <title>{entity.companyName}</title>
          <circle r={48}
            fill={expanded ? '#DB0011' : ehot ? '#2563eb' : '#1e40af'}
            filter={expanded || ehot ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.35))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))'}
            className="transition-all duration-200"
          />
          <circle r={43} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          <text x={0} y={-8} textAnchor="middle" fill="white" fontSize={8} fontWeight={700}>
            {truncate(entity.companyName.split(' ').slice(-2).join(' '), 14)}
          </text>
          <text x={0} y={5} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={7}>
            {entity.directors.length} persons
          </text>
          <text x={0} y={18} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize={6}>
            {expanded ? '▲ collapse' : '▼ tap to expand'}
          </text>
        </g>
      );
    });

    // Group centre
    const groupLabel = selected?.type === 'group' ? selected.prefix : '';
    nodes.push(
      <g key="group-centre">
        <circle r={68} fill="#DB0011" filter="drop-shadow(0 8px 24px rgba(219,0,17,0.5))" />
        <circle r={63} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2} />
        <text x={0} y={-10} textAnchor="middle" fill="white" fontSize={15} fontWeight={800} letterSpacing={1}>
          {groupLabel.toUpperCase()}
        </text>
        <text x={0} y={8} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={10} letterSpacing={2}>GROUP</text>
        <text x={0} y={25} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={9}>
          {entities.length} entities
        </text>
      </g>
    );

    return { edges, nodes };
  }

  const isGroup = selected?.type === 'group';
  const { edges, nodes } = (() => {
    if (!entities.length) return { edges: [], nodes: [] };
    return isGroup ? renderGroup() : renderSingle(entities[0]);
  })();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-36px)] bg-slate-50">

      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-[#DB0011]" />
          <h2 className="text-base font-semibold text-gray-900 hidden sm:block">Company Analysis</h2>
        </div>

        {/* Company dropdown */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <button
            onClick={() => setDropOpen(d => !d)}
            className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-white hover:border-gray-400 transition-colors text-left"
          >
            <span className="text-sm text-gray-700 truncate">
              {selected ? selected.label : 'Select company or group…'}
            </span>
            <ChevronDown className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform duration-200', dropOpen && 'rotate-180')} />
          </button>

          <AnimatePresence>
            {dropOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full mt-1 left-0 w-72 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
              >
                <div className="max-h-80 overflow-y-auto">
                  {options.filter(o => o.type === 'group').length > 0 && (
                    <>
                      <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 sticky top-0">Groups</div>
                      {options.filter(o => o.type === 'group').map(opt => (
                        <button key={opt.label} onClick={() => { setSelected(opt); setDropOpen(false); }}
                          className={cn('w-full px-4 py-2.5 text-left hover:bg-red-50 flex items-center gap-2.5', selected?.label === opt.label && 'bg-red-50')}
                        >
                          <span className="text-[10px] font-bold text-[#DB0011] bg-red-100 px-1.5 py-0.5 rounded shrink-0">GRP</span>
                          <span className="text-sm text-gray-800 flex-1">{opt.label}</span>
                          <span className="text-xs text-gray-400">{opt.type === 'group' ? `${opt.members.length}` : ''}</span>
                        </button>
                      ))}
                    </>
                  )}
                  <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 sticky top-0">Companies</div>
                  {options.filter(o => o.type === 'company').map(opt => (
                    <button key={opt.label} onClick={() => { setSelected(opt); setDropOpen(false); }}
                      className={cn('w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2', selected?.label === opt.label && 'bg-gray-50')}
                    >
                      <Building2 className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Zoom controls */}
        {entities.length > 0 && (
          <div className="flex items-center gap-0.5 ml-auto">
            <button onClick={() => setTransform(t => ({ ...t, scale: Math.min(3, t.scale * 1.25) }))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ZoomIn className="h-4 w-4" /></button>
            <button onClick={() => setTransform(t => ({ ...t, scale: Math.max(0.25, t.scale * 0.8) }))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ZoomOut className="h-4 w-4" /></button>
            <button onClick={resetView} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><RotateCcw className="h-4 w-4" /></button>
            <span className="text-xs text-gray-400 ml-1 w-10">{Math.round(transform.scale * 100)}%</span>
          </div>
        )}
      </div>

      {/* Canvas + panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {!selected ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
              <Network className="h-16 w-16 text-gray-200" />
              <p className="text-gray-500 font-medium">Select a company or group to visualise</p>
              <p className="text-gray-400 text-sm max-w-xs">Directors, signatories, and their authorisations will appear as an interactive mindmap</p>
            </div>
          ) : loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[#DB0011] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Loading…</p>
              </div>
            </div>
          ) : (
            <svg
              className="w-full h-full select-none"
              viewBox="-700 -500 1400 1000"
              style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
              onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
              onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              onClick={() => setDropOpen(false)}
            >
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                {edges}
                {nodes}
              </g>
            </svg>
          )}

          {/* Legend */}
          {entities.length > 0 && !loading && (
            <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-xl border border-gray-200 p-3 shadow-sm text-left">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Signing Authority</p>
              {(['sole', 'joint', 'any-two', 'unknown'] as const).map(a => {
                const { fill, label } = arrangementStyle(a);
                return (
                  <div key={a} className="flex items-center gap-1.5 mb-1 last:mb-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fill }} />
                    <span className="text-xs text-gray-600">{label === '?' ? 'Unknown' : label.charAt(0) + label.slice(1).toLowerCase()}</span>
                  </div>
                );
              })}
              <div className="border-t border-gray-100 mt-2 pt-2 space-y-1">
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" /><span className="text-xs text-gray-600">Full mandate on file</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" /><span className="text-xs text-gray-600">Expired</span></div>
              </div>
            </div>
          )}

          {/* Hint for group view */}
          {isGroup && entities.length > 0 && !loading && !expandedEntity && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm rounded-full border border-gray-200 px-4 py-1.5 shadow-sm">
              <p className="text-xs text-gray-500">Click an entity to expand its signatories</p>
            </div>
          )}
        </div>

        {/* Director detail panel */}
        <AnimatePresence>
          {selectedDir && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="bg-white border-l border-gray-200 overflow-y-auto overflow-x-hidden shrink-0"
            >
              <div className="w-80 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-base leading-tight">{selectedDir.dir.name}</h3>
                    {selectedDir.dir.title && <p className="text-sm text-gray-500 mt-0.5">{selectedDir.dir.title}</p>}
                    <p className="text-xs text-gray-400 mt-1 truncate">{selectedDir.entity}</p>
                  </div>
                  <button onClick={() => setSelectedDir(null)} className="p-1.5 hover:bg-gray-100 rounded-lg ml-2 shrink-0">
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>

                {/* Signing arrangement badge */}
                {(() => {
                  const { fill, label } = arrangementStyle(selectedDir.dir.signingArrangement);
                  return (
                    <div className="mb-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-xs font-bold" style={{ backgroundColor: fill }}>
                        <Shield className="h-3 w-3" />{label} SIGNATORY
                      </span>
                      {!selectedDir.dir.hasMandateDetail && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
                          <AlertTriangle className="h-3 w-3" /> Board resolution only
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* Dates */}
                {(selectedDir.dir.effectiveDate || selectedDir.dir.expiryDate) && (
                  <div className="bg-gray-50 rounded-xl p-3 mb-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />Dates
                    </p>
                    {selectedDir.dir.effectiveDate && (
                      <p className="text-sm text-gray-700">
                        <span className="text-gray-400 text-xs">Effective: </span>{selectedDir.dir.effectiveDate}
                      </p>
                    )}
                    {selectedDir.dir.expiryDate && (
                      <p className={cn('text-sm mt-0.5', isExpired(selectedDir.dir.expiryDate) ? 'text-red-600 font-semibold' : 'text-gray-700')}>
                        <span className="text-gray-400 text-xs font-normal">Expires: </span>{selectedDir.dir.expiryDate}
                        {isExpired(selectedDir.dir.expiryDate) && <span className="text-xs ml-1 text-red-500">(expired)</span>}
                      </p>
                    )}
                  </div>
                )}

                {/* Authorised products */}
                {selectedDir.dir.authorizedProducts.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Briefcase className="h-3 w-3" />Authorised For
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDir.dir.authorizedProducts.map(p => (
                        <span key={p} className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium border border-blue-100">{p}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Signing rules / key decisions */}
                {selectedDir.dir.signingRules.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      {selectedDir.dir.hasMandateDetail ? 'Signing Rules' : 'Key Decisions (from Resolution)'}
                    </p>
                    <ul className="space-y-2">
                      {selectedDir.dir.signingRules.map((rule, i) => (
                        <li key={i} className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5 leading-relaxed border border-gray-100">{rule}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
