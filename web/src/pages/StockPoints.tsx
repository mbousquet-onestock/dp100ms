import { useMemo, useState } from 'react';
import { CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useGraph, useStockPoints } from '../api/hooks';
import type { GraphNode, StockPoint } from '../api/types';
import { FranceMap } from '../components/FranceMap';
import { IconMap, IconPlus } from '../components/Icons';
import { emptyStockPoint, StockPointForm } from '../components/StockPointForm';
import { Badge, Card, Dot, Drawer, EmptyState, ErrorAlert, Loading, PageHeader, Pagination, SearchInput, Switch, useDebounced, useToast } from '../components/ui';
import { NODE_BADGE, NODE_COLORS, STOCK_POINT_TYPE_LABEL } from '../lib/labels';
import { useMutation } from '@tanstack/react-query';

const KINDS = ['STORE', 'WAREHOUSE', 'LAST_MILE_HUB', 'HUB'] as const;

export default function StockPoints() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [kinds, setKinds] = useState<string[]>([...KINDS]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showLegs, setShowLegs] = useState(false);
  const [creating, setCreating] = useState(false);

  // The table filters by a single type (API); with several chips selected the table shows all types.
  const tableType = kinds.filter((k) => k !== 'HUB').length === 1 ? kinds.find((k) => k !== 'HUB') : undefined;
  const list = useStockPoints({ type: tableType, q: dq, page, pageSize });
  const graph = useGraph();

  const create = useMutation({
    mutationFn: (v: StockPoint) => api.post<StockPoint>('/stock-points', v),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['stock-points'] });
      qc.invalidateQueries({ queryKey: ['network'] });
      toast('Point de stock créé');
      setCreating(false);
      nav(`/stock-points/${encodeURIComponent(v.id)}`);
    },
  });

  const nodes = useMemo(() => {
    const all = graph.data?.nodes ?? [];
    const lq = dq.toLowerCase();
    return all.filter((n) => kinds.includes(n.kind) && (!lq || n.id.toLowerCase().includes(lq) || n.name.toLowerCase().includes(lq) || n.city.toLowerCase().includes(lq)));
  }, [graph.data, kinds, dq]);

  const byId = useMemo(() => new Map((graph.data?.nodes ?? []).map((n) => [n.id, n])), [graph.data]);
  const visible = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const legLines = useMemo(() => {
    if (!showLegs || !graph.data) return [];
    const seen = new Set<string>();
    const out: { key: string; a: GraphNode; b: GraphNode; active: boolean }[] = [];
    for (const l of graph.data.legs) {
      if (l.to === 'CUSTOMER' || !visible.has(l.from) || !visible.has(l.to)) continue;
      const k = `${l.from}>${l.to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (a && b) out.push({ key: k, a, b, active: l.active });
    }
    return out;
  }, [showLegs, graph.data, visible, byId]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of graph.data?.nodes ?? []) m[n.kind] = (m[n.kind] ?? 0) + 1;
    return m;
  }, [graph.data]);

  return (
    <div>
      <PageHeader
        title="Points de stock"
        subtitle="Magasins, entrepôts et hubs du réseau logistique"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus /> Créer un point de stock
          </button>
        }
      />

      <div className="mb-l flex flex-wrap items-center gap-m">
        {KINDS.map((k) => {
          const on = kinds.includes(k);
          return (
            <button
              key={k}
              className="chip"
              aria-pressed={on}
              onClick={() => {
                setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k]);
                setPage(1);
              }}
            >
              <Dot color={NODE_COLORS[k]} size={8} />
              {STOCK_POINT_TYPE_LABEL[k]}
              <span className="text-neutral-500">{counts[k] ?? 0}</span>
            </button>
          );
        })}
        <SearchInput
          className="w-full sm:ml-auto sm:w-[280px]"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Rechercher (id, nom, ville, code postal)"
        />
      </div>

      <Card
        title={`Carte du réseau · ${nodes.length} nœuds`}
        icon={<IconMap size={20} />}
        actions={<Switch checked={showLegs} onChange={setShowLegs} label="Afficher les connexions logistiques" />}
        bodyClassName="p-m"
      >
        {graph.isLoading ? (
          <Loading />
        ) : graph.error ? (
          <ErrorAlert error={graph.error} />
        ) : (
          <FranceMap height={520}>
            {legLines.map((l) => (
              <Polyline key={l.key} positions={[[l.a.lat, l.a.lon], [l.b.lat, l.b.lon]]} pathOptions={{ color: '#18244a', weight: 1, opacity: l.active ? 0.35 : 0.15, dashArray: l.active ? undefined : '4 4' }} />
            ))}
            {nodes.map((n) => (
              <CircleMarker
                key={n.id}
                center={[n.lat, n.lon]}
                radius={n.kind === 'STORE' ? 5 : 8}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor: NODE_COLORS[n.kind], fillOpacity: n.active ? 0.95 : 0.35 }}
                eventHandlers={{ click: () => n.kind !== 'HUB' && nav(`/stock-points/${encodeURIComponent(n.id)}`) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <div className="text-xs">
                    <div className="font-medium">{n.name}</div>
                    <div>
                      {n.id} · {STOCK_POINT_TYPE_LABEL[n.kind]} · {n.city}
                    </div>
                    {n.consolidation && <div>Consolidation possible</div>}
                    {!n.active && <div>Inactif</div>}
                  </div>
                </Tooltip>
                {n.kind === 'HUB' && (
                  <Popup>
                    <div className="text-xs">
                      <div className="font-medium">{n.name}</div>
                      <div>Plateforme régionale · {n.city}</div>
                      <a href="/hubs">Gérer les hubs</a>
                    </div>
                  </Popup>
                )}
              </CircleMarker>
            ))}
          </FranceMap>
        )}
      </Card>

      <Card
        className="mt-l"
        title="Liste des points de stock"
        actions={list.data && <Pagination page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />}
        bodyClassName="overflow-x-auto"
      >
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <div className="p-xl">
            <ErrorAlert error={list.error} />
          </div>
        ) : list.data && list.data.items.length === 0 ? (
          <EmptyState title="Aucun point de stock">Aucun résultat pour ces filtres.</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Identifiant</th>
                <th>Nom</th>
                <th>Type</th>
                <th>Ville</th>
                <th>Horaires</th>
                <th>Cut-off</th>
                <th className="num">Capacité / jour</th>
                <th>Modes</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => nav(`/stock-points/${encodeURIComponent(p.id)}`)}>
                  <td className="font-medium">{p.id}</td>
                  <td>{p.name}</td>
                  <td>
                    <Badge color={NODE_BADGE[p.type]}>{STOCK_POINT_TYPE_LABEL[p.type]}</Badge>
                  </td>
                  <td>
                    {p.address.postalCode} {p.address.city}
                  </td>
                  <td className="whitespace-nowrap">
                    {p.openingTime} – {p.closingTime}
                  </td>
                  <td>{p.cutoff}</td>
                  <td className="num">{p.dailyCapacity}</td>
                  <td className="text-xs text-neutral-700">{(p.allowedModes ?? []).join(', ')}</td>
                  <td>{p.active ? <Badge color="green">Actif</Badge> : <Badge color="grey">Inactif</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Drawer open={creating} onClose={() => setCreating(false)} title="Nouveau point de stock" width={640}>
        <StockPointForm initial={emptyStockPoint()} isNew onSubmit={(v) => create.mutate(v)} pending={create.isPending} error={create.error} submitLabel="Créer" />
      </Drawer>
    </div>
  );
}
