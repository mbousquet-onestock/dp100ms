import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { qk, useCompiledRoutes, useCrud, useGraph, useModes } from '../api/hooks';
import type { CompiledPath, GraphNode, Hub, Leg, Route } from '../api/types';
import { IconClose, IconHub, IconPlus, IconRoute, IconSearch, IconTrash } from '../components/Icons';
import { LegDrawer, newLeg } from '../components/LegForm';
import { Alert, Badge, Card, ChipSelect, ConfirmButton, cx, Dot, EmptyState, ErrorAlert, Field, Loading, PageHeader, SearchInput, Spinner, Switch, useDebounced, useToast } from '../components/ui';
import { REGIONS, regionOf } from '../lib/departments';
import { NODE_COLORS, STOCK_POINT_TYPE_LABEL } from '../lib/labels';
import { emptyHub, HubDrawer } from './Hubs';

type NetNodeData = { label: string; id: string; kind: string; city: string; active: boolean; consolidation: boolean; dim: boolean; highlight: boolean };
type NetNode = Node<NetNodeData, 'net'>;

const COLUMN_ORDER = ['STORE', 'WAREHOUSE', 'HUB', 'LAST_MILE_HUB', 'CUSTOMER'];
const COLUMN_LABEL: Record<string, string> = { STORE: 'Magasins', WAREHOUSE: 'Entrepôts', HUB: 'Plateformes régionales', LAST_MILE_HUB: 'Hubs dernier kilomètre', CUSTOMER: 'Client' };
const CUSTOMER: GraphNode = { id: 'CUSTOMER', name: 'Client', kind: 'STORE', city: 'Adresse de livraison', lat: 0, lon: 0, active: true, isHub: false, consolidation: false };

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

function NetworkEditor() {
  const graph = useGraph();
  const qc = useQueryClient();
  const toast = useToast();
  const legs = useCrud<Leg>('legs', [qk.graph]);
  const hubCrud = useCrud<Hub>('hubs', [qk.hubs, qk.graph]);
  const routeCrud = useCrud<Route>('routes', [qk.graph]);
  const rf = useReactFlow();

  const [filter, setFilter] = useState<FilterMode>('region');
  const [region, setRegion] = useState('Auvergne-Rhône-Alpes');
  const [focus, setFocus] = useState('HUB-RHONE');
  const [search, setSearch] = useState('');
  const dsearch = useDebounced(search);
  const [withNeighbors, setWithNeighbors] = useState(false);
  const [showCustomerLegs, setShowCustomerLegs] = useState(true);
  const [layout, setLayout] = useState<'type' | 'geo'>('type');
  const [legEdit, setLegEdit] = useState<{ leg: Leg; isNew: boolean } | null>(null);
  const [hubEdit, setHubEdit] = useState<{ v: Hub; isNew: boolean } | null>(null);
  const [building, setBuilding] = useState(false);
  const [routeLegs, setRouteLegs] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<{ legs: string[]; nodes: string[] } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const all = graph.data;
  const byId = useMemo(() => {
    const m = new Map<string, GraphNode>((all?.nodes ?? []).map((n) => [n.id, n]));
    m.set('CUSTOMER', CUSTOMER);
    return m;
  }, [all]);
  const legById = useMemo(() => new Map((all?.legs ?? []).map((l) => [l.id, l])), [all]);
  const regionById = useMemo(() => new Map((all?.nodes ?? []).map((n) => [n.id, regionOf(n.lat, n.lon)])), [all]);
  const nodeName = useCallback((id: string) => (id === 'CUSTOMER' ? 'Client' : byId.get(id)?.name ?? id), [byId]);

  // ---------------------------------------------------------------- visible set
  const visibleIds = useMemo(() => {
    if (!all) return new Set<string>();
    const base = new Set<string>();
    const q = dsearch.toLowerCase();
    for (const n of all.nodes) {
      if (filter === 'region' && regionById.get(n.id) !== region) continue;
      if (filter === 'node' && n.id !== focus) continue;
      if (q && !`${n.id} ${n.name} ${n.city}`.toLowerCase().includes(q)) continue;
      base.add(n.id);
    }
    const out = new Set(base);
    if (filter === 'node' || withNeighbors) {
      for (const l of all.legs) {
        if (l.to === 'CUSTOMER') continue;
        if (base.has(l.from)) out.add(l.to);
        if (base.has(l.to) && (filter === 'node' || withNeighbors)) out.add(l.from);
      }
    }
    highlight?.nodes.forEach((id) => out.add(id));
    routeLegs.forEach((id) => {
      const l = legById.get(id);
      if (l) {
        out.add(l.from);
        out.add(l.to);
      }
    });
    if (showCustomerLegs || highlight?.nodes.includes('CUSTOMER')) out.add('CUSTOMER');
    return out;
  }, [all, filter, region, focus, dsearch, withNeighbors, regionById, highlight, routeLegs, legById, showCustomerLegs]);

  const visibleLegs = useMemo(() => {
    if (!all) return [];
    return all.legs.filter((l) => visibleIds.has(l.from) && visibleIds.has(l.to) && (l.to !== 'CUSTOMER' || showCustomerLegs || highlight?.legs.includes(l.id) || routeLegs.includes(l.id)));
  }, [all, visibleIds, showCustomerLegs, highlight, routeLegs]);

  // ---------------------------------------------------------------- layout
  const computedNodes = useMemo<NetNode[]>(() => {
    const ids = [...visibleIds];
    const hl = new Set([...(highlight?.nodes ?? []), ...routeLegs.flatMap((id) => (legById.get(id) ? [legById.get(id)!.from, legById.get(id)!.to] : []))]);
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
  }, [visibleIds, layout, byId, regionById, highlight, routeLegs, legById]);

  const [nodes, setNodes, onNodesChange] = useNodesState<NetNode>([]);
  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes, setNodes]);
  const layoutKey = `${filter}|${region}|${focus}|${dsearch}|${layout}|${withNeighbors}|${showCustomerLegs}`;
  useEffect(() => {
    const t = window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 0 }), 60);
    return () => window.clearTimeout(t);
  }, [layoutKey, rf, graph.dataUpdatedAt]);

  const edges = useMemo<Edge[]>(() => {
    const hl = new Set([...(highlight?.legs ?? []), ...routeLegs]);
    const dimOthers = hl.size > 0;
    const showLabels = visibleLegs.length <= 70;
    return visibleLegs.map((l) => {
      const on = hl.has(l.id);
      const color = on ? '#24bdb0' : l.to === 'CUSTOMER' ? '#b2b2b2' : '#515b60';
      return {
        id: l.id,
        source: l.from,
        target: l.to,
        label: showLabels || on ? l.carrierId : undefined,
        labelStyle: { fontSize: 10, fill: on ? '#24bdb0' : '#7f7f7f' },
        labelBgStyle: { fill: '#fff' },
        style: { stroke: color, strokeWidth: on ? 2.5 : 1, opacity: dimOthers && !on ? 0.15 : l.active ? 0.9 : 0.4, strokeDasharray: l.active ? undefined : '4 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        zIndex: on ? 10 : 0,
      };
    });
  }, [visibleLegs, highlight, routeLegs]);

  // ---------------------------------------------------------------- handlers
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    setLegEdit({ leg: newLeg(c.source, c.target), isNew: true });
  }, []);
  const onEdgeClick = useCallback(
    (_: unknown, e: Edge) => {
      const l = legById.get(e.id);
      if (!l) return;
      if (building) {
        setRouteLegs((r) => [...r, l.id]);
        return;
      }
      legs.create.reset();
      legs.update.reset();
      setLegEdit({ leg: l, isNew: false });
    },
    [legById, building, legs.create, legs.update],
  );

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
      },
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const regionNames = Object.keys(REGIONS);
  const sel = selectedNode ? byId.get(selectedNode) : null;

  if (graph.isLoading) return <Loading />;
  if (graph.error || !all) return <ErrorAlert error={graph.error} title="Réseau indisponible" />;

  return (
    <div>
      <PageHeader
        title="Routes et réseau"
        subtitle={`${all.nodes.length} nœuds · ${all.legs.length} legs · ${all.routes.length} routes explicites`}
        actions={
          <>
            <button
              className={cx('btn', building ? 'btn-primary' : 'btn-secondary')}
              onClick={() => {
                setBuilding((b) => !b);
                setRouteLegs([]);
              }}
              aria-pressed={building}
            >
              <IconRoute /> {building ? 'Construction de route active' : 'Construire une route'}
            </button>
            <button className="btn btn-primary" onClick={() => setHubEdit({ v: emptyHub(), isNew: true })}>
              <IconPlus /> Créer un hub
            </button>
          </>
        }
      />

      {/* Toolbar */}
      <div className="card mb-l flex flex-wrap items-end gap-l px-l py-m">
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
            <select className="select w-[230px]" value={region} onChange={(e) => setRegion(e.target.value)}>
              {regionNames.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        )}
        {filter === 'node' && (
          <Field label="Nœud">
            <select className="select w-[260px]" value={focus} onChange={(e) => setFocus(e.target.value)}>
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
        <Field label="Ville ou nœud">
          <SearchInput className="w-[200px]" value={search} onChange={setSearch} placeholder="Lyon, HUB-, STORE-021" />
        </Field>
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
        <div className="flex flex-col gap-s pb-s">
          {filter !== 'node' && <Switch checked={withNeighbors} onChange={setWithNeighbors} label="Inclure les voisins" />}
          <Switch checked={showCustomerLegs} onChange={setShowCustomerLegs} label="Legs vers le client" />
        </div>
        <div className="ml-auto pb-s text-xs text-neutral-500">
          {visibleIds.size} nœuds · {visibleLegs.length} legs affichés
        </div>
      </div>

      {filter === 'all' && visibleLegs.length > 300 && (
        <Alert kind="warning" className="mb-l" title="Vue complète">
          Le réseau complet est dense. Filtrer par région ou par nœud pour une lecture plus claire.
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
            onNodeClick={(_, n) => setSelectedNode(n.id)}
            onPaneClick={() => setSelectedNode(null)}
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
          <div className="pointer-events-none absolute bottom-m left-1/2 -translate-x-1/2 rounded-l bg-white/90 px-m py-xs text-2xs text-neutral-500">
            {building ? 'Cliquer sur les legs dans l’ordre pour composer la route' : 'Glisser d’un nœud vers un hub ou le client pour créer un leg · cliquer un leg pour le modifier'}
          </div>
          {sel && (
            <div className="popover absolute right-m top-m w-[260px] p-l text-s">
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
                    {all.legs.filter((l) => l.from === sel.id).length} legs sortants · {all.legs.filter((l) => l.to === sel.id).length} entrants
                    {sel.isHub && ' · hub'}
                    {sel.consolidation && ' · consolidation'}
                  </div>
                  <button
                    className="btn btn-secondary btn-sm w-full"
                    onClick={() => {
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
          {building && <RouteBuilder legIds={routeLegs} setLegIds={setRouteLegs} legById={legById} nodeName={nodeName} crud={routeCrud} onDone={() => { setBuilding(false); setRouteLegs([]); }} />}
          <ReachablePanel nodes={all.nodes} nodeName={nodeName} onHighlight={setHighlight} highlight={highlight} />
          <RoutesList routes={all.routes} legById={legById} nodeName={nodeName} crud={routeCrud} onHighlight={setHighlight} highlight={highlight} />
        </div>
      </div>

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

function RouteBuilder({ legIds, setLegIds, legById, nodeName, crud, onDone }: { legIds: string[]; setLegIds: (l: string[]) => void; legById: Map<string, Leg>; nodeName: (id: string) => string; crud: ReturnType<typeof useCrud<Route>>; onDone: () => void }) {
  const toast = useToast();
  const modes = useModes();
  const [id, setId] = useState(() => `ROUTE-${Date.now().toString().slice(-5)}`);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [routeModes, setRouteModes] = useState<string[]>([]);
  const fe = crud.create.error instanceof ApiError ? crud.create.error : null;
  const chain = legIds.map((lid) => legById.get(lid)).filter(Boolean) as Leg[];
  return (
    <Card title="Nouvelle route explicite" icon={<IconRoute size={20} />}>
      <div className="flex flex-col gap-l">
        <Alert kind="info">Cliquer les legs dans le graphe, de l'origine vers le client. Le dernier leg doit aboutir au client.</Alert>
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
        {crud.create.error ? <ErrorAlert error={crud.create.error} title="Route refusée par l'API" /> : null}
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
                    toast('Route créée');
                    onDone();
                  },
                },
              )
            }
          >
            {crud.create.isPending && <Spinner size={16} className="text-white" />}
            Créer la route
          </button>
        </div>
      </div>
    </Card>
  );
}

function ReachablePanel({ nodes, nodeName, onHighlight, highlight }: { nodes: GraphNode[]; nodeName: (id: string) => string; onHighlight: (h: { legs: string[]; nodes: string[] } | null) => void; highlight: { legs: string[]; nodes: string[] } | null }) {
  const modes = useModes();
  const [pc, setPc] = useState('69003');
  const [mode, setMode] = useState('EXPRESS');
  const [origin, setOrigin] = useState('');
  const [params, setParams] = useState<{ postalCode: string; mode: string; origin?: string } | null>(null);
  const res = useCompiledRoutes(params);
  const [shown, setShown] = useState(20);
  const isOn = (p: CompiledPath) => highlight?.legs.join() === p.legs.join();
  return (
    <Card title="Routes possibles vers une zone" icon={<IconSearch size={20} />} bodyClassName="">
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
                    {p.routeId && <Badge color="primary">Route {p.routeId}</Badge>}
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

function RoutesList({ routes, legById, nodeName, crud, onHighlight, highlight }: { routes: Route[]; legById: Map<string, Leg>; nodeName: (id: string) => string; crud: ReturnType<typeof useCrud<Route>>; onHighlight: (h: { legs: string[]; nodes: string[] } | null) => void; highlight: { legs: string[]; nodes: string[] } | null }) {
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
    <Card title={`Routes explicites (${routes.length})`} icon={<IconHub size={20} />} bodyClassName="">
      {routes.length === 0 ? (
        <EmptyState title="Aucune route explicite" />
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
                  </button>
                  <div className="flex flex-none items-center gap-s">
                    <Switch checked={r.active} onChange={(b) => toggle.mutate({ ...r, active: b })} />
                    <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(r.id, { onSuccess: () => toast('Route supprimée'), onError: (e) => toast(errorMessage(e), 'error') })} />
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
