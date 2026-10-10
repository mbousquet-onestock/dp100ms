import { useMemo } from 'react';
import type { NodeSummary, PromiseOption } from '../../api/types';
import { NODE_COLORS, PACKAGE_COLORS, STOCK_POINT_TYPE_LABEL } from '../../lib/labels';

const COL_W = 290;
const NODE_W = 170;
const NODE_H = 46;
const ROW_H = 70;

/**
 * Schematic left-to-right flow of an option: sources → hubs → customer.
 * Columns are the longest-path depth of each node in the shipment DAG.
 */
export function FlowDiagram({ option, nodes }: { option: PromiseOption; nodes: Record<string, NodeSummary> }) {
  const layout = useMemo(() => {
    const pkgIdx = new Map(option.packages.map((p, i) => [p.packageId, i]));
    const edges: { from: string; to: string; color: string; label: string; key: string }[] = [];
    const ids = new Set<string>();
    option.shipments.forEach((s) =>
      s.legs.forEach((l, i) => {
        ids.add(l.from);
        ids.add(l.to);
        edges.push({ from: l.from, to: l.to, color: PACKAGE_COLORS[(pkgIdx.get(s.packageId) ?? 0) % PACKAGE_COLORS.length], label: l.carrierName, key: `${s.id}-${i}` });
      }),
    );
    // longest path depth
    const depth = new Map<string, number>();
    ids.forEach((id) => depth.set(id, 0));
    for (let it = 0; it < ids.size; it++) {
      let changed = false;
      for (const e of edges) {
        const d = (depth.get(e.from) ?? 0) + 1;
        if (d > (depth.get(e.to) ?? 0)) {
          depth.set(e.to, d);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const maxD = Math.max(1, ...[...depth.values()]);
    if (ids.has('CUSTOMER')) depth.set('CUSTOMER', maxD);
    const cols: string[][] = Array.from({ length: maxD + 1 }, () => []);
    [...ids].sort().forEach((id) => cols[depth.get(id) ?? 0].push(id));
    const rows = Math.max(...cols.map((c) => c.length));
    const height = Math.max(rows * ROW_H, ROW_H) + 20;
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((c, ci) => {
      const offset = (height - c.length * ROW_H) / 2;
      c.forEach((id, ri) => pos.set(id, { x: ci * COL_W + 10, y: offset + ri * ROW_H + (ROW_H - NODE_H) / 2 }));
    });
    // parallel edge offsets
    const pairCount = new Map<string, number>();
    const edgeOffsets = edges.map((e) => {
      const k = `${e.from}>${e.to}`;
      const n = pairCount.get(k) ?? 0;
      pairCount.set(k, n + 1);
      return n;
    });
    return { edges, edgeOffsets, pos, width: (maxD + 1) * COL_W - (COL_W - NODE_W) + 20, height, ids: [...ids] };
  }, [option]);

  return (
    <div className="overflow-x-auto">
      <svg width={layout.width} height={layout.height} role="img" aria-label="Schéma des flux de l'option">
        {layout.edges.map((e, i) => {
          const a = layout.pos.get(e.from)!;
          const b = layout.pos.get(e.to)!;
          const off = (layout.edgeOffsets[i] - 0) * 6;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2 + off;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2 + off;
          const mx = (x1 + x2) / 2;
          return (
            <g key={e.key}>
              <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 6},${y2}`} fill="none" stroke={e.color} strokeWidth={2} />
              <path d={`M${x2 - 8},${y2 - 4} L${x2 - 1},${y2} L${x2 - 8},${y2 + 4}`} fill="none" stroke={e.color} strokeWidth={2} />
              <text x={mx} y={(y1 + y2) / 2 - 5} textAnchor="middle" fontSize={10} fill="#4c4c4c" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
                {e.label}
              </text>
            </g>
          );
        })}
        {layout.ids.map((id) => {
          const p = layout.pos.get(id)!;
          const n = nodes[id];
          const kind = id === 'CUSTOMER' ? 'CUSTOMER' : n?.kind ?? 'HUB';
          const color = NODE_COLORS[kind] ?? '#515b60';
          const title = id === 'CUSTOMER' ? 'Client' : n?.name ?? id;
          const sub = id === 'CUSTOMER' ? 'Adresse de livraison' : `${STOCK_POINT_TYPE_LABEL[kind] ?? kind} · ${n?.city ?? ''}`;
          return (
            <g key={id} transform={`translate(${p.x},${p.y})`}>
              <rect width={NODE_W} height={NODE_H} rx={5} fill="#fff" stroke="#e5e5e5" />
              <rect width={4} height={NODE_H} rx={2} fill={color} />
              <text x={12} y={19} fontSize={12} fontWeight={500} fill="#333">
                {title.length > 24 ? title.slice(0, 23) + '…' : title}
              </text>
              <text x={12} y={35} fontSize={10} fill="#7f7f7f">
                {sub.length > 30 ? sub.slice(0, 29) + '…' : sub}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
