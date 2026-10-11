import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { qk, useCarrierRoutes, useCarriers, useCrud, useServices } from '../api/hooks';
import type { Carrier } from '../api/types';
import { IconChevronRight, IconPlus, IconTruck } from '../components/Icons';
import { Badge, EmptyState, ErrorAlert, Loading, PageHeader, SearchInput } from '../components/ui';
import { CarrierDrawer, CarrierIcon } from '../components/carrier/CarrierDrawer';
import { plural } from '../lib/routes';

export default function Carriers() {
  const carriers = useCarriers();
  const services = useServices();
  const routes = useCarrierRoutes();
  const crud = useCrud<Carrier>('carriers', [qk.carriers]);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ v: Carrier; isNew: boolean } | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, { services: number; routes: number }>();
    const get = (id: string) => m.get(id) ?? (m.set(id, { services: 0, routes: 0 }), m.get(id)!);
    for (const s of services.data?.items ?? []) get(s.carrierId).services++;
    for (const r of routes.data?.items ?? []) get(r.carrierId).routes++;
    return m;
  }, [services.data, routes.data]);
  const list = (carriers.data?.items ?? []).filter((c) => !q || `${c.id} ${c.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Transporteurs"
        subtitle="Services, routes (coûts, transit, planning), restrictions"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: { id: '', name: '', active: true }, isNew: true })}>
            <IconPlus /> Créer un transporteur
          </button>
        }
      />
      <section className="card">
        <div className="p-xl">
          <SearchInput value={q} onChange={setQ} placeholder="Rechercher" />
        </div>
        {carriers.isLoading ? (
          <Loading />
        ) : carriers.error ? (
          <div className="p-xl">
            <ErrorAlert error={carriers.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="Aucun transporteur" icon={<IconTruck size={40} />} />
        ) : (
          <ul className="m-0 list-none px-xl pb-s" data-testid="carrier-list">
            {list.map((c) => {
              const n = counts.get(c.id) ?? { services: 0, routes: 0 };
              return (
                <li key={c.id} className="border-t border-border">
                  <button type="button" className="flex w-full items-center gap-l py-l text-left hover:bg-neutral-20" onClick={() => navigate(`/carriers/${encodeURIComponent(c.id)}`)}>
                    <CarrierIcon carrier={c} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-m">
                        <span className="truncate text-s font-medium text-neutral-800">{c.name}</span>
                        {!c.active && <Badge color="grey">Inactif</Badge>}
                      </span>
                      <span className="block text-s text-neutral-700">{plural(n.services, 'service')}</span>
                      <span className="block text-xs text-neutral-500">{plural(n.routes, 'route')}</span>
                    </span>
                    <IconChevronRight className="flex-none text-neutral-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <CarrierDrawer state={edit} onClose={() => setEdit(null)} crud={crud} onSaved={(c) => edit?.isNew && navigate(`/carriers/${encodeURIComponent(c.id)}`)} />
    </div>
  );
}
