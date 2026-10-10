import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { qk, useCarriers, useCrud, useModes, useServices } from '../api/hooks';
import type { Carrier, CarrierService } from '../api/types';
import { SERVICE_KINDS } from '../api/types';
import { IconEdit, IconPlus, IconTruck } from '../components/Icons';
import { Badge, Card, ChipSelect, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, ListInput, Loading, NumberInput, PageHeader, Spinner, Switch, useToast, WeekdayToggles } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { SERVICE_KIND_LABEL } from '../lib/labels';

const emptyService = (carrierId: string): CarrierService => ({
  id: '',
  carrierId,
  name: '',
  kind: 'STANDARD',
  modes: ['STANDARD'],
  coverage: ['*'],
  excludedCoverage: [],
  transitDays: 2,
  transitMinutes: 0,
  pickupCalendar: { workingDays: [1, 2, 3, 4, 5], honorHolidays: true },
  deliveryCalendar: { workingDays: [1, 2, 3, 4, 5, 6], honorHolidays: true },
  cutoff: '17:00',
  windowStart: '09:00',
  windowEnd: '18:00',
  maxWeightKg: 30,
  maxVolumeL: 150,
  maxItems: 30,
  dailyCapacity: 10000,
  baseCost: 5,
  costPerKg: 0.4,
  active: true,
});

export default function Carriers() {
  const carriers = useCarriers();
  const [selected, setSelected] = useState<string | null>(null);
  const [editCarrier, setEditCarrier] = useState<{ v: Carrier; isNew: boolean } | null>(null);
  const crud = useCrud<Carrier>('carriers', [qk.carriers]);
  const toast = useToast();

  useEffect(() => {
    if (!selected && carriers.data?.items.length) setSelected(carriers.data.items[0].id);
  }, [carriers.data, selected]);

  return (
    <div>
      <PageHeader
        title="Transporteurs et services"
        subtitle="Transporteurs, services de transport, couvertures, calendriers et coûts"
        actions={
          <button className="btn btn-primary" onClick={() => setEditCarrier({ v: { id: '', name: '', active: true }, isNew: true })}>
            <IconPlus /> Créer un transporteur
          </button>
        }
      />
      <div className="grid gap-l lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card title="Transporteurs" icon={<IconTruck size={20} />} bodyClassName="">
          {carriers.isLoading ? (
            <Loading />
          ) : carriers.error ? (
            <div className="p-xl">
              <ErrorAlert error={carriers.error} />
            </div>
          ) : carriers.data?.items.length === 0 ? (
            <EmptyState title="Aucun transporteur" />
          ) : (
            <table className="table">
              <tbody>
                {carriers.data?.items.map((c) => (
                  <tr key={c.id} className={cx('clickable', selected === c.id && 'selected')} onClick={() => setSelected(c.id)}>
                    <td>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-neutral-500">{c.id}</div>
                    </td>
                    <td>{c.active ? <Badge color="green">Actif</Badge> : <Badge color="grey">Inactif</Badge>}</td>
                    <td className="text-right">
                      <span className="inline-flex">
                        <button
                          className="btn btn-tertiary btn-sm btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditCarrier({ v: c, isNew: false });
                          }}
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          <IconEdit />
                        </button>
                        <ConfirmButton
                          iconOnly
                          confirmLabel="Supprimer"
                          pending={crud.remove.isPending}
                          onConfirm={() =>
                            crud.remove.mutate(c.id, {
                              onSuccess: () => {
                                toast('Transporteur supprimé');
                                if (selected === c.id) setSelected(null);
                              },
                              onError: (e) => toast(errorMessage(e), 'error'),
                            })
                          }
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {selected ? <ServicesCard carrier={carriers.data?.items.find((c) => c.id === selected)} carrierId={selected} /> : <Card title="Services"><EmptyState title="Sélectionner un transporteur" /></Card>}
      </div>

      <CarrierDrawer state={editCarrier} onClose={() => setEditCarrier(null)} crud={crud} />
    </div>
  );
}

function CarrierDrawer({ state, onClose, crud }: { state: { v: Carrier; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<Carrier>> }) {
  const [v, setV] = useState<Carrier>({ id: '', name: '', active: true });
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
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouveau transporteur' : `Transporteur ${state?.v.id}`}
      width={440}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate(v, { onSuccess: () => { toast('Enregistré'); onClose(); } })}>
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        <Field label="Identifiant" error={fe.id}>
          <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => setV({ ...v, id: e.target.value })} />
        </Field>
        <Field label="Nom" error={fe.name}>
          <input className={cx('input', fe.name && 'invalid')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Switch checked={v.active} onChange={(b) => setV({ ...v, active: b })} label={v.active ? 'Actif' : 'Inactif'} />
      </div>
    </Drawer>
  );
}

function ServicesCard({ carrierId, carrier }: { carrierId: string; carrier?: Carrier }) {
  const services = useServices(carrierId);
  const crud = useCrud<CarrierService>('services', [['services']]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ v: CarrierService; isNew: boolean } | null>(null);
  return (
    <Card
      title={`Services · ${carrier?.name ?? carrierId}`}
      bodyClassName="overflow-x-auto"
      actions={
        <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ v: emptyService(carrierId), isNew: true })}>
          <IconPlus /> Ajouter un service
        </button>
      }
    >
      {services.isLoading ? (
        <Loading />
      ) : services.error ? (
        <div className="p-xl">
          <ErrorAlert error={services.error} />
        </div>
      ) : services.data?.items.length === 0 ? (
        <EmptyState title="Aucun service pour ce transporteur" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Type</th>
              <th>Modes</th>
              <th>Couverture</th>
              <th>Transit</th>
              <th>Cut-off</th>
              <th>Créneau</th>
              <th className="num">Coût</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {services.data?.items.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setEdit({ v: s, isNew: false })}>
                <td>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-neutral-500">{s.id}</div>
                </td>
                <td>
                  <Badge color="blue">{SERVICE_KIND_LABEL[s.kind] ?? s.kind}</Badge>
                </td>
                <td className="text-xs">{(s.modes ?? []).join(', ') || '–'}</td>
                <td className="max-w-[180px] truncate text-xs" title={(s.coverage ?? []).join(', ')}>
                  {(s.coverage ?? []).includes('*') ? 'France métropolitaine' : (s.coverage ?? []).join(', ')}
                  {(s.excludedCoverage ?? []).length > 0 && <span className="text-neutral-500"> sauf {s.excludedCoverage!.join(', ')}</span>}
                </td>
                <td className="whitespace-nowrap text-xs">{s.transitMinutes > 0 ? `${s.transitMinutes} min` : `J+${s.transitDays}`}</td>
                <td>{s.cutoff}</td>
                <td className="whitespace-nowrap text-xs">
                  {s.windowStart} – {s.windowEnd}
                </td>
                <td className="num whitespace-nowrap text-xs">
                  {fmtMoney(s.baseCost)} + {fmtMoney(s.costPerKg)}/kg
                </td>
                <td>{s.active ? <Badge color="green">Actif</Badge> : <Badge color="grey">Inactif</Badge>}</td>
                <td className="text-right">
                  <ConfirmButton
                    iconOnly
                    confirmLabel="Supprimer"
                    onConfirm={() => crud.remove.mutate(s.id, { onSuccess: () => toast('Service supprimé'), onError: (e) => toast(errorMessage(e), 'error') })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ServiceDrawer state={edit} onClose={() => setEdit(null)} crud={crud} />
    </Card>
  );
}

function ServiceDrawer({ state, onClose, crud }: { state: { v: CarrierService; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<CarrierService>> }) {
  const [v, setV] = useState<CarrierService | null>(null);
  const modes = useModes();
  const carriers = useCarriers();
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
  if (!v) return null;
  const set = <K extends keyof CarrierService>(k: K, val: CarrierService[K]) => setV((x) => (x ? { ...x, [k]: val } : x));
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouveau service' : `Service ${v.id}`}
      width={680}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate(v, { onSuccess: () => { toast('Enregistré'); onClose(); } })}>
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
            <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => set('id', e.target.value)} />
          </Field>
          <Field label="Nom" error={fe.name}>
            <input className={cx('input', fe.name && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Transporteur" error={fe.carrierId}>
            <select className={cx('select', fe.carrierId && 'invalid')} value={v.carrierId} onChange={(e) => set('carrierId', e.target.value)}>
              {(carriers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type de service" error={fe.kind}>
            <select className={cx('select', fe.kind && 'invalid')} value={v.kind} onChange={(e) => set('kind', e.target.value as CarrierService['kind'])}>
              {SERVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SERVICE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Modes de livraison (dernier leg)" className="sm:col-span-2" error={Object.entries(fe).find(([k]) => k.startsWith('modes'))?.[1]}>
            <ChipSelect options={(modes.data?.items ?? []).map((x) => x.id)} value={v.modes ?? []} onChange={(x) => set('modes', x)} />
          </Field>
          <Field label="Couverture (départements, * = France métropolitaine)" hint="Séparés par des virgules, ex. 75, 92, 93">
            <ListInput value={v.coverage} onChange={(x) => set('coverage', x)} placeholder="*" />
          </Field>
          <Field label="Départements exclus" hint="Prioritaires sur la couverture">
            <ListInput value={v.excludedCoverage} onChange={(x) => set('excludedCoverage', x)} placeholder="20" />
          </Field>
          <Field label="Transit (jours ouvrés, dernier leg)" error={fe.transitDays}>
            <NumberInput value={v.transitDays} onChange={(n) => set('transitDays', n)} invalid={!!fe.transitDays} />
          </Field>
          <Field label="Transit (minutes, vers hub)" error={fe.transitMinutes}>
            <NumberInput value={v.transitMinutes} onChange={(n) => set('transitMinutes', n)} invalid={!!fe.transitMinutes} />
          </Field>
          <Field label="Jours d'enlèvement" error={fe['pickupCalendar.workingDays']}>
            <WeekdayToggles value={v.pickupCalendar.workingDays} onChange={(d) => set('pickupCalendar', { ...v.pickupCalendar, workingDays: d })} />
            <div className="mt-m">
              <Switch checked={v.pickupCalendar.honorHolidays} onChange={(b) => set('pickupCalendar', { ...v.pickupCalendar, honorHolidays: b })} label="Pas d'enlèvement les jours fériés" />
            </div>
          </Field>
          <Field label="Jours de livraison" error={fe['deliveryCalendar.workingDays']}>
            <WeekdayToggles value={v.deliveryCalendar.workingDays} onChange={(d) => set('deliveryCalendar', { ...v.deliveryCalendar, workingDays: d })} />
            <div className="mt-m">
              <Switch checked={v.deliveryCalendar.honorHolidays} onChange={(b) => set('deliveryCalendar', { ...v.deliveryCalendar, honorHolidays: b })} label="Pas de livraison les jours fériés" />
            </div>
          </Field>
          <Field label="Cut-off">
            <input type="time" className="input" value={v.cutoff} onChange={(e) => set('cutoff', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-m">
            <Field label="Créneau début">
              <input type="time" className="input" value={v.windowStart} onChange={(e) => set('windowStart', e.target.value)} />
            </Field>
            <Field label="Créneau fin" error={fe.windowEnd}>
              <input type="time" className={cx('input', fe.windowEnd && 'invalid')} value={v.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} />
            </Field>
          </div>
        </div>
        <div>
          <div className="os-title-s mb-m">Limites et coûts</div>
          {fe.limits && <div className="field-error mb-m">{fe.limits}</div>}
          <div className="grid gap-l sm:grid-cols-3">
            <Field label="Poids max (kg)">
              <NumberInput value={v.maxWeightKg} step={0.1} onChange={(n) => set('maxWeightKg', n)} />
            </Field>
            <Field label="Volume max (L)">
              <NumberInput value={v.maxVolumeL} onChange={(n) => set('maxVolumeL', n)} />
            </Field>
            <Field label="Articles max par colis">
              <NumberInput value={v.maxItems} onChange={(n) => set('maxItems', n)} />
            </Field>
            <Field label="Capacité journalière">
              <NumberInput value={v.dailyCapacity} onChange={(n) => set('dailyCapacity', n)} />
            </Field>
            <Field label="Coût de base (€)">
              <NumberInput value={v.baseCost} step={0.01} onChange={(n) => set('baseCost', n)} />
            </Field>
            <Field label="Coût par kg (€)">
              <NumberInput value={v.costPerKg} step={0.01} onChange={(n) => set('costPerKg', n)} />
            </Field>
          </div>
        </div>
        <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Service actif' : 'Service inactif'} />
      </div>
    </Drawer>
  );
}
