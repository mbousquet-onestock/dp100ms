import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { useAllStockPoints, useCarrierRoutes, useCarriers, useHubs, useZones, useZonesCrud } from '../api/hooks';
import type { Zone } from '../api/types';
import { IconMap, IconPlus } from '../components/Icons';
import { Badge, Card, Checkbox, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, ListInput, Loading, PageHeader, SearchInput, Spinner, Switch, useToast } from '../components/ui';
import { errorsStarting, FieldErrors } from '../components/carrier/shared';
import { zoneSummary } from '../lib/routes';

const empty = (): Zone => ({ id: '', name: '', description: '', departments: [], postalCodes: [], stockPointIds: [], active: true });

export default function Zones() {
  const zones = useZones();
  const routes = useCarrierRoutes();
  const carriers = useCarriers();
  const crud = useZonesCrud();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ v: Zone; isNew: boolean } | null>(null);
  const usage = useMemo(() => {
    const m = new Map<string, { origin: number; dest: number; carriers: Set<string> }>();
    for (const r of routes.data?.items ?? []) {
      for (const [id, k] of [
        [r.originZoneId, 'origin'],
        [r.destinationZoneId, 'dest'],
      ] as const) {
        const u = m.get(id) ?? { origin: 0, dest: 0, carriers: new Set<string>() };
        u[k]++;
        u.carriers.add(r.carrierId);
        m.set(id, u);
      }
    }
    return m;
  }, [routes.data]);
  const list = (zones.data?.items ?? []).filter((z) => !q || `${z.id} ${z.name} ${z.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const carrierName = (id: string) => carriers.data?.items.find((c) => c.id === id)?.name ?? id;
  return (
    <div>
      <PageHeader
        title="Zones"
        subtitle="Ensembles de départements, codes postaux et points de stock utilisés comme origine ou destination des routes transporteur"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: empty(), isNew: true })} data-testid="new-zone">
            <IconPlus /> Créer une zone
          </button>
        }
      />
      <Card bodyClassName="">
        <div className="border-b border-border p-xl">
          <SearchInput value={q} onChange={setQ} placeholder="Rechercher une zone" />
        </div>
        {zones.isLoading ? (
          <Loading />
        ) : zones.error ? (
          <div className="p-xl">
            <ErrorAlert error={zones.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="Aucune zone" icon={<IconMap size={40} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table" data-testid="zones-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Contenu</th>
                  <th>Utilisation</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((z) => {
                  const u = usage.get(z.id);
                  const n = u ? u.origin + u.dest : 0;
                  return (
                    <tr key={z.id} className="clickable" onClick={() => setEdit({ v: z, isNew: false })}>
                      <td>
                        <div className="font-medium">{z.name}</div>
                        <div className="text-xs text-neutral-500">{z.id}</div>
                      </td>
                      <td className="min-w-[220px] text-xs">
                        <div>{zoneSummary(z)}</div>
                        {z.description && <div className="text-neutral-500">{z.description}</div>}
                      </td>
                      <td className="min-w-[180px] text-xs">
                        {u ? (
                          <>
                            <div className="font-medium">
                              {n} route{n > 1 ? 's' : ''} <span className="font-normal text-neutral-500">({u.origin} en origine, {u.dest} en destination)</span>
                            </div>
                            <div className="text-neutral-500">{[...u.carriers].map(carrierName).join(', ')}</div>
                          </>
                        ) : (
                          <span className="text-neutral-500">Non utilisée</span>
                        )}
                      </td>
                      <td>{z.active ? <Badge color="green">Active</Badge> : <Badge color="grey">Inactive</Badge>}</td>
                      <td className="text-right">
                        <ConfirmButton
                          iconOnly
                          confirmLabel="Supprimer"
                          onConfirm={() => crud.remove.mutate(z.id, { onSuccess: () => toast('Zone supprimée'), onError: (e) => toast(errorMessage(e), 'error') })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ZoneDrawer state={edit} onClose={() => setEdit(null)} crud={crud} usedBy={edit ? (routes.data?.items ?? []).filter((r) => r.originZoneId === edit.v.id || r.destinationZoneId === edit.v.id) : []} />
    </div>
  );
}

function ZoneDrawer({
  state,
  onClose,
  crud,
  usedBy,
}: {
  state: { v: Zone; isNew: boolean } | null;
  onClose: () => void;
  crud: ReturnType<typeof useZonesCrud>;
  usedBy: { id: string; carrierId: string; name?: string; originZoneId: string; destinationZoneId: string }[];
}) {
  const [v, setV] = useState<Zone>(empty());
  const toast = useToast();
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV(state.v);
      crud.create.reset();
      crud.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const fe = m.error instanceof ApiError ? m.error.byField : {};
  const all = (v.departments ?? []).includes('*');
  const set = <K extends keyof Zone>(k: K, val: Zone[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = () => {
    const opt = <T,>(a: T[] | undefined) => (a && a.length ? a : undefined);
    m.mutate(
      { ...v, description: v.description || undefined, departments: opt(v.departments), postalCodes: opt(v.postalCodes), stockPointIds: opt(v.stockPointIds) },
      {
        onSuccess: () => {
          toast('Zone enregistrée');
          onClose();
        },
      },
    );
  };
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouvelle zone' : `Zone ${state?.v.id}`}
      width={600}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={save} data-testid="save-zone">
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe.id}>
            <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => set('id', e.target.value.toUpperCase())} placeholder="SUD-OUEST" aria-label="Identifiant" />
          </Field>
          <Field label="Nom" error={fe.name}>
            <input className={cx('input', fe.name && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} aria-label="Nom" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="os-title-s mb-s">Départements</div>
          <div className="mb-m">
            <Checkbox checked={all} onChange={(b) => set('departments', b ? ['*'] : [])} label="Toute la France métropolitaine (*)" />
          </div>
          {!all && (
            <Field label="Codes départements" hint="Séparés par des virgules, ex. 33, 40, 64 (20 pour la Corse)" error={errorsStarting(fe, 'departments')[0]}>
              <ListInput value={v.departments} onChange={(x) => set('departments', x)} placeholder="33, 40, 64" invalid={errorsStarting(fe, 'departments').length > 0} id="zone-departments" />
            </Field>
          )}
          {all && <FieldErrors messages={errorsStarting(fe, 'departments')} />}
        </div>
        <Field label="Préfixes de codes postaux" hint="2 à 5 caractères, ex. 750, 69001. Pour une destination, ils sont rapprochés au niveau du département." error={errorsStarting(fe, 'postalCodes')[0]}>
          <ListInput value={v.postalCodes} onChange={(x) => set('postalCodes', x)} placeholder="750, 69001" invalid={errorsStarting(fe, 'postalCodes').length > 0} />
        </Field>
        <div>
          <div className="os-title-s mb-s">Points de stock et hubs</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Une origine appartient à la zone si son identifiant est listé ici ou si son code postal correspond.</p>
          <StockPointPicker value={v.stockPointIds ?? []} onChange={(x) => set('stockPointIds', x)} />
          <FieldErrors messages={errorsStarting(fe, 'stockPointIds')} />
        </div>
        <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Zone active' : 'Zone inactive'} />
        {!state?.isNew && (
          <div>
            <div className="os-title-s mb-s">Routes utilisant cette zone ({usedBy.length})</div>
            {usedBy.length === 0 ? (
              <div className="text-xs text-neutral-500">Aucune route.</div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-s p-0 text-s">
                {usedBy.map((r) => (
                  <li key={r.id}>
                    <Link className="text-primary hover:underline" to={`/carriers/${encodeURIComponent(r.carrierId)}/routes/${encodeURIComponent(r.id)}`}>
                      {r.name || r.id}
                    </Link>{' '}
                    <span className="text-xs text-neutral-500">
                      {r.carrierId} · {r.originZoneId} → {r.destinationZoneId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Searchable multi-select of stock points and hubs. */
function StockPointPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const points = useAllStockPoints();
  const hubs = useHubs();
  const [q, setQ] = useState('');
  const options = useMemo(
    () => [
      ...(points.data?.items ?? []).map((p) => ({ id: p.id, label: p.name, sub: `${p.address.postalCode} ${p.address.city}` })),
      ...(hubs.data?.items ?? []).filter((h) => !h.stockPointId).map((h) => ({ id: h.id, label: h.name, sub: `Hub · ${h.postalCode} ${h.city}` })),
    ],
    [points.data, hubs.data],
  );
  const lq = q.toLowerCase();
  const shown = q ? options.filter((o) => !value.includes(o.id) && `${o.id} ${o.label} ${o.sub}`.toLowerCase().includes(lq)).slice(0, 12) : [];
  return (
    <div className="flex flex-col gap-m">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-s">
          {value.map((id) => {
            const o = options.find((x) => x.id === id);
            return (
              <button key={id} type="button" className="chip" aria-pressed onClick={() => onChange(value.filter((x) => x !== id))} title="Retirer">
                {o ? `${o.label} (${id})` : id} ×
              </button>
            );
          })}
        </div>
      )}
      <SearchInput value={q} onChange={setQ} placeholder="Ajouter un point de stock ou un hub" />
      {shown.length > 0 && (
        <div className="max-h-[220px] overflow-y-auto rounded-m border border-border">
          {shown.map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center justify-between gap-m border-b border-border px-l py-m text-left text-s last:border-b-0 hover:bg-neutral-30"
              onClick={() => {
                onChange([...value, o.id]);
                setQ('');
              }}
            >
              <span className="truncate">
                {o.label} <span className="text-xs text-neutral-500">{o.id}</span>
              </span>
              <span className="flex-none text-xs text-neutral-500">{o.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
