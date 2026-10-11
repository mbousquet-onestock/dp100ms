import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../api/client';
import { qk, useCarrierRoutes, useCarriers, useCompiledRoutes, useCrud, useGraph, useModes, useServices, useZones } from '../api/hooks';
import type { CarrierRoute, CompiledPath, GraphLeg, GraphNode, Hub, Leg, Route } from '../api/types';
import { IconClose, IconEdit, IconExternal, IconFilter, IconHub, IconPlus, IconRoute, IconSearch, IconTrash, IconTruck } from '../components/Icons';
import { LegDrawer } from '../components/LegForm';
import { Alert, Badge, Card, ChipSelect, ConfirmButton, cx, Dot, EmptyState, ErrorAlert, Field, Loading, Modal, PageHeader, SearchInput, Spinner, Switch, useDebounced, useToast } from '../components/ui';
import { REGIONS, regionOf } from '../lib/departments';
import { NODE_COLORS, STOCK_POINT_TYPE_LABEL } from '../lib/labels';
import { fmtHours } from '../lib/routes';
import { emptyHub, HubDrawer } from './Hubs';

type NetNodeData = { label: string; id: string; kind: string; city: string; active: boolean; consolidation: boolean; dim: boolean; highlight: boolean };
type NetNode = Node<NetNodeData, 'net'>;
type Highlight = { legs: string[]; nodes: string[] } | null;

const COLUMN_ORDER = ['STORE', 'WAREHOUSE', 'HUB', 'LAST_MILE_HUB', 'CUSTOMER'];
const COLUMN_LABEL: Record<string, string> = { STORE: 'Magasins', WAREHOUSE: 'Entrepôts', HUB: 'Plateformes régionales', LAST_MILE_HUB: 'Hubs dernier kilomètre', CUSTOMER: 'Client' };
const CUSTOMER: GraphNode = { id: 'CUSTOMER', name: 'Client', kind: 'STORE', city: 'Adresse de livraison', lat: 0, lon: 0, active: true, isHub: false, consolidation: false };
/** Edge colors by carrier (teal is kept for highlights). */
const CARRIER_PALETTE = ['#2695f3', '#fd7e14', '#673ab7', '#43a047', '#f44539', '#c35f0b', '#e91e63', '#515b60', '#00838f', '#8d6e63'];
const HIGHLIGHT = '#24bdb0';

const NetNodeView = memo(function NetNodeView({ data, selected }: NodeProps<NetNode>) {
  const color = NODE_COLORS[data.kind] ?? '#515b60';
  return (
    <div
      className="relative flex w-[180px] items-stretch overflow-hidden rounded-m border bg-white text-left"
      style={{
        borderColor: selected || data.highlight ? 'var(--primary-1000)' : 'var(--neutral-100)',
        boxShadow: selected || data.highlight ? '0 0 0 1px var(--primary-1000)' : undefined,
        opacity: data.dim ? 0.35 : data.active ? 1 : 0.6,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, width: 8, height: 8 }} />
      <span className="w-[4px] flex-none" style={{ background: color }} />
      <div className="min-w-0 flex-1 px-m py-s">
        <div className="truncate text-xs font-medium text-neutral-800">{data.label}</div>
        <div className="truncate text-2xs text-neutral-500">
          {data.id === 'CUSTOMER' ? data.city : `${data.id} · ${data.city}`}
          {data.consolidation ? ' · conso.' : ''}
          {!data.active ? ' · inactif' : ''}
        </div>
      </div>
      {data.id !== 'CUSTOMER' && <Handle type="source" position={Position.Right} style={{ background: color, width: 8, height: 8 }} />}
    </div>
  );
});
const nodeTypes = { net: NetNodeView };

type FilterMode = 'region' | 'node' | 'all';

export default function Network() {
  return (
    <ReactFlowProvider>
      <NetworkEditor />
    </ReactFlowProvider>
  );
}

/** Transit of a leg from its carrier routes ("1 j – 2 j"), or empty when unknown. */
function transitLabel(routes: CarrierRoute[]): string {
  const timed = routes.filter((r) => r.transitMinHours || r.transitMaxHours);
  if (!timed.length) return routes.length ? 'Transit du service' : '';
  const min = Math.min(...timed.map((r) => r.transitMinHours));
  const max = Math.max(...timed.map((r) => r.transitMaxHours));
  return min === max ? fmtHours(min) : `${fmtHours(min)} – ${fmtHours(max)}`;
}

function NetworkEditor() {
  const graph = useGraph();
  const carriers = useCarriers();
  const services = useServices();
  const carrierRoutes = useCarrierRoutes();
  const zones = useZones();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const legs = useCrud<Leg>('legs', [qk.graph]);
  const hubCrud = useCrud<Hub>('hubs', [qk.hubs, qk.graph]);
  const routeCrud = useCrud<Route>('routes', [qk.graph]);
  const rf = useReactFlow();
  const [params, setParams] = useSearchParams();
  const carrierFilter = params.get('carrier') ?? '';
  const serviceFilter = params.get('service') ?? '';
  const routeFocus = params.get('carrierRoute') ?? '';
  const setParam = useCallback(
    (patch: Record<string, string>) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [filter, setFilter] = useState<FilterMode>(() => (params.get('carrier') || params.get('service') || params.get('carrierRoute') ? 'all' : params.get('node') ? 'node' : 'region'));
  const [region, setRegion] = useState('Auvergne-Rhône-Alpes');
  const [focus, setFocus] = useState(() => params.get('node') || 'HUB-RHONE');
  const [search, setSearch] = useState('');
  const dsearch = useDebounced(search);
  const [withNeighbors, setWithNeighbors] = useState(false);
  const [showCustomerLegs, setShowCustomerLegs] = useState(true);
  const [layout, setLayout] = useState<'type' | 'geo'>('type');
  const [legEdit, setLegEdit] = useState<{ leg: Leg; isNew: boolean } | null>(null);
  const [hubEdit, setHubEdit] = useState<{ v: Hub; isNew: boolean } | null>(null);
  const [building, setBuilding] = useState(false);
  const [routeLegs, setRouteLegs] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedLeg, setSelectedLeg] = useState<string | null>(null);
  const [newRoute, setNewRoute] = useState<{ from?: string; to?: string } | null>(null);

  const all = graph.data;
  const byId = useMemo(() => {
    const m = new Map<string, GraphNode>((all?.nodes ?? []).map((n) => [n.id, n]));
    m.set('CUSTOMER', CUSTOMER);
    return m;
  }, [all]);
  const legById = useMemo(() => new Map((all?.legs ?? []).map((l) => [l.id, l])), [all]);
  /** Legs the engine actually uses (generated from carrier routes, plus stored legs still in use). */
  const liveLegs = useMemo(() => (all?.legs ?? []).filter((l) => l.inUse !== false), [all]);
  const storedLegs = useMemo(() => (all?.legs ?? []).filter((l) => !l.generated), [all]);
  const regionById = useMemo(() => new Map((all?.nodes ?? []).map((n) => [n.id, regionOf(n.lat, n.lon)])), [all]);
  const nodeName = useCallback((id: string) => (id === 'CUSTOMER' ? 'Client' : byId.get(id)?.name ?? id), [byId]);
  const carrierById = useMemo(() => new Map((carriers.data?.items ?? []).map((c) => [c.id, c])), [carriers.data]);
  const serviceById = useMemo(() => new Map((services.data?.items ?? []).map((s) => [s.id, s])), [services.data]);
  const carrierRouteById = useMemo(() => new Map((carrierRoutes.data?.items ?? []).map((r) => [r.id, r])), [carrierRoutes.data]);
  const zoneName = useCallback((id: string) => zones.data?.items.find((z) => z.id === id)?.name ?? id, [zones.data]);
  const carrierIds = useMemo(() => [...new Set([...(carriers.data?.items ?? []).map((c) => c.id), ...(all?.legs ?? []).map((l) => l.carrierId)])].sort(), [carriers.data, all]);
  const carrierColor = useCallback((id: string) => CARRIER_PALETTE[Math.max(0, carrierIds.indexOf(id)) % CARRIER_PALETTE.length], [carrierIds]);
  const usedCarriers = useMemo(() => carrierIds.filter((c) => liveLegs.some((l) => l.carrierId === c)), [carrierIds, liveLegs]);
  const usedServices = useMemo(() => [...new Set(liveLegs.filter((l) => !carrierFilter || l.carrierId === carrierFilter).map((l) => l.serviceId))].sort(), [liveLegs, carrierFilter]);

  // legs kept by the carrier / service filters, or the legs of the focused carrier route
  const focusLegs = useMemo(() => (routeFocus ? liveLegs.filter((l) => l.carrierRouteIds?.includes(routeFocus)) : []), [routeFocus, liveLegs]);
  const netLegs = useMemo(() => {
    if (routeFocus) return focusLegs;
    return liveLegs.filter((l) => (!carrierFilter || l.carrierId === carrierFilter) && (!serviceFilter || l.serviceId === serviceFilter));
  }, [routeFocus, focusLegs, liveLegs, carrierFilter, serviceFilter]);
  const legFiltered = !!(routeFocus || carrierFilter || serviceFilter);

  // ---------------------------------------------------------------- visible set
  const visibleIds = useMemo(() => {
    if (!all) return new Set<string>();
    const touched = new Set(netLegs.flatMap((l) => [l.from, l.to]));
    const base = new Set<string>();
    const q = dsearch.toLowerCase();
    for (const n of all.nodes) {
      if (routeFocus) {
        if (touched.has(n.id)) base.add(n.id);
        continue;
      }
      if (filter === 'region' && regionById.get(n.id) !== region) continue;
      if (filter === 'node' && n.id !== focus) continue;
      if (q && !`${n.id} ${n.name} ${n.city}`.toLowerCase().includes(q)) continue;
      if (legFiltered && filter !== 'node' && !touched.has(n.id)) continue;
      base.add(n.id);
    }
    const out = new Set(base);
    if (!routeFocus && (filter === 'node' || withNeighbors)) {
      for (const l of netLegs) {
        if (l.to === 'CUSTOMER') continue;
        if (base.has(l.from)) out.add(l.to);
        if (base.has(l.to)) out.add(l.from);
      }
    }
    highlight?.nodes.forEach((id) => out.add(id));
    const sl = selectedLeg ? legById.get(selectedLeg) : undefined;
    for (const l of [...routeLegs.map((id) => legById.get(id)), sl]) {
      if (l) {
        out.add(l.from);
        out.add(l.to);
      }
    }
    if ((showCustomerLegs && !routeFocus) || highlight?.nodes.includes('CUSTOMER') || (routeFocus && netLegs.some((l) => l.to === 'CUSTOMER'))) out.add('CUSTOMER');
    return out;
  }, [all, netLegs, filter, region, focus, dsearch, withNeighbors, regionById, highlight, routeLegs, selectedLeg, legById, showCustomerLegs, routeFocus, legFiltered]);

  const visibleLegs = useMemo(() => {
    if (!all) return [];
    const forced = new Set([...(highlight?.legs ?? []), ...routeLegs, ...(selectedLeg ? [selectedLeg] : [])]);
    const keep = new Set(netLegs.map((l) => l.id));
    return liveLegs.filter((l) => (keep.has(l.id) || forced.has(l.id)) && visibleIds.has(l.from) && visibleIds.has(l.to) && (l.to !== 'CUSTOMER' || showCustomerLegs || routeFocus || forced.has(l.id)));
  }, [all, liveLegs, netLegs, visibleIds, showCustomerLegs, highlight, routeLegs, selectedLeg, routeFocus]);

  const hlLegs = useMemo(() => new Set([...(highlight?.legs ?? []), ...routeLegs, ...focusLegs.map((l) => l.id), ...(selectedLeg ? [selectedLeg] : [])]), [highlight, routeLegs, focusLegs, selectedLeg]);

  // ---------------------------------------------------------------- layout
  const computedNodes = useMemo<NetNode[]>(() => {
    const ids = [...visibleIds];
    const hl = new Set([...(highlight?.nodes ?? []), ...[...hlLegs].flatMap((id) => (legById.get(id) ? [legById.get(id)!.from, legById.get(id)!.to] : []))]);
    const dimOthers = hl.size > 0;
    const mk = (n: GraphNode, x: number, y: number): NetNode => ({
      id: n.id,
      type: 'net',
      position: { x, y },
      data: { label: n.name, id: n.id, kind: n.id === 'CUSTOMER' ? 'CUSTOMER' : n.kind, city: n.city, active: n.active, consolidation: n.consolidation, dim: dimOthers && !hl.has(n.id), highlight: hl.has(n.id) },
    });
    if (layout === 'geo') {
      const real = ids.map((id) => byId.get(id)!).filter((n) => n && n.id !== 'CUSTOMER');
      const lats = real.map((n) => n.lat);
      const lons = real.map((n) => n.lon);
      const minLon = Math.min(...lons, 0);
      const maxLat = Math.max(...lats, 0);
      const k = real.length > 40 ? 220 : 320;
      const out = real.map((n) => mk(n, (n.lon - minLon) * k * 0.72, (maxLat - n.lat) * k));
      if (visibleIds.has('CUSTOMER')) {
        const maxX = Math.max(0, ...out.map((n) => n.position.x));
        const maxY = Math.max(0, ...out.map((n) => n.position.y));
        out.push(mk(CUSTOMER, maxX + 320, maxY / 2));
      }
      return out;
    }
    const cols: Record<string, GraphNode[]> = {};
    for (const id of ids) {
      const n = byId.get(id);
      if (!n) continue;
      const col = id === 'CUSTOMER' ? 'CUSTOMER' : n.kind;
      (cols[col] ??= []).push(n);
    }
    const out: NetNode[] = [];
    const maxRows = Math.max(1, ...Object.values(cols).map((c) => c.length));
    COLUMN_ORDER.forEach((col, ci) => {
      const list = (cols[col] ?? []).sort((a, b) => (regionById.get(a.id) ?? '').localeCompare(regionById.get(b.id) ?? '') || a.city.localeCompare(b.city) || a.id.localeCompare(b.id));
      const offset = ((maxRows - list.length) * 62) / 2;
      list.forEach((n, ri) => out.push(mk(n, ci * 300, offset + ri * 62)));
    });
    return out;
  }, [visibleIds, layout, byId, regionById, highlight, hlLegs, legById]);

  const [nodes, setNodes, onNodesChange] = useNodesState<NetNode>([]);
  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes, setNodes]);
  const layoutKey = `${filter}|${region}|${focus}|${dsearch}|${layout}|${withNeighbors}|${showCustomerLegs}|${carrierFilter}|${serviceFilter}|${routeFocus}`;
  useEffect(() => {
    const t = window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 0 }), 60);
    return () => window.clearTimeout(t);
  }, [layoutKey, rf, graph.dataUpdatedAt]);

  const edges = useMemo<Edge[]>(() => {
    const dimOthers = hlLegs.size > 0 && !(routeFocus && hlLegs.size === focusLegs.length);
    const showLabels = visibleLegs.length <= 70;
    return visibleLegs.map((l) => {
      const on = hlLegs.has(l.id);
      const sel = l.id === selectedLeg;
      const color = carrierColor(l.carrierId);
      const toCustomer = l.to === 'CUSTOMER';
      return {
        id: l.id,
        source: l.from,
        target: l.to,
        label: showLabels || on ? l.carrierId : undefined,
        labelStyle: { fontSize: 10, fill: color, fontWeight: on ? 600 : 400 },
        labelBgStyle: { fill: '#fff' },
        style: { stroke: sel ? HIGHLIGHT : color, strokeWidth: sel ? 3.5 : on ? 2.5 : toCustomer ? 1 : 1.5, opacity: dimOthers && !on ? 0.12 : l.active ? (toCustomer && !on ? 0.6 : 0.95) : 0.4, strokeDasharray: l.active ? undefined : '4 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color: sel ? HIGHLIGHT : color, width: 14, height: 14 },
        zIndex: sel ? 20 : on ? 10 : 0,
      };
    });
  }, [visibleLegs, hlLegs, selectedLeg, carrierColor, routeFocus, focusLegs]);

  // ---------------------------------------------------------------- handlers
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    setNewRoute({ from: c.source, to: c.target });
  }, []);
  const pickLeg = useCallback(
    (id: string) => {
      if (building) {
        setRouteLegs((r) => [...r, id]);
        return;
      }
      setSelectedNode(null);
      setSelectedLeg((cur) => (cur === id ? null : id));
    },
    [building],
  );
  const onEdgeClick = useCallback((_: unknown, e: Edge) => legById.has(e.id) && pickLeg(e.id), [legById, pickLeg]);
  /** Picks a leg from the list and brings it into view in the graph. */
  const revealLeg = (id: string) => {
    pickLeg(id);
    const l = legById.get(id);
    if (!l || building) return;
    document.querySelector('[data-testid=network-graph]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    window.setTimeout(() => rf.fitView({ nodes: [{ id: l.from }, { id: l.to }], padding: 0.6, maxZoom: 1.2, duration: 300 }), 80);
  };
  const editStored = (l: Leg) => {
    legs.update.reset();
    setLegEdit({ leg: l, isNew: false });
  };

  const saveLeg = (l: Leg, isNew: boolean) => {
    const m = isNew ? legs.create : legs.update;
    m.mutate(l, {
      onSuccess: () => {
        toast(isNew ? 'Leg créé' : 'Enregistré');
        setLegEdit(null);
      },
    });
  };
  const deleteLeg = (id: string) =>
    legs.remove.mutate(id, {
      onSuccess: () => {
        toast('Leg supprimé');
        setLegEdit(null);
        setSelectedLeg(null);
      },
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const regionNames = Object.keys(REGIONS);
  const sel = selectedNode ? byId.get(selectedNode) : null;
  const selLeg = selectedLeg ? legById.get(selectedLeg) : undefined;
  const focusRoute = routeFocus ? carrierRouteById.get(routeFocus) : undefined;
  const nGenerated = liveLegs.filter((l) => l.generated).length;
  const nAppliedRoutes = new Set(liveLegs.flatMap((l) => l.carrierRouteIds ?? [])).size;
  const carrierName = (id: string) => carrierById.get(id)?.name ?? id;

  if (graph.isLoading) return <Loading />;
  if (graph.error || !all) return <ErrorAlert error={graph.error} title="Réseau indisponible" />;

  return (
    <div>
      <PageHeader
        title="Réseau"
        subtitle={`${all.nodes.length} nœuds · ${nGenerated} legs générés depuis ${nAppliedRoutes} routes transporteur · ${all.routes.length} itinéraires multi-étapes`}
        actions={
          <>
            <button
              className={cx('btn', building ? 'btn-primary' : 'btn-secondary')}
              onClick={() => {
                setBuilding((b) => !b);
                setRouteLegs([]);
                setSelectedLeg(null);
              }}
              aria-pressed={building}
            >
              <IconRoute /> {building ? 'Construction d’itinéraire active' : 'Construire un itinéraire'}
            </button>
            <button className="btn btn-secondary" onClick={() => setHubEdit({ v: emptyHub(), isNew: true })}>
              <IconHub /> Créer un hub
            </button>
            <button className="btn btn-primary" onClick={() => setNewRoute({})}>
              <IconPlus /> Nouvelle route transporteur
            </button>
          </>
        }
      />

      <Alert kind="info" className="mb-l">
        <div className="flex flex-wrap items-center justify-between gap-m" data-testid="network-carriers-banner">
          <span>Les transports sont configurés dans Transporteurs → routes. Cette page visualise le réseau qui en résulte et les itinéraires multi-étapes.</span>
          <Link to="/carriers" className="btn btn-secondary btn-sm">
            <IconTruck /> Ouvrir les transporteurs
          </Link>
        </div>
      </Alert>

      {routeFocus && (
        <Alert kind={focusLegs.length ? 'success' : 'warning'} className="mb-l" title={`Route transporteur ${focusRoute?.name || routeFocus}`} onClose={() => setParam({ carrierRoute: '' })}>
          <div className="flex flex-wrap items-center justify-between gap-m" data-testid="network-route-focus">
            <span>
              {focusLegs.length
                ? `${focusLegs.length} leg${focusLegs.length > 1 ? 's' : ''} généré${focusLegs.length > 1 ? 's' : ''} par cette route ${focusLegs.length > 1 ? 'sont mis' : 'est mis'} en évidence${focusRoute ? ` (${carrierName(focusRoute.carrierId)} · ${focusRoute.serviceId})` : ''}.`
                : 'Aucun leg n’est généré par cette route : elle est inactive, ou sa zone d’origine ne contient aucun site d’expédition.'}
            </span>
            <span className="flex flex-wrap gap-s">
              {focusRoute && (
                <Link to={`/carriers/${encodeURIComponent(focusRoute.carrierId)}/routes/${encodeURIComponent(focusRoute.id)}`} className="btn btn-secondary btn-sm">
                  <IconEdit /> Configurer la route
                </Link>
              )}
              <button className="btn btn-tertiary btn-sm" onClick={() => setParam({ carrierRoute: '' })}>
                Afficher tout le réseau
              </button>
            </span>
          </div>
        </Alert>
      )}

      {/* Toolbar */}
      <div className="card mb-l flex flex-wrap items-end gap-l px-l py-m">
        {!routeFocus && (
          <>
            <Field label="Filtrer par">
              <div className="segmented">
                <button aria-pressed={filter === 'region'} onClick={() => setFilter('region')}>
                  Région
                </button>
                <button aria-pressed={filter === 'node'} onClick={() => setFilter('node')}>
                  Nœud et voisins
                </button>
                <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  Tout
                </button>
              </div>
            </Field>
            {filter === 'region' && (
              <Field label="Région">
                <select className="select w-[230px] max-w-full" value={region} onChange={(e) => setRegion(e.target.value)}>
                  {regionNames.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            )}
            {filter === 'node' && (
              <Field label="Nœud">
                <select className="select w-[260px] max-w-full" value={focus} onChange={(e) => setFocus(e.target.value)}>
                  {[...all.nodes]
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id} · {n.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Transporteur">
              <select className="select w-[180px] max-w-full" value={carrierFilter} onChange={(e) => setParam({ carrier: e.target.value, service: '' })} data-testid="network-carrier-filter">
                <option value="">Tous</option>
                {usedCarriers.map((c) => (
                  <option key={c} value={c}>
                    {carrierName(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Service">
              <select className="select w-[200px] max-w-full" value={serviceFilter} onChange={(e) => setParam({ service: e.target.value })} data-testid="network-service-filter">
                <option value="">Tous</option>
                {usedServices.map((s) => (
                  <option key={s} value={s}>
                    {serviceById.get(s)?.name ?? s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ville ou nœud">
              <SearchInput className="w-[200px] max-w-full" value={search} onChange={setSearch} placeholder="Lyon, HUB-, STORE-021" />
            </Field>
          </>
        )}
        <Field label="Disposition">
          <div className="segmented">
            <button aria-pressed={layout === 'type'} onClick={() => setLayout('type')}>
              Par type
            </button>
            <button aria-pressed={layout === 'geo'} onClick={() => setLayout('geo')}>
              Géographique
            </button>
          </div>
        </Field>
        {!routeFocus && (
          <div className="flex flex-col gap-s pb-s">
            {filter !== 'node' && <Switch checked={withNeighbors} onChange={setWithNeighbors} label="Inclure les voisins" />}
            <Switch checked={showCustomerLegs} onChange={setShowCustomerLegs} label="Legs vers le client" />
          </div>
        )}
        <div className="ml-auto pb-s text-xs text-neutral-500">
          {visibleIds.size} nœuds · {visibleLegs.length} legs affichés
        </div>
      </div>

      {/* Carrier legend: edges are colored by carrier; a click filters on the carrier. */}
      <div className="mb-l flex flex-wrap items-center gap-s text-xs" data-testid="network-carrier-legend">
        <span className="mr-s text-neutral-500">Transporteurs :</span>
        {usedCarriers.map((c) => {
          const on = carrierFilter === c;
          return (
            <button
              key={c}
              type="button"
              className={cx('flex items-center gap-s rounded-l border px-m py-xs', on ? 'border-primary-1000 bg-primary-tint' : 'border-border bg-white hover:bg-neutral-30')}
              aria-pressed={on}
              title={on ? 'Retirer le filtre' : `Afficher uniquement ${carrierName(c)}`}
              onClick={() => {
                setParam({ carrier: on ? '' : c, service: '', carrierRoute: '' });
                if (!on && filter === 'region') setFilter('all');
              }}
            >
              <span className="inline-block h-[3px] w-[16px] rounded-s" style={{ background: carrierColor(c) }} />
              {carrierName(c)}
            </button>
          );
        })}
        {(carrierFilter || serviceFilter) && !routeFocus && (
          <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setParam({ carrier: '', service: '' })}>
            Effacer les filtres
          </button>
        )}
        {carrierFilter && !routeFocus && (
          <Link to={`/carriers/${encodeURIComponent(carrierFilter)}?tab=routes`} className="btn btn-tertiary btn-sm">
            <IconExternal /> Routes de {carrierName(carrierFilter)}
          </Link>
        )}
      </div>

      {filter === 'all' && !legFiltered && visibleLegs.length > 300 && (
        <Alert kind="warning" className="mb-l" title="Vue complète">
          Le réseau complet est dense. Filtrer par région, par nœud ou par transporteur pour une lecture plus claire.
        </Alert>
      )}

      <div className="grid gap-l 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="card relative overflow-hidden" style={{ height: 'min(72vh, 760px)', minHeight: 420 }} data-testid="network-graph">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            onNodeClick={(_, n) => {
              setSelectedLeg(null);
              setSelectedNode(n.id);
            }}
            onPaneClick={() => {
              setSelectedNode(null);
              setSelectedLeg(null);
            }}
            minZoom={0.1}
            maxZoom={2}
            fitView
            proOptions={{ hideAttribution: false }}
            nodesConnectable
            elementsSelectable
          >
            <Background color="#e5e5e5" gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => NODE_COLORS[(n.data as NetNodeData).kind] ?? '#515b60'} maskColor="rgba(250,250,250,0.7)" style={{ border: '1px solid #e5e5e5', borderRadius: 5 }} />
          </ReactFlow>
          {layout === 'type' && (
            <div className="pointer-events-none absolute left-l top-m flex flex-wrap gap-m">
              {COLUMN_ORDER.map((c) => (
                <span key={c} className="flex items-center gap-s rounded-l bg-white/90 px-m py-xs text-2xs text-neutral-700">
                  <Dot color={NODE_COLORS[c]} size={8} /> {COLUMN_LABEL[c]}
                </span>
              ))}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-m left-1/2 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-l bg-white/90 px-m py-xs text-center text-2xs text-neutral-500">
            {building ? 'Cliquer sur les legs dans l’ordre pour composer l’itinéraire' : 'Cliquer un leg pour voir son transporteur et ses routes · glisser d’un nœud à un autre pour créer une route transporteur'}
          </div>
          {selLeg && !building && (
            <LegDetail
              leg={selLeg}
              color={carrierColor(selLeg.carrierId)}
              nodeName={nodeName}
              carrierName={carrierName}
              serviceName={(id) => serviceById.get(id)?.name ?? id}
              routeById={carrierRouteById}
              zoneName={zoneName}
              onClose={() => setSelectedLeg(null)}
              onFocusRoute={(id) => {
                setSelectedLeg(null);
                setParam({ carrierRoute: id });
              }}
              onEdit={() => editStored(selLeg)}
            />
          )}
          {sel && !selLeg && (
            <div className="popover absolute right-m top-m w-[260px] max-w-[calc(100%-24px)] p-l text-s">
              <div className="mb-s flex items-start justify-between gap-m">
                <div className="min-w-0">
                  <div className="truncate font-medium">{sel.name}</div>
                  <div className="text-xs text-neutral-500">
                    {sel.id === 'CUSTOMER' ? 'Nœud client' : `${sel.id} · ${STOCK_POINT_TYPE_LABEL[sel.kind]} · ${sel.city}`}
                  </div>
                </div>
                <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => setSelectedNode(null)} aria-label="Fermer">
                  <IconClose />
                </button>
              </div>
              {sel.id !== 'CUSTOMER' && (
                <>
                  <div className="mb-m text-xs text-neutral-700">
                    {liveLegs.filter((l) => l.from === sel.id).length} legs sortants · {liveLegs.filter((l) => l.to === sel.id).length} entrants
                    {sel.isHub && ' · hub'}
                    {sel.consolidation && ' · consolidation'}
                  </div>
                  <button
                    className="btn btn-secondary btn-sm w-full"
                    onClick={() => {
                      setParam({ carrierRoute: '' });
                      setFocus(sel.id);
                      setFilter('node');
                      setSelectedNode(null);
                    }}
                  >
                    Afficher ce nœud et ses voisins
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-l">
          {building && (
            <RouteBuilder
              legIds={routeLegs}
              setLegIds={setRouteLegs}
              legById={legById}
              nodeName={nodeName}
              crud={routeCrud}
              onDone={() => {
                setBuilding(false);
                setRouteLegs([]);
              }}
            />
          )}
          <LegsList legs={visibleLegs} nodeName={nodeName} carrierName={carrierName} carrierColor={carrierColor} selected={building ? null : selectedLeg} onPick={revealLeg} building={building} />
          <RoutesList routes={all.routes} legById={legById} nodeName={nodeName} crud={routeCrud} onHighlight={setHighlight} highlight={highlight} />
          <ReachablePanel nodes={all.nodes} nodeName={nodeName} onHighlight={setHighlight} highlight={highlight} />
          <StoredLegs legs={storedLegs} nodeName={nodeName} onEdit={editStored} />
        </div>
      </div>

      <NewCarrierRouteModal
        state={newRoute}
        onClose={() => setNewRoute(null)}
        carriers={usedCarriers.length ? usedCarriers : carrierIds}
        carrierName={carrierName}
        defaultCarrier={carrierFilter}
        nodeName={nodeName}
        onCreate={(c) => navigate(`/carriers/${encodeURIComponent(c)}/routes/new`)}
      />
      <LegDrawer
        state={legEdit}
        onClose={() => setLegEdit(null)}
        onSave={saveLeg}
        onDelete={deleteLeg}
        saving={legs.create.isPending || legs.update.isPending}
        deleting={legs.remove.isPending}
        error={legEdit?.isNew ? legs.create.error : legs.update.error}
        nodeName={nodeName}
      />
      <HubDrawer
        state={hubEdit}
        onClose={() => setHubEdit(null)}
        crud={hubCrud}
        onSaved={(h) => {
          qc.invalidateQueries({ queryKey: qk.graph });
          setFocus(h.id);
          setFilter('node');
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Detail of a compiled leg: carrier, service, departures, transit and the carrier routes it comes from. */
function LegDetail({
  leg,
  color,
  nodeName,
  carrierName,
  serviceName,
  routeById,
  zoneName,
  onClose,
  onFocusRoute,
  onEdit,
}: {
  leg: GraphLeg;
  color: string;
  nodeName: (id: string) => string;
  carrierName: (id: string) => string;
  serviceName: (id: string) => string;
  routeById: Map<string, CarrierRoute>;
  zoneName: (id: string) => string;
  onClose: () => void;
  onFocusRoute: (id: string) => void;
  onEdit: () => void;
}) {
  const ids = leg.carrierRouteIds ?? [];
  const routes = ids.map((id) => routeById.get(id)).filter(Boolean) as CarrierRoute[];
  const transit = transitLabel(routes) || (leg.transitMinutes ? fmtHours(Math.round(leg.transitMinutes / 60)) : '');
  const destZones = leg.to === 'CUSTOMER' ? [...new Set(routes.map((r) => r.destinationZoneId))] : [];
  const row = (k: string, v: ReactNode) => (
    <div className="flex gap-m py-xs">
      <dt className="w-[96px] flex-none text-neutral-500">{k}</dt>
      <dd className="m-0 min-w-0 flex-1 break-words text-neutral-800">{v}</dd>
    </div>
  );
  return (
    <div className="popover absolute right-m top-m z-10 flex max-h-[calc(100%-24px)] w-[340px] max-w-[calc(100%-24px)] flex-col text-s" data-testid="network-leg-detail">
      <div className="flex items-start justify-between gap-m border-b border-border px-l py-m">
        <div className="min-w-0">
          <div className="font-medium">
            {nodeName(leg.from)} → {nodeName(leg.to)}
          </div>
          <div className="break-all text-2xs text-neutral-500">{leg.id}</div>
        </div>
        <button className="btn btn-tertiary btn-sm btn-icon" onClick={onClose} aria-label="Fermer">
          <IconClose />
        </button>
      </div>
      <div className="overflow-y-auto px-l py-m">
        <div className="mb-s flex flex-wrap gap-s">
          {leg.generated ? <Badge color="primary">Généré depuis les routes transporteur</Badge> : <Badge color="grey">Leg stocké</Badge>}
          {leg.inUse === false && <Badge color="orange">Remplacé par les routes</Badge>}
          {!leg.active && <Badge color="grey">Inactif</Badge>}
        </div>
        <dl className="m-0 text-xs">
          {row(
            'Transporteur',
            <Link to={`/carriers/${encodeURIComponent(leg.carrierId)}?tab=routes`} className="inline-flex items-center gap-s text-primary-1000 hover:underline">
              <span className="inline-block h-[3px] w-[14px] rounded-s" style={{ background: color }} />
              {carrierName(leg.carrierId)}
            </Link>,
          )}
          {row('Service', `${serviceName(leg.serviceId)} (${leg.serviceId})`)}
          {row('Trajet', `${leg.from} → ${leg.to === 'CUSTOMER' ? 'Client' : leg.to}`)}
          {row('Départs', leg.departures?.length ? leg.departures.join(', ') : 'Selon le planning du service')}
          {transit && row('Transit', transit)}
          {destZones.length > 0 && row('Zones livrées', destZones.map(zoneName).join(', '))}
        </dl>
        {leg.generated || ids.length ? (
          <div className="mt-m">
            <div className="mb-s text-xs font-medium text-neutral-800">Configurer dans Transporteurs</div>
            {ids.length === 0 ? (
              <div className="text-xs text-neutral-500">Aucune route transporteur associée.</div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-s p-0">
                {ids.map((rid) => {
                  const r = routeById.get(rid);
                  return (
                    <li key={rid} className="flex items-center gap-s rounded-m border border-border px-m py-s">
                      <Link to={`/carriers/${encodeURIComponent(r?.carrierId ?? leg.carrierId)}/routes/${encodeURIComponent(rid)}`} className="min-w-0 flex-1 text-xs" data-testid="network-leg-route-link">
                        <span className="flex items-center gap-xs font-medium text-primary-1000 hover:underline">
                          <IconExternal size={14} /> <span className="truncate">{r?.name || rid}</span>
                        </span>
                        {r && (
                          <span className="block truncate text-neutral-500">
                            {zoneName(r.originZoneId)} → {zoneName(r.destinationZoneId)}
                            {transitLabel([r]) ? ` · ${transitLabel([r])}` : ''}
                            {!r.active ? ' · inactive' : ''}
                          </span>
                        )}
                      </Link>
                      <button className="btn btn-tertiary btn-sm btn-icon flex-none" title="Afficher tous les legs de cette route" aria-label="Afficher tous les legs de cette route" onClick={() => onFocusRoute(rid)}>
                        <IconFilter />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
        {!leg.generated && (
          <div className="mt-m flex flex-col gap-s">
            <div className="text-xs text-neutral-500">{leg.inUse === false ? 'Ce leg stocké est remplacé par les legs générés depuis les routes transporteur.' : 'Leg saisi manuellement (mode avancé).'}</div>
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>
              <IconEdit /> Modifier le leg stocké
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LegsList({ legs, nodeName, carrierName, carrierColor, selected, onPick, building }: { legs: GraphLeg[]; nodeName: (id: string) => string; carrierName: (id: string) => string; carrierColor: (id: string) => string; selected: string | null; onPick: (id: string) => void; building: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q).toLowerCase();
  const [shown, setShown] = useState(30);
  const list = useMemo(
    () =>
      legs
        .filter((l) => !dq || `${l.id} ${l.from} ${l.to} ${nodeName(l.from)} ${nodeName(l.to)} ${l.carrierId} ${l.serviceId} ${(l.carrierRouteIds ?? []).join(' ')}`.toLowerCase().includes(dq))
        .sort((a, b) => a.carrierId.localeCompare(b.carrierId) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    [legs, dq, nodeName],
  );
  return (
    <Card title={`Legs affichés (${legs.length})`} icon={<IconTruck size={20} />} bodyClassName="">
      <div className="border-b border-border px-xl py-m">
        <SearchInput className="w-full" value={q} onChange={setQ} placeholder="Nœud, transporteur, route…" />
        <div className="mt-s text-2xs text-neutral-500">{building ? 'Cliquer un leg pour l’ajouter à l’itinéraire.' : 'Legs générés depuis les routes transporteur (lecture seule). Cliquer un leg pour voir ses routes.'}</div>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Aucun leg" />
      ) : (
        <div className="max-h-[420px] overflow-y-auto" data-testid="network-legs-list">
          {list.slice(0, shown).map((l) => (
            <button key={l.id} type="button" className={cx('block w-full border-t border-border px-xl py-s text-left text-xs first:border-t-0 hover:bg-neutral-30', selected === l.id && 'bg-primary-tint')} onClick={() => onPick(l.id)}>
              <div className="flex items-center gap-s">
                <span className="inline-block h-[3px] w-[14px] flex-none rounded-s" style={{ background: carrierColor(l.carrierId) }} />
                <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">
                  {nodeName(l.from)} → {nodeName(l.to)}
                </span>
                {!l.generated && <Badge color="grey">stocké</Badge>}
              </div>
              <div className="mt-xs truncate pl-[20px] text-neutral-500">
                {carrierName(l.carrierId)} · {l.serviceId}
                {l.departures?.length ? ` · départ ${l.departures.join(', ')}` : ''}
                {l.carrierRouteIds?.length ? ` · ${l.carrierRouteIds.length} route${l.carrierRouteIds.length > 1 ? 's' : ''}` : ''}
              </div>
            </button>
          ))}
          {list.length > shown && (
            <div className="border-t border-border p-m text-center">
              <button className="btn btn-tertiary btn-sm" onClick={() => setShown((s) => s + 60)}>
                Afficher plus ({list.length - shown} restants)
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Stored legs (advanced): the reference dataset has none; any left are shown here with their form. */
function StoredLegs({ legs, nodeName, onEdit }: { legs: GraphLeg[]; nodeName: (id: string) => string; onEdit: (l: Leg) => void }) {
  return (
    <details className="card group" data-testid="network-stored-legs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-m px-xl py-l">
        <span className="text-s font-medium text-neutral-800">Legs stockés (avancé) · {legs.length}</span>
        <span className="text-xs text-neutral-500 group-open:hidden">Afficher</span>
        <span className="hidden text-xs text-neutral-500 group-open:inline">Masquer</span>
      </summary>
      <div className="border-t border-border">
        {legs.length === 0 ? (
          <div className="px-xl py-l text-xs text-neutral-500">Aucun leg stocké : tout le réseau est généré depuis les routes transporteur.</div>
        ) : (
          <>
            <div className="px-xl pt-m text-xs text-neutral-500">Legs saisis manuellement. Ceux couverts par une route transporteur sont remplacés par les legs générés.</div>
            {legs.map((l) => (
              <div key={l.id} className="flex items-center gap-m border-t border-border px-xl py-s text-xs first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {nodeName(l.from)} → {nodeName(l.to)}
                  </div>
                  <div className="truncate text-neutral-500">
                    {l.id} · {l.carrierId} · {l.serviceId}
                  </div>
                </div>
                {l.inUse === false ? <Badge color="orange">Remplacé par les routes</Badge> : <Badge color="green">Utilisé</Badge>}
                <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => onEdit(l)} aria-label={`Modifier ${l.id}`}>
                  <IconEdit />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </details>
  );
}

function NewCarrierRouteModal({ state, onClose, carriers, carrierName, defaultCarrier, nodeName, onCreate }: { state: { from?: string; to?: string } | null; onClose: () => void; carriers: string[]; carrierName: (id: string) => string; defaultCarrier: string; nodeName: (id: string) => string; onCreate: (carrierId: string) => void }) {
  const [carrier, setCarrier] = useState('');
  useEffect(() => {
    if (state) setCarrier(defaultCarrier || carriers[0] || '');
  }, [state, defaultCarrier, carriers]);
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title="Nouvelle route transporteur"
      footer={
        <>
          <Link to="/carriers" className="btn btn-secondary">
            Ouvrir les transporteurs
          </Link>
          <button className="btn btn-primary" disabled={!carrier} onClick={() => onCreate(carrier)}>
            <IconPlus /> Créer la route
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        <p className="m-0 text-s text-neutral-700">Les legs du réseau sont générés depuis les routes des transporteurs : une route relie une zone d’origine (ses sites d’expédition) à une zone de destination, avec son planning, son transit et ses coûts.</p>
        {state?.from && state.to && (
          <Alert kind="info">
            Pour relier <b>{nodeName(state.from)}</b> à <b>{nodeName(state.to)}</b>, créer une route dont la zone d’origine contient {state.from}
            {state.to === 'CUSTOMER' ? ' et dont la zone de destination couvre les clients visés.' : ` vers ${state.to}.`}
          </Alert>
        )}
        <Field label="Transporteur">
          <select className="select" value={carrier} onChange={(e) => setCarrier(e.target.value)} data-testid="new-route-carrier">
            {carriers.map((c) => (
              <option key={c} value={c}>
                {carrierName(c)} ({c})
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function RouteBuilder({ legIds, setLegIds, legById, nodeName, crud, onDone }: { legIds: string[]; setLegIds: (l: string[]) => void; legById: Map<string, GraphLeg>; nodeName: (id: string) => string; crud: ReturnType<typeof useCrud<Route>>; onDone: () => void }) {
  const toast = useToast();
  const modes = useModes();
  const [id, setId] = useState(() => `ROUTE-${Date.now().toString().slice(-5)}`);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [routeModes, setRouteModes] = useState<string[]>([]);
  const fe = crud.create.error instanceof ApiError ? crud.create.error : null;
  const chain = legIds.map((lid) => legById.get(lid)).filter(Boolean) as Leg[];
  return (
    <Card title="Nouvel itinéraire multi-étapes" icon={<IconRoute size={20} />}>
      <div className="flex flex-col gap-l">
        <Alert kind="info">Cliquer les legs dans le graphe ou dans la liste, de l'origine vers le client. Le dernier leg doit aboutir au client. Les legs sont ceux générés depuis les routes transporteur.</Alert>
        {chain.length === 0 ? (
          <div className="text-xs text-neutral-500">Aucun leg sélectionné.</div>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-s p-0">
            {chain.map((l, i) => (
              <li key={i} className="flex items-center gap-m rounded-m border border-border px-m py-s text-xs">
                <span className="w-[16px] text-neutral-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{nodeName(l.from)}</span> → <span className="font-medium">{nodeName(l.to)}</span>
                  <span className="text-neutral-500"> · {l.carrierId} · {l.id}</span>
                </span>
                <button className="btn btn-tertiary-red btn-sm btn-icon" onClick={() => setLegIds(legIds.filter((_, j) => j !== i))} aria-label="Retirer">
                  <IconTrash />
                </button>
              </li>
            ))}
          </ol>
        )}
        {crud.create.error ? <ErrorAlert error={crud.create.error} title="Itinéraire refusé par l'API" /> : null}
        <div className="grid gap-m sm:grid-cols-2">
          <Field label="Identifiant" error={fe?.byField.id}>
            <input className="input" value={id} onChange={(e) => setId(e.target.value)} />
          </Field>
          <Field label="Nom" error={fe?.byField.name}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Magasin → hub → client" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Modes" className="sm:col-span-2">
            <ChipSelect options={(modes.data?.items ?? []).map((m) => m.id)} value={routeModes} onChange={setRouteModes} />
          </Field>
        </div>
        <div className="flex justify-end gap-m">
          <button className="btn btn-secondary" onClick={onDone}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={crud.create.isPending}
            onClick={() =>
              crud.create.mutate(
                { id, name, description: description || undefined, legIds, modes: routeModes.length ? routeModes : undefined, active: true },
                {
                  onSuccess: () => {
                    toast('Itinéraire créé');
                    onDone();
                  },
                },
              )
            }
          >
            {crud.create.isPending && <Spinner size={16} className="text-white" />}
            Créer l'itinéraire
          </button>
        </div>
      </div>
    </Card>
  );
}

function ReachablePanel({ nodes, nodeName, onHighlight, highlight }: { nodes: GraphNode[]; nodeName: (id: string) => string; onHighlight: (h: Highlight) => void; highlight: Highlight }) {
  const modes = useModes();
  const [pc, setPc] = useState('69003');
  const [mode, setMode] = useState('EXPRESS');
  const [origin, setOrigin] = useState('');
  const [params, setParams] = useState<{ postalCode: string; mode: string; origin?: string } | null>(null);
  const res = useCompiledRoutes(params);
  const [shown, setShown] = useState(20);
  const isOn = (p: CompiledPath) => highlight?.legs.join() === p.legs.join();
  return (
    <Card title="Chemins possibles vers une zone" icon={<IconSearch size={20} />} bodyClassName="">
      <form
        className="grid gap-m border-b border-border px-xl py-l sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setShown(20);
          setParams({ postalCode: pc.trim(), mode, origin: origin || undefined });
        }}
      >
        <Field label="Code postal" error={res.error instanceof ApiError ? res.error.byField.postalCode : undefined}>
          <input className="input" value={pc} onChange={(e) => setPc(e.target.value)} maxLength={5} />
        </Field>
        <Field label="Mode" error={res.error instanceof ApiError ? res.error.byField.mode : undefined}>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
            {(modes.data?.items ?? []).map((m) => (
              <option key={m.id}>{m.id}</option>
            ))}
          </select>
        </Field>
        <Field label="Origine (facultatif)" className="sm:col-span-2">
          <select className="select" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">Toutes les origines</option>
            {[...nodes]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id} · {n.name}
                </option>
              ))}
          </select>
        </Field>
        <div className="flex justify-end gap-m sm:col-span-2">
          {highlight && (
            <button type="button" className="btn btn-tertiary" onClick={() => onHighlight(null)}>
              Effacer la sélection
            </button>
          )}
          <button className="btn btn-primary" type="submit">
            {res.isFetching ? <Spinner size={16} className="text-white" /> : <IconSearch />}
            Rechercher
          </button>
        </div>
      </form>
      {res.error && !(res.error instanceof ApiError && res.error.fieldErrors.length) ? (
        <div className="p-l">
          <ErrorAlert error={res.error} />
        </div>
      ) : null}
      {res.data && (
        <div>
          <div className="px-xl py-m text-xs text-neutral-500">
            {res.data.count} chemins vers le département {res.data.department} en {res.data.mode}
          </div>
          {res.data.paths.length === 0 ? (
            <EmptyState title="Aucun chemin" />
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {res.data.paths.slice(0, shown).map((p, i) => (
                <button
                  key={i}
                  className={cx('block w-full border-t border-border px-xl py-m text-left text-xs hover:bg-neutral-30', isOn(p) && 'bg-primary-tint')}
                  onClick={() => onHighlight(isOn(p) ? null : { legs: p.legs, nodes: p.nodes })}
                >
                  <div className="flex flex-wrap items-center gap-xs">
                    {p.nodes.map((n, j) => (
                      <span key={j} className="flex items-center gap-xs">
                        {j > 0 && (
                          <span className="text-neutral-500">
                            → <span className="text-2xs">{p.carriers[j - 1]}</span> →
                          </span>
                        )}
                        <span className="font-medium text-neutral-800">{n === 'CUSTOMER' ? 'Client' : n}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-xs flex flex-wrap gap-s text-neutral-500">
                    <span>{nodeName(p.origin)}</span>
                    <span>· {p.legs.length} legs</span>
                    {p.hubs.length > 0 && <span>· via {p.hubs.join(', ')}</span>}
                    {p.routeId && <Badge color="primary">Itinéraire {p.routeId}</Badge>}
                  </div>
                </button>
              ))}
              {res.data.paths.length > shown && (
                <div className="border-t border-border p-m text-center">
                  <button className="btn btn-tertiary btn-sm" onClick={() => setShown((s) => s + 40)}>
                    Afficher plus ({res.data.paths.length - shown} restants)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RoutesList({ routes, legById, nodeName, crud, onHighlight, highlight }: { routes: Route[]; legById: Map<string, GraphLeg>; nodeName: (id: string) => string; crud: ReturnType<typeof useCrud<Route>>; onHighlight: (h: Highlight) => void; highlight: Highlight }) {
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: (r: Route) => api.put<Route>(`/routes/${encodeURIComponent(r.id)}`, r),
    onSuccess: () => toast('Enregistré'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const qc = useQueryClient();
  useEffect(() => {
    if (toggle.isSuccess) qc.invalidateQueries({ queryKey: qk.graph });
  }, [toggle.isSuccess, qc]);
  return (
    <Card title={`Itinéraires multi-étapes (${routes.length})`} icon={<IconHub size={20} />} bodyClassName="">
      {routes.length === 0 ? (
        <EmptyState title="Aucun itinéraire multi-étapes" />
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          {routes.map((r) => {
            const chain = r.legIds.map((id) => legById.get(id));
            const nodes = chain.length ? [chain[0]?.from ?? '?', ...chain.map((l) => l?.to ?? '?')] : [];
            const on = highlight?.legs.join() === r.legIds.join();
            return (
              <div key={r.id} className={cx('border-t border-border px-xl py-m first:border-t-0', on && 'bg-primary-tint')}>
                <div className="flex items-start justify-between gap-m">
                  <button className="min-w-0 text-left" onClick={() => onHighlight(on ? null : { legs: r.legIds, nodes })}>
                    <div className="truncate text-s font-medium">{r.name}</div>
                    <div className="text-xs text-neutral-500">
                      {r.id} · {r.legIds.length} legs {(r.modes ?? []).length ? `· ${r.modes!.join(', ')}` : ''}
                    </div>
                    <div className="mt-xs text-xs text-neutral-700">{nodes.map((n) => (n === 'CUSTOMER' ? 'Client' : nodeName(n))).join(' → ')}</div>
                    {chain.some((l) => !l) && <Badge color="red" className="mt-xs">Legs introuvables : {r.legIds.filter((id) => !legById.has(id)).join(', ')}</Badge>}
                  </button>
                  <div className="flex flex-none items-center gap-s">
                    <Switch checked={r.active} onChange={(b) => toggle.mutate({ ...r, active: b })} />
                    <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(r.id, { onSuccess: () => toast('Itinéraire supprimé'), onError: (e) => toast(errorMessage(e), 'error') })} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
