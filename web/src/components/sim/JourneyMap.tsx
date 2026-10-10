import { useMemo } from 'react';
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import type { NodeSummary, PromiseOption } from '../../api/types';
import { customerLocation } from '../../lib/departments';
import { NODE_COLORS, PACKAGE_COLORS, STOCK_POINT_TYPE_LABEL } from '../../lib/labels';
import { FranceMap } from '../FranceMap';

/** Leaflet mini-map drawing every shipment path of an option, one color per package. */
export function JourneyMap({ option, nodes, postalCode, height = 360 }: { option: PromiseOption; nodes: Record<string, NodeSummary>; postalCode: string; height?: number }) {
  const customer = customerLocation(postalCode);
  const pkgIndex = useMemo(() => new Map(option.packages.map((p, i) => [p.packageId, i])), [option]);

  const { lines, usedNodes, bounds } = useMemo(() => {
    const pos = (id: string): [number, number] | null => {
      if (id === 'CUSTOMER') return customer;
      const n = nodes[id];
      return n ? [n.lat, n.lon] : null;
    };
    const lines: { key: string; points: [number, number][]; color: string; label: string; dashed: boolean }[] = [];
    const used = new Set<string>();
    option.shipments.forEach((s) => {
      const color = PACKAGE_COLORS[(pkgIndex.get(s.packageId) ?? 0) % PACKAGE_COLORS.length];
      s.legs.forEach((l, i) => {
        const a = pos(l.from);
        const b = pos(l.to);
        used.add(l.from);
        used.add(l.to);
        if (a && b) lines.push({ key: `${s.id}-${i}`, points: [a, b], color, label: `${s.packageId} · ${s.id} · ${l.carrierName} (${l.service})`, dashed: s.kind === 'INBOUND' });
      });
    });
    const pts: [number, number][] = [];
    used.forEach((id) => {
      const p = pos(id);
      if (p) pts.push(p);
    });
    let bounds: LatLngBoundsExpression | null = null;
    if (pts.length) {
      const lats = pts.map((p) => p[0]);
      const lons = pts.map((p) => p[1]);
      bounds = [
        [Math.min(...lats) - 0.3, Math.min(...lons) - 0.3],
        [Math.max(...lats) + 0.3, Math.max(...lons) + 0.3],
      ];
    }
    return { lines, usedNodes: [...used], bounds };
  }, [option, nodes, customer, pkgIndex]);

  return (
    <div>
      <FranceMap height={height} bounds={bounds}>
        {lines.map((l) => (
          <Polyline key={l.key} positions={l.points} pathOptions={{ color: l.color, weight: 3, opacity: 0.85, dashArray: l.dashed ? '6 6' : undefined }}>
            <Tooltip sticky>{l.label}</Tooltip>
          </Polyline>
        ))}
        {usedNodes.map((id) => {
          if (id === 'CUSTOMER') {
            return customer ? (
              <CircleMarker key={id} center={customer} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: NODE_COLORS.CUSTOMER, fillOpacity: 1 }}>
                <Tooltip permanent direction="right" offset={[8, 0]}>
                  Client ({postalCode}, approx.)
                </Tooltip>
              </CircleMarker>
            ) : null;
          }
          const n = nodes[id];
          if (!n) return null;
          return (
            <CircleMarker key={id} center={[n.lat, n.lon]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: NODE_COLORS[n.kind] ?? '#515b60', fillOpacity: 1 }}>
              <Tooltip direction="top" offset={[0, -6]}>
                <div className="text-xs">
                  <div className="font-medium">{n.name}</div>
                  {n.id} · {STOCK_POINT_TYPE_LABEL[n.kind] ?? n.kind} · {n.city}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </FranceMap>
      <div className="mt-m flex flex-wrap gap-l text-xs text-neutral-700">
        {option.packages.map((p, i) => (
          <span key={p.packageId} className="flex items-center gap-s">
            <span className="inline-block h-[3px] w-[18px]" style={{ background: PACKAGE_COLORS[i % PACKAGE_COLORS.length] }} />
            {p.packageId}
          </span>
        ))}
        <span className="flex items-center gap-s text-neutral-500">
          <svg width="18" height="4">
            <line x1="0" y1="2" x2="18" y2="2" stroke="#7f7f7f" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Flux entrant vers un hub de consolidation
        </span>
        {!customer && <span className="text-orange">Position client inconnue pour ce code postal</span>}
      </div>
    </div>
  );
}
