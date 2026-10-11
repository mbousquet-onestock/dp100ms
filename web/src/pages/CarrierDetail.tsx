import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { qk, useCarrierRoutes, useCarriers, useCrud, useServices, useZones } from '../api/hooks';
import type { Carrier, CarrierRoute } from '../api/types';
import { IconChevronDown, IconChevronUp, IconEdit, IconPlus, IconRoute } from '../components/Icons';
import { Alert, Badge, Breadcrumb, ConfirmButton, cx, EmptyState, ErrorAlert, Loading, Pagination, useToast } from '../components/ui';
import { CarrierDrawer, CarrierIcon } from '../components/carrier/CarrierDrawer';
import { CarrierServices } from '../components/carrier/CarrierServices';
import { CarrierSchedules } from '../components/carrier/CarrierSchedules';
import { CarrierRestrictions } from '../components/carrier/CarrierRestrictions';
import { shippingPointsLabel, useZoneShippingPoints } from '../components/route/ShippingPoints';
import { costRange, fmtCostRange, fmtHours, plural } from '../lib/routes';

type Tab = 'routes' | 'services' | 'restrictions' | 'schedules';
const TABS: { value: Tab; label: string }[] = [
  { value: 'routes', label: 'Routes' },
  { value: 'services', label: 'Services' },
  { value: 'restrictions', label: 'Restrictions' },
  { value: 'schedules', label: 'Plannings avancés' },
];

export default function CarrierDetail() {
  const { id = '' } = useParams();
  const carriers = useCarriers();
  const services = useServices(id);
  const routes = useCarrierRoutes({ carrierId: id });
  const crud = useCrud<Carrier>('carriers', [qk.carriers]);
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'routes') as Tab;
  const [edit, setEdit] = useState<{ v: Carrier; isNew: boolean } | null>(null);
  const carrier = carriers.data?.items.find((c) => c.id === id);
  if (carriers.isLoading) return <Loading />;
  if (carriers.error) return <ErrorAlert error={carriers.error} />;
  if (!carrier)
    return (
      <div>
        <Breadcrumb items={[{ label: 'Transporteurs', to: '/carriers' }, { label: id }]} />
        <EmptyState title="Transporteur introuvable">Ce transporteur n'existe pas ou a été supprimé.</EmptyState>
      </div>
    );
  const nServices = services.data?.items.length ?? 0;
  const nRoutes = routes.data?.items.length ?? 0;
  return (
    <div>
      <Breadcrumb items={[{ label: 'Transporteurs', to: '/carriers' }, { label: carrier.name }]} />
      <section className="card mb-xl flex flex-wrap items-center gap-l p-l" data-testid="carrier-header">
        <CarrierIcon carrier={carrier} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-m">
            <span className="text-m font-medium text-neutral-800">{carrier.name}</span>
            <span className="text-xs text-neutral-500">{carrier.id}</span>
            {!carrier.active && <Badge color="grey">Inactif</Badge>}
          </div>
          <div className="text-s text-neutral-700">{plural(nServices, 'service')}</div>
          <div className="text-xs text-neutral-500">{plural(nRoutes, 'route')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-m">
          <Link to={`/network?carrier=${encodeURIComponent(carrier.id)}`} className="btn btn-secondary btn-sm" data-testid="carrier-network-link">
            <IconRoute /> Voir le réseau du transporteur
          </Link>
          <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ v: carrier, isNew: false })}>
            <IconEdit /> Modifier
          </button>
          <ConfirmButton
            confirmLabel="Supprimer le transporteur"
            pending={crud.remove.isPending}
            onConfirm={() =>
              crud.remove.mutate(carrier.id, {
                onSuccess: () => {
                  toast('Transporteur supprimé');
                  navigate('/carriers');
                },
                onError: (e) => toast(errorMessage(e), 'error'),
              })
            }
          />
        </div>
      </section>
      <h2 className="os-title-s mb-m ml-l">Configuration</h2>
      <section className="card p-l sm:p-xl">
        <div className="pill-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('tab', t.value);
                setParams(next, { replace: true });
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="pt-l">
          {tab === 'routes' && <RoutesTab carrier={carrier} routes={routes.data?.items ?? []} loading={routes.isLoading} error={routes.error} />}
          {tab === 'services' && (
            <div className="-mx-l sm:-mx-xl">
              <CarrierServices carrierId={carrier.id} />
            </div>
          )}
          {tab === 'restrictions' && <CarrierRestrictions key={carrier.id} carrier={carrier} routes={routes.data?.items ?? []} />}
          {tab === 'schedules' && (
            <div className="-mx-l sm:-mx-xl">
              <div className="px-l sm:px-xl">
                <Alert kind="info">Les routes sont prioritaires : leur planning, leur transit et leur grille de coûts remplacent ces plannings pour les trajets qu'elles couvrent. Les plannings avancés restent utiles pour les services sans route.</Alert>
              </div>
              <CarrierSchedules key={carrier.id} carrier={carrier} />
            </div>
          )}
        </div>
      </section>
      <CarrierDrawer state={edit} onClose={() => setEdit(null)} crud={crud} />
    </div>
  );
}

type SortKey = 'origin' | 'destination' | 'service' | 'cost' | 'min' | 'max';

function RoutesTab({ carrier, routes, loading, error }: { carrier: Carrier; routes: CarrierRoute[]; loading: boolean; error: unknown }) {
  const zones = useZones();
  const services = useServices(carrier.id);
  const shippingPoints = useZoneShippingPoints();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [service, setService] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const zoneName = (zid: string) => zones.data?.items.find((z) => z.id === zid)?.name ?? zid;
  const svcName = (sid: string) => services.data?.items.find((s) => s.id === sid)?.name ?? sid;
  const usedOrigins = Array.from(new Set(routes.map((r) => r.originZoneId)));
  const usedDests = Array.from(new Set(routes.map((r) => r.destinationZoneId)));
  const filtered = useMemo(() => {
    const list = routes.filter((r) => (!origin || r.originZoneId === origin) && (!dest || r.destinationZoneId === dest) && (!service || r.serviceId === service));
    if (!sort) return list;
    const val = (r: CarrierRoute): string | number => {
      switch (sort.key) {
        case 'origin':
          return zoneName(r.originZoneId);
        case 'destination':
          return zoneName(r.destinationZoneId);
        case 'service':
          return svcName(r.serviceId);
        case 'cost':
          return costRange(r.costs)?.min ?? -1;
        case 'min':
          return r.transitMinHours;
        case 'max':
          return r.transitMaxHours;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, origin, dest, service, sort, zones.data, services.data]);
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  const Th = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <th className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-xs font-medium"
        onClick={() => setSort((s) => (s?.key === k ? (s.dir === 1 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 }))}
        aria-label={`Trier par ${children}`}
      >
        {children}
        <span className="flex flex-col text-neutral-300">
          <IconChevronUp size={10} className={cx(sort?.key === k && sort.dir === 1 && 'text-primary')} strokeWidth={3} />
          <IconChevronDown size={10} className={cx(sort?.key === k && sort.dir === -1 && 'text-primary')} strokeWidth={3} />
        </span>
      </button>
    </th>
  );
  const counter = (
    <span className="text-xs text-neutral-700" data-testid="routes-counter">
      {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(filtered.length, page * pageSize)} sur {filtered.length}
    </span>
  );
  const sel = (label: string, value: string, onChange: (v: string) => void, opts: { id: string; name: string }[]) => (
    <label className="flex min-w-0 flex-col">
      <span className="field-label">{label}</span>
      <select
        className="select"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setPage(1);
        }}
        aria-label={label}
      >
        <option value="">Toutes</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div data-testid="routes-tab">
      <div className="flex flex-wrap items-end gap-l">
        <div className="grid min-w-0 flex-1 gap-l sm:grid-cols-3 lg:max-w-[760px]">
          {sel('Zone d’origine', origin, setOrigin, usedOrigins.map((z) => ({ id: z, name: zoneName(z) })))}
          {sel('Zone de destination', dest, setDest, usedDests.map((z) => ({ id: z, name: zoneName(z) })))}
          {sel('Service', service, setService, (services.data?.items ?? []).map((s) => ({ id: s.id, name: s.name })))}
        </div>
        <button className="btn btn-primary" onClick={() => navigate(`/carriers/${encodeURIComponent(carrier.id)}/routes/new`)} data-testid="new-route">
          <IconPlus /> Nouvelle route
        </button>
      </div>
      <div className="mt-l flex justify-end">{counter}</div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Aucune route" icon={<IconRoute size={40} />}>
          {routes.length ? 'Aucune route ne correspond aux filtres.' : 'Créer une route pour définir les coûts, le transit et le planning d’un service entre deux zones.'}
        </EmptyState>
      ) : (
        <div className="mt-s overflow-x-auto border-t border-border">
          <table className="table" data-testid="routes-table">
            <thead>
              <tr>
                <Th k="origin">Origine</Th>
                <Th k="destination">Destination</Th>
                <Th k="service">Service</Th>
                <Th k="cost">Coût de transport</Th>
                <Th k="min">Transit min</Th>
                <Th k="max">Transit max</Th>
                <th>Métadonnées</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/carriers/${encodeURIComponent(carrier.id)}/routes/${encodeURIComponent(r.id)}`)} data-testid="route-row">
                  <td>
                    <div>{zoneName(r.originZoneId)}</div>
                    {shippingPoints(r.originZoneId) && (
                      <div className="text-xs text-neutral-500" data-testid="route-shipping-points">
                        {shippingPointsLabel(shippingPoints(r.originZoneId)!.length)}
                      </div>
                    )}
                    {(r.name || !r.active) && (
                      <div className="flex items-center gap-s text-xs text-neutral-500">
                        {r.name}
                        {!r.active && <Badge color="grey">Inactive</Badge>}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{zoneName(r.destinationZoneId)}</td>
                  <td>
                    <span className="badge badge-grey">{svcName(r.serviceId)}</span>
                  </td>
                  <td className="whitespace-nowrap">{fmtCostRange(r.costs)}</td>
                  <td className="whitespace-nowrap">{r.transitMinHours || r.transitMaxHours ? fmtHours(r.transitMinHours) : <span className="text-neutral-500">Service</span>}</td>
                  <td className="whitespace-nowrap">{r.transitMinHours || r.transitMaxHours ? fmtHours(r.transitMaxHours) : <span className="text-neutral-500">Service</span>}</td>
                  <td className="min-w-[160px]">
                    <div className="flex flex-wrap gap-xs">
                      {Object.entries(r.metadata ?? {}).map(([k, v]) => (
                        <span key={k} className="rounded-s border border-border bg-neutral-20 px-s py-xs text-2xs text-neutral-700">
                          {k}={v}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > pageSize && (
        <div className="mt-m flex justify-end border-t border-border pt-m">
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} />
        </div>
      )}
      {filtered.length > 0 && filtered.length <= pageSize && <div className="mt-m flex justify-end border-t border-border pt-m">{counter}</div>}
    </div>
  );
}
