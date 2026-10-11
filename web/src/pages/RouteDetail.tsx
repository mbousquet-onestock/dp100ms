import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { useCarrierRoute, useCarrierRoutesCrud, useCarriers, useServices, useZones } from '../api/hooks';
import type { CarrierRoute, RateCard } from '../api/types';
import { IconPlus, IconRoute, IconTrash } from '../components/Icons';
import { RestrictionsEditor } from '../components/pricing/RuleBuilder';
import { normalizeCard } from '../components/pricing/RateCardEditor';
import { emptyRouteCard, RouteCosts } from '../components/route/RouteCosts';
import { defaultPlanning, RoutePlanningEditor, RouteTestPanel, type PlanningErrors } from '../components/route/RoutePlanning';
import { Badge, Breadcrumb, ConfirmButton, cx, EmptyState, ErrorAlert, Field, Loading, NumberInput, Spinner, Switch, useToast } from '../components/ui';
import { cleanRoute } from '../lib/routes';
import { ShippingPointsLine, ShippingPointsList } from '../components/route/ShippingPoints';

type Tab = 'costs' | 'attributes' | 'planning' | 'metadata';
const TABS: { value: Tab; label: string }[] = [
  { value: 'costs', label: 'Coûts' },
  { value: 'attributes', label: 'Attributs' },
  { value: 'planning', label: 'Planning' },
  { value: 'metadata', label: 'Métadonnées' },
];

function tabOf(field: string): Tab {
  if (field.startsWith('costs')) return 'costs';
  if (field.startsWith('planning')) return 'planning';
  if (field.startsWith('metadata')) return 'metadata';
  return 'attributes';
}

export default function RouteDetail() {
  const { id: carrierId = '', routeId } = useParams();
  const route = useCarrierRoute(routeId ?? null);
  const services = useServices(carrierId);
  const zones = useZones();
  if (routeId && route.isLoading) return <Loading />;
  if (routeId && route.error)
    return (
      <div>
        <Breadcrumb items={[{ label: 'Transporteurs', to: '/carriers' }, { label: carrierId, to: `/carriers/${encodeURIComponent(carrierId)}` }, { label: 'Routes' }]} />
        <ErrorAlert error={route.error} title="Route introuvable" />
      </div>
    );
  if (!routeId && (services.isLoading || zones.isLoading)) return <Loading />;
  const initial: CarrierRoute = route.data ?? {
    id: '',
    carrierId,
    serviceId: services.data?.items[0]?.id ?? '',
    name: '',
    originZoneId: zones.data?.items.find((z) => z.id === 'FR')?.id ?? zones.data?.items[0]?.id ?? '',
    destinationZoneId: zones.data?.items.find((z) => z.id === 'FR')?.id ?? zones.data?.items[0]?.id ?? '',
    costs: emptyRouteCard(),
    transitMinHours: 24,
    transitMaxHours: 48,
    planning: defaultPlanning(),
    restrictions: [],
    metadata: {},
    priority: 0,
    active: true,
  };
  return <RouteEditor key={routeId ? `${routeId}-${route.dataUpdatedAt}` : 'new'} initial={initial} isNew={!routeId} />;
}

function RouteEditor({ initial, isNew }: { initial: CarrierRoute; isNew: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'costs') as Tab;
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };
  const navigate = useNavigate();
  const toast = useToast();
  const carriers = useCarriers();
  const services = useServices(initial.carrierId);
  const zones = useZones();
  const crud = useCarrierRoutesCrud();
  const m = isNew ? crud.create : crud.update;
  const [v, setV] = useState<CarrierRoute>(initial);
  const [costs, setCosts] = useState<RateCard | undefined>(initial.costs ? { ...initial.costs, rows: initial.costs.rows ?? [], derived: initial.costs.derived ?? [], surcharges: initial.costs.surcharges ?? [] } : undefined);
  const [idTouched, setIdTouched] = useState(!isNew);
  const [sent, setSent] = useState<CarrierRoute | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const set = <K extends keyof CarrierRoute>(k: K, val: CarrierRoute[K]) => setV((x) => ({ ...x, [k]: val }));

  // suggested id for a new route
  useEffect(() => {
    if (isNew && !idTouched && v.serviceId) setV((x) => ({ ...x, id: `${x.serviceId}-${x.originZoneId}-${x.destinationZoneId}`.toUpperCase() }));
  }, [isNew, idTouched, v.serviceId, v.originZoneId, v.destinationZoneId]);

  const payload = useMemo(() => cleanRoute(v, costs ? normalizeCard(costs) : undefined), [v, costs]);
  const initialPayload = useMemo(() => cleanRoute(initial, initial.costs ? normalizeCard(initial.costs) : undefined), [initial]);
  const dirty = isNew || JSON.stringify(payload) !== JSON.stringify(initialPayload);

  const carrier = carriers.data?.items.find((c) => c.id === v.carrierId);
  const svc = services.data?.items.find((s) => s.id === v.serviceId);
  const zoneName = (id: string) => zones.data?.items.find((z) => z.id === id)?.name ?? id;
  const fieldErrors = m.error instanceof ApiError ? m.error.fieldErrors : [];
  const fe = m.error instanceof ApiError ? m.error.byField : {};
  const tabErrors = new Set(fieldErrors.map((f) => tabOf(f.field)));

  // planning errors mapped onto weekdays using the days actually sent
  const planningErrors: PlanningErrors = { byDay: {}, general: [] };
  for (const f of fieldErrors) {
    if (!f.field.startsWith('planning')) continue;
    const mm = /^planning\.days\[(\d+)\]\.?(.*)$/.exec(f.field);
    const day = mm ? sent?.planning?.days[Number(mm[1])]?.weekday : undefined;
    if (mm && day) (planningErrors.byDay[day] ??= []).push(`${mm[2] || 'jour'} : ${f.message}`);
    else planningErrors.general.push(`${f.field.replace(/^planning\.?/, '') || 'planning'} : ${f.message}`);
  }

  const save = () => {
    setSent(payload);
    m.mutate(payload, {
      onSuccess: (saved) => {
        toast('Route enregistrée');
        if (isNew) navigate(`/carriers/${encodeURIComponent(saved.carrierId)}/routes/${encodeURIComponent(saved.id)}?tab=${tab}`, { replace: true });
      },
      onError: (e) => {
        if (e instanceof ApiError && e.fieldErrors.length) {
          const first = tabOf(e.fieldErrors[0].field);
          if (!e.fieldErrors.some((f) => tabOf(f.field) === tab)) setTab(first);
        }
      },
    });
  };
  const remove = () =>
    crud.remove.mutate(v.id, {
      onSuccess: () => {
        toast('Route supprimée');
        navigate(`/carriers/${encodeURIComponent(v.carrierId)}?tab=routes`);
      },
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const title = `${zoneName(v.originZoneId) || '…'} → ${zoneName(v.destinationZoneId) || '…'}`;
  return (
    <div data-testid="route-detail">
      <Breadcrumb
        items={[
          { label: 'Transporteurs', to: '/carriers' },
          { label: carrier?.name ?? v.carrierId, to: `/carriers/${encodeURIComponent(v.carrierId)}` },
          { label: 'Routes', to: `/carriers/${encodeURIComponent(v.carrierId)}?tab=routes` },
          { label: isNew ? 'Nouvelle route' : v.name || v.id },
        ]}
      />
      <section className="card mb-xl flex flex-wrap items-center gap-l p-l" data-testid="route-header">
        <span className="round-icon">
          <IconRoute size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-m">
            <span className="text-m font-medium text-neutral-800">{title}</span>
            {!v.active && <Badge color="grey">Inactive</Badge>}
            {dirty && !isNew && <Badge color="orange">Modifications non enregistrées</Badge>}
          </div>
          <div className="text-s text-neutral-700">
            {(carrier?.name ?? v.carrierId).toLowerCase()} - {svc?.name ?? v.serviceId}
          </div>
          {(v.name || !isNew) && <div className="text-xs text-neutral-500">{[v.name, v.id].filter(Boolean).join(' · ')}</div>}
          {v.originZoneId && <ShippingPointsLine zoneId={v.originZoneId} />}
        </div>
        <div className="flex flex-wrap items-center gap-m">
          {!isNew && (
            <Link to={`/network?carrierRoute=${encodeURIComponent(initial.id)}`} className="btn btn-secondary" data-testid="route-network-link">
              <IconRoute /> Voir dans le réseau
            </Link>
          )}
          {!isNew && <ConfirmButton small={false} label="Supprimer" confirmLabel="Supprimer la route" pending={crud.remove.isPending} onConfirm={remove} />}
          {!isNew && (
            <button
              className="btn btn-secondary"
              disabled={!dirty}
              onClick={() => {
                setV(initial);
                setCosts(initial.costs);
                setResetKey((k) => k + 1);
                m.reset();
              }}
            >
              Annuler
            </button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={m.isPending || (!dirty && !isNew)} data-testid="save-route">
            {m.isPending && <Spinner size={16} className="text-white" />}
            {isNew ? 'Créer la route' : 'Enregistrer'}
          </button>
        </div>
      </section>
      {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" className="mb-l" /> : null}
      <section className="card p-l sm:p-xl">
        <div className="pill-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)} data-testid={`tab-${t.value}`}>
              {t.label}
              {tabErrors.has(t.value) && <span className="inline-block h-[8px] w-[8px] rounded-round" style={{ background: 'var(--red-1000)' }} title="Erreurs dans cet onglet" data-testid="tab-error" />}
            </button>
          ))}
        </div>
        <div className="pt-xl" key={resetKey}>
          {tab === 'costs' && <RouteCosts card={costs} onChange={setCosts} error={m.error} startEditing={isNew} />}
          {tab === 'attributes' && (
            <AttributesTab v={v} set={set} fe={fe} isNew={isNew} onIdTouched={() => setIdTouched(true)} />
          )}
          {tab === 'planning' && (
            <div className="flex flex-col gap-2xl">
              <RoutePlanningEditor value={v.planning} onChange={(p) => set('planning', p)} errors={planningErrors} />
              {!isNew && <RouteTestPanel carrierId={v.carrierId} serviceId={initial.serviceId} routeId={v.id} dirty={dirty} />}
            </div>
          )}
          {tab === 'metadata' && <MetadataEditor value={v.metadata ?? {}} onChange={(x) => set('metadata', x)} error={Object.entries(fe).find(([k]) => k.startsWith('metadata'))?.[1]} />}
        </div>
      </section>
    </div>
  );
}

function AttributesTab({
  v,
  set,
  fe,
  isNew,
  onIdTouched,
}: {
  v: CarrierRoute;
  set: <K extends keyof CarrierRoute>(k: K, val: CarrierRoute[K]) => void;
  fe: Record<string, string>;
  isNew: boolean;
  onIdTouched: () => void;
}) {
  const services = useServices(v.carrierId);
  const zones = useZones();
  const useService = !v.transitMinHours && !v.transitMaxHours;
  return (
    <div className="flex max-w-[900px] flex-col gap-2xl" data-testid="route-attributes">
      <section>
        <h3 className="os-title-s m-0 mb-l">Délai de transit</h3>
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Minimum" error={fe.transitMinHours}>
            <DurationSelect hours={v.transitMinHours} onChange={(h) => set('transitMinHours', h)} label="Transit minimum" invalid={!!fe.transitMinHours} />
          </Field>
          <Field label="Maximum" error={fe.transitMaxHours}>
            <DurationSelect hours={v.transitMaxHours} onChange={(h) => set('transitMaxHours', h)} label="Transit maximum" invalid={!!fe.transitMaxHours} />
          </Field>
        </div>
        <p className="m-0 mt-m text-xs text-neutral-500">
          {useService ? 'Transit 0 / 0 : le transit du service (en jours de livraison) s’applique.' : 'Temps écoulé entre l’enlèvement et la livraison ; la livraison a lieu dans le premier créneau qui se termine après départ + maximum, et pas avant départ + minimum.'}
        </p>
      </section>
      <section>
        <h3 className="os-title-s m-0 mb-l">Route</h3>
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe.id}>
            <input
              className={cx('input', fe.id && 'invalid')}
              value={v.id}
              disabled={!isNew}
              onChange={(e) => {
                onIdTouched();
                set('id', e.target.value);
              }}
              aria-label="Identifiant"
            />
          </Field>
          <Field label="Nom" error={fe.name}>
            <input className="input" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Domicile national" aria-label="Nom" />
          </Field>
          <Field label="Service" error={fe.serviceId}>
            <select className={cx('select', fe.serviceId && 'invalid')} value={v.serviceId} onChange={(e) => set('serviceId', e.target.value)} aria-label="Service">
              {!v.serviceId && <option value="">Choisir un service</option>}
              {(services.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priorité" hint="La plus haute l'emporte quand plusieurs routes correspondent" error={fe.priority}>
            <NumberInput value={v.priority} onChange={(n) => set('priority', n)} />
          </Field>
          <Field label="Zone d'origine" error={fe.originZoneId}>
            <select className={cx('select', fe.originZoneId && 'invalid')} value={v.originZoneId} onChange={(e) => set('originZoneId', e.target.value)} aria-label="Zone d'origine">
              {(zones.data?.items ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.id})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zone de destination" error={fe.destinationZoneId}>
            <select className={cx('select', fe.destinationZoneId && 'invalid')} value={v.destinationZoneId} onChange={(e) => set('destinationZoneId', e.target.value)} aria-label="Zone de destination">
              {(zones.data?.items ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.id})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-l">
          <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Route active' : 'Route inactive'} />
        </div>
      </section>
      <section>
        <h3 className="os-title-s m-0 mb-s">Points d'expédition</h3>
        {v.originZoneId ? <ShippingPointsList zoneId={v.originZoneId} /> : <div className="text-xs text-neutral-500">Choisir une zone d'origine.</div>}
      </section>
      <section>
        <h3 className="os-title-s m-0 mb-s">Restrictions de la route</h3>
        <p className="m-0 mb-m text-xs text-neutral-500">S'ajoutent à celles du transporteur, du service et du leg.</p>
        <RestrictionsEditor value={v.restrictions} onChange={(x) => set('restrictions', x)} errors={fe} />
      </section>
    </div>
  );
}

/** Days + hours selects ("0 j", "12 h") bound to a number of hours. */
function DurationSelect({ hours, onChange, label, invalid }: { hours: number; onChange: (h: number) => void; label: string; invalid?: boolean }) {
  const d = Math.floor((hours || 0) / 24);
  const h = (hours || 0) % 24;
  const unit = (s: string) => <span className="flex items-center rounded-r-m border border-l-0 border-border bg-neutral-30 px-m text-s text-neutral-700">{s}</span>;
  return (
    <div className="flex flex-wrap gap-m">
      <div className="flex">
        <select className={cx('select w-[76px] rounded-r-none', invalid && 'invalid')} value={d} onChange={(e) => onChange(Number(e.target.value) * 24 + h)} aria-label={`${label} (jours)`}>
          {Array.from({ length: Math.max(15, d + 1) }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        {unit('j')}
      </div>
      <div className="flex">
        <select className={cx('select w-[76px] rounded-r-none', invalid && 'invalid')} value={h} onChange={(e) => onChange(d * 24 + Number(e.target.value))} aria-label={`${label} (heures)`}>
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        {unit('h')}
      </div>
    </div>
  );
}

function MetadataEditor({ value, onChange, error }: { value: Record<string, string>; onChange: (m: Record<string, string>) => void; error?: string }) {
  // keep an ordered list locally so that renaming a key does not reorder rows
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));
  const push = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next));
  };
  return (
    <div className="flex max-w-[760px] flex-col gap-m" data-testid="route-metadata">
      <p className="m-0 text-xs text-neutral-500">Paires clé / valeur libres (code produit, contrat…) renvoyées telles quelles.</p>
      {rows.length === 0 && <EmptyState title="Aucune métadonnée" />}
      {rows.map(([k, val], i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_36px] gap-m">
          <input className="input" value={k} placeholder="Clé" aria-label={`Clé ${i + 1}`} onChange={(e) => push(rows.map((x, j) => (j === i ? [e.target.value.trim(), x[1]] : x)))} />
          <input className="input" value={val} placeholder="Valeur" aria-label={`Valeur ${i + 1}`} onChange={(e) => push(rows.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
          <button className="btn btn-tertiary-red btn-icon" onClick={() => push(rows.filter((_, j) => j !== i))} aria-label="Retirer la métadonnée" title="Retirer">
            <IconTrash />
          </button>
        </div>
      ))}
      {rows.some(([k], i) => k && rows.findIndex(([x]) => x === k) !== i) && <div className="field-error">Clé en double : seule la dernière valeur est conservée.</div>}
      {error && <div className="field-error">{error}</div>}
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => setRows([...rows, ['', '']])} data-testid="add-metadata">
          <IconPlus /> Ajouter une métadonnée
        </button>
      </div>
    </div>
  );
}
