import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { useConnections, usePointStock, usePointSummary, useStockPoint } from '../api/hooks';
import type { Leg, StockLine, StockPoint } from '../api/types';
import { IconBox, IconChevronLeft, IconEdit, IconRoute } from '../components/Icons';
import { StockPointForm } from '../components/StockPointForm';
import { Badge, Card, ConfirmButton, EmptyState, ErrorAlert, Kpi, Loading, PageHeader, Pagination, SearchInput, Spinner, Switch, useDebounced, useToast } from '../components/ui';
import { fmtInt, fmtMoney } from '../lib/format';
import { NODE_BADGE, STOCK_POINT_TYPE_LABEL } from '../lib/labels';

export default function StockPointDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const sp = useStockPoint(id);
  const save = useMutation({
    mutationFn: (v: StockPoint) => api.put<StockPoint>(`/stock-points/${encodeURIComponent(id)}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-points'] });
      qc.invalidateQueries({ queryKey: ['network'] });
      toast('Enregistré');
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/stock-points/${encodeURIComponent(id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-points'] });
      toast('Point de stock supprimé');
      nav('/stock-points');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (sp.isLoading) return <Loading />;
  if (sp.error || !sp.data) return <ErrorAlert error={sp.error} title="Point de stock introuvable" />;
  const p = sp.data;
  return (
    <div>
      <Link to="/stock-points" className="mb-m inline-flex items-center gap-s text-s text-neutral-500 hover:text-neutral-800">
        <IconChevronLeft size={16} /> Points de stock
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-m">
            {p.name} <Badge color={NODE_BADGE[p.type]}>{STOCK_POINT_TYPE_LABEL[p.type]}</Badge>
            {!p.active && <Badge color="grey">Inactif</Badge>}
          </span>
        }
        subtitle={`${p.id} · ${p.address.line1}, ${p.address.postalCode} ${p.address.city}`}
        actions={<ConfirmButton onConfirm={() => del.mutate()} pending={del.isPending} small={false} />}
      />
      <div className="grid gap-l xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-l">
          <Card title="Propriétés" icon={<IconEdit size={20} />}>
            <StockPointForm key={p.id + JSON.stringify(p).length} initial={p} onSubmit={(v) => save.mutate(v)} pending={save.isPending} error={save.error} />
          </Card>
          <ConnectionsCard id={id} />
        </div>
        <div className="flex flex-col gap-l">
          <SummaryCards id={id} />
          <StockCard id={id} safety={p.safetyStock} />
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ id }: { id: string }) {
  const s = usePointSummary(id);
  if (s.isLoading) return <Loading />;
  if (s.error || !s.data) return <ErrorAlert error={s.error} />;
  const d = s.data;
  return (
    <div className="grid grid-cols-2 gap-l sm:grid-cols-3">
      <Kpi value={fmtInt(d.listed)} label="SKU référencés" hint={`sur ${fmtInt(d.lines)} au catalogue`} />
      <Kpi value={fmtInt(d.availableSkus)} label="SKU disponibles" />
      <Kpi value={fmtInt(d.outOfStockSkus)} label="SKU en rupture" accent={d.outOfStockSkus > 0 ? 'var(--orange-1000)' : undefined} />
      <Kpi value={fmtInt(d.totalUnits)} label="Unités physiques" />
      <Kpi value={fmtInt(d.reservedUnits)} label="Unités réservées" />
      <Kpi value={fmtInt(d.totalUnits - d.reservedUnits)} label="Unités disponibles" />
    </div>
  );
}

function StockCard({ id, safety }: { id: string; safety: number }) {
  const [sku, setSku] = useState('');
  const dsku = useDebounced(sku);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const stock = usePointStock(id, { sku: dsku || undefined, onlyAvailable, page, pageSize });
  return (
    <Card
      title="Lignes de stock"
      icon={<IconBox size={20} />}
      actions={stock.data && <Pagination page={page} pageSize={pageSize} total={stock.data.total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />}
      bodyClassName=""
    >
      <div className="flex flex-wrap items-center gap-l border-b border-border px-xl py-l">
        <SearchInput className="w-full sm:w-[260px]" value={sku} onChange={(v) => { setSku(v); setPage(1); }} placeholder="Filtrer par SKU" />
        <Switch checked={onlyAvailable} onChange={(b) => { setOnlyAvailable(b); setPage(1); }} label="Disponible uniquement" />
        <span className="text-xs text-neutral-500">Promettable = disponible − stock de sécurité ({safety})</span>
      </div>
      <div className="overflow-x-auto">
        {stock.isLoading ? (
          <Loading />
        ) : stock.error ? (
          <div className="p-xl">
            <ErrorAlert error={stock.error} />
          </div>
        ) : stock.data?.items.length === 0 ? (
          <EmptyState title="Aucune ligne de stock" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Physique</th>
                <th className="num">Réservé</th>
                <th className="num">Disponible</th>
                <th className="num">Promettable</th>
                <th className="w-[200px]"></th>
              </tr>
            </thead>
            <tbody>
              {stock.data?.items.map((l) => <StockRow key={l.sku} line={l} />)}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function StockRow({ line }: { line: StockLine }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [phys, setPhys] = useState(line.physical);
  const [res, setRes] = useState(line.reserved);
  const save = useMutation({
    mutationFn: () => api.put<StockLine>(`/stock/${encodeURIComponent(line.stockPointId)}/${encodeURIComponent(line.sku)}`, { physical: phys, reserved: res }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-points', 'stock', line.stockPointId] });
      qc.invalidateQueries({ queryKey: ['stock-points', 'summary', line.stockPointId] });
      toast('Enregistré');
      setEdit(false);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (edit)
    return (
      <tr>
        <td className="font-medium">{line.sku}</td>
        <td className="num">
          <input type="number" min={0} className="input h-[30px] w-[80px] text-right" value={phys} onChange={(e) => setPhys(Number(e.target.value))} aria-label="Physique" />
        </td>
        <td className="num">
          <input type="number" min={0} className="input h-[30px] w-[80px] text-right" value={res} onChange={(e) => setRes(Number(e.target.value))} aria-label="Réservé" />
        </td>
        <td className="num text-neutral-500">{Math.max(0, phys - res)}</td>
        <td className="num text-neutral-500">–</td>
        <td className="text-right">
          <span className="inline-flex gap-s">
            <button className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Spinner size={14} className="text-white" />}
              Enregistrer
            </button>
            <button className="btn btn-tertiary btn-sm" onClick={() => { setEdit(false); setPhys(line.physical); setRes(line.reserved); }}>
              Annuler
            </button>
          </span>
        </td>
      </tr>
    );
  return (
    <tr>
      <td className="font-medium">{line.sku}</td>
      <td className="num">{line.physical}</td>
      <td className="num">{line.reserved}</td>
      <td className="num">{line.available}</td>
      <td className="num">{line.promisable > 0 ? <Badge color="green">{line.promisable}</Badge> : <Badge color="grey">0</Badge>}</td>
      <td className="text-right">
        <button className="btn btn-tertiary btn-sm" onClick={() => setEdit(true)}>
          <IconEdit /> Modifier
        </button>
      </td>
    </tr>
  );
}

function ConnectionsCard({ id }: { id: string }) {
  const c = useConnections(id);
  return (
    <Card title="Connexions logistiques" icon={<IconRoute size={20} />} bodyClassName="" actions={<Link to="/network" className="btn btn-secondary btn-sm">Éditeur de routes</Link>}>
      {c.isLoading ? (
        <Loading />
      ) : c.error ? (
        <div className="p-xl">
          <ErrorAlert error={c.error} />
        </div>
      ) : (
        <div>
          <LegTable title={`Legs sortants (${c.data?.outgoing.length ?? 0})`} legs={c.data?.outgoing ?? []} dir="out" />
          <LegTable title={`Legs entrants (${c.data?.incoming.length ?? 0})`} legs={c.data?.incoming ?? []} dir="in" />
        </div>
      )}
    </Card>
  );
}

function LegTable({ title, legs, dir }: { title: string; legs: Leg[]; dir: 'in' | 'out' }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-xl pb-s pt-l text-xs font-medium text-grey-800">{title}</div>
      {legs.length === 0 ? (
        <div className="px-xl pb-l text-xs text-neutral-500">Aucun</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Leg</th>
                <th>{dir === 'out' ? 'Vers' : 'Depuis'}</th>
                <th>Transporteur / service</th>
                <th>Départs</th>
                <th className="num">Surcoût</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((l) => (
                <tr key={l.id}>
                  <td className="text-xs">{l.id}</td>
                  <td className="font-medium">{dir === 'out' ? (l.to === 'CUSTOMER' ? 'Client' : l.to) : l.from}</td>
                  <td className="text-xs">
                    {l.carrierId} · {l.serviceId}
                  </td>
                  <td className="text-xs">{(l.departures ?? []).join(', ')}</td>
                  <td className="num text-xs">{fmtMoney(l.extraCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
