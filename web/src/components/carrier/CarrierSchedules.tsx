import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { qk, useCrud, useRateCards, useSchedulePreview, useServices } from '../../api/hooks';
import type { Carrier, CarrierService, DeliverySchedule, RateCard } from '../../api/types';
import { fmtDateTime, fmtWindow, fromLocalInput, toLocalInput } from '../../lib/format';
import { IconChevronDown, IconChevronUp, IconClock, IconClose, IconCopy, IconPlay, IconPlus, IconTrash } from '../Icons';
import { Alert, Badge, ChipSelect, cx, EmptyState, ErrorAlert, Field, ListInput, OptNumberInput, Spinner, Switch, useToast, WeekdayToggles } from '../ui';
import { cleanCarrier, errorsFor, errorsStarting, FieldErrors, fmtDays, Hint, LEVEL_LABEL, RateCardChips, scheduleLevel, scheduleSummary } from './shared';

const LEVEL_COLOR = { carrier: 'grey', service: 'blue', zone: 'orange', 'service-zone': 'purple' } as const;

const emptySchedule = (): DeliverySchedule => ({
  id: '',
  name: '',
  serviceIds: [],
  zones: [],
  pickupDays: [1, 2, 3, 4, 5],
  cutoff: '17:00',
  deliveryDays: [],
  honorHolidays: true,
  closedDates: [],
  rateCardIds: [],
  active: true,
});

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Fills empty ids from the name, keeping them unique. */
function withIds(list: DeliverySchedule[]): DeliverySchedule[] {
  const used = new Set(list.map((s) => s.id).filter(Boolean));
  return list.map((s, i) => {
    if (s.id) return s;
    const base = slugify(s.name) || `PLANNING_${i + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return { ...s, id };
  });
}

export function CarrierSchedules({ carrier }: { carrier: Carrier }) {
  const services = useServices(carrier.id);
  const cards = useRateCards();
  const crud = useCrud<Carrier>('carriers', [qk.carriers]);
  const toast = useToast();
  const [draft, setDraft] = useState<DeliverySchedule[]>(carrier.schedules ?? []);
  const [open, setOpen] = useState<number | null>(null);
  const saved = JSON.stringify(cleanCarrier(carrier).schedules ?? []);
  useEffect(() => {
    setDraft(carrier.schedules ?? []);
    // reset only when the saved version changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  const dirty = JSON.stringify(cleanCarrier({ ...carrier, schedules: draft }).schedules ?? []) !== saved;
  const err = crud.update.error;
  const svc = useMemo(() => services.data?.items ?? [], [services.data]);
  const allCards = useMemo(() => cards.data?.items ?? [], [cards.data]);

  const update = (i: number, s: DeliverySchedule) => setDraft((d) => d.map((x, j) => (j === i ? s : x)));
  const add = () => {
    setDraft((d) => [...d, { ...emptySchedule(), name: `Planning ${d.length + 1}` }]);
    setOpen(draft.length);
  };
  const duplicate = (i: number) => {
    setDraft((d) => [...d.slice(0, i + 1), { ...d[i], id: '', name: `${d[i].name} (copie)` }, ...d.slice(i + 1)]);
    setOpen(i + 1);
  };
  const remove = (i: number) => {
    setDraft((d) => d.filter((_, j) => j !== i));
    setOpen(null);
  };
  const save = () => {
    const list = withIds(draft);
    setDraft(list);
    crud.update.mutate(cleanCarrier({ ...carrier, schedules: list }), {
      onSuccess: () => toast('Plannings enregistrés'),
      onError: (e) => {
        if (e instanceof ApiError) {
          const first = e.fieldErrors.map((f) => f.field.match(/^schedules\[(\d+)\]/)).find(Boolean);
          if (first) setOpen(Number(first[1]));
        }
      },
    });
  };
  const generalErrors = err instanceof ApiError ? err.fieldErrors.filter((f) => !/^schedules\[\d+\]/.test(f.field)) : [];

  return (
    <div className="flex flex-col gap-2xl p-xl">
      <section className="flex flex-col gap-m">
        <div className="flex flex-wrap items-center justify-between gap-m">
          <div className="max-w-[640px]">
            <div className="os-title-s">Plannings de livraison</div>
            <Hint>
              Les plannings se superposent du plus général au plus précis : transporteur, service, zone, service + zone. Un champ vide reprend la valeur du niveau précédent (au départ, celle du service).
            </Hint>
          </div>
          <div className="flex items-center gap-m">
            {dirty && <span className="text-xs text-neutral-500">Modifications non enregistrées</span>}
            <button className="btn btn-secondary btn-sm" onClick={add} data-testid="add-schedule">
              <IconPlus /> Ajouter un planning
            </button>
            <button className="btn btn-primary btn-sm" disabled={!dirty || crud.update.isPending} onClick={save} data-testid="save-schedules">
              {crud.update.isPending && <Spinner size={14} className="text-white" />}
              Enregistrer
            </button>
          </div>
        </div>
        {err ? (
          generalErrors.length || !(err instanceof ApiError) || !err.fieldErrors.length ? (
            <ErrorAlert error={err} title="Enregistrement impossible" />
          ) : (
            <Alert kind="error" title="Enregistrement impossible">
              Corriger les champs signalés dans les plannings.
            </Alert>
          )
        ) : null}
        {draft.length === 0 ? (
          <div className="rounded-m border border-border">
            <EmptyState title="Aucun planning" icon={<IconClock size={40} />}>
              Sans planning, les calendriers, cut-off et créneaux des services s'appliquent.
            </EmptyState>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-m p-0" data-testid="schedule-list">
            {draft.map((s, i) => (
              <ScheduleItem
                key={i}
                index={i}
                value={s}
                services={svc}
                cards={allCards}
                carrierId={carrier.id}
                errors={errorsFor(err, `schedules[${i}]`)}
                open={open === i}
                onToggle={() => setOpen(open === i ? null : i)}
                onChange={(v) => update(i, v)}
                onDuplicate={() => duplicate(i)}
                onRemove={() => remove(i)}
              />
            ))}
          </ul>
        )}
      </section>
      <SchedulePreviewPanel carrier={carrier} services={svc} dirty={dirty} />
    </div>
  );
}

function ScheduleItem({
  index,
  value: s,
  services,
  cards,
  carrierId,
  errors: fe,
  open,
  onToggle,
  onChange,
  onDuplicate,
  onRemove,
}: {
  index: number;
  value: DeliverySchedule;
  services: CarrierService[];
  cards: RateCard[];
  carrierId: string;
  errors: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onChange: (v: DeliverySchedule) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof DeliverySchedule>(k: K, v: DeliverySchedule[K]) => onChange({ ...s, [k]: v });
  const level = scheduleLevel(s);
  const nErr = Object.keys(fe).length;
  const svcName = (id: string) => services.find((x) => x.id === id)?.name ?? id;
  const tail = [
    (s.serviceIds ?? []).length ? `services : ${s.serviceIds!.map(svcName).join(', ')}` : '',
    (s.zones ?? []).length ? `zones : ${s.zones!.join(', ')}` : '',
    (s.rateCardIds ?? []).length ? `grilles : ${s.rateCardIds!.join(', ')}` : '',
  ].filter(Boolean);
  return (
    <li className={cx('rounded-m border bg-white', nErr ? 'border-[var(--red-1000)]' : 'border-border')} data-testid={`schedule-${index}`}>
      <div className="flex flex-wrap items-center gap-m px-l py-m">
        <button type="button" className="flex min-w-0 flex-1 items-start gap-m text-left" onClick={onToggle} aria-expanded={open}>
          <span className="mt-xs text-neutral-500">{open ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-m">
              <span className="font-medium">{s.name || 'Sans nom'}</span>
              <span className="text-xs text-neutral-500">{s.id || 'identifiant généré à l’enregistrement'}</span>
              <Badge color={LEVEL_COLOR[level]}>{LEVEL_LABEL[level]}</Badge>
              {!s.active && <Badge color="grey">Inactif</Badge>}
              {nErr > 0 && <Badge color="red">{nErr} erreur{nErr > 1 ? 's' : ''}</Badge>}
            </span>
            <span className="mt-xs block text-s text-neutral-800" data-testid="schedule-summary">
              {scheduleSummary(s)}
              {tail.length > 0 && <span className="text-neutral-500">, {tail.join(', ')}</span>}
            </span>
          </span>
        </button>
        <div className="flex items-center">
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={onDuplicate} title="Dupliquer" aria-label="Dupliquer">
            <IconCopy />
          </button>
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={onRemove} title="Supprimer" aria-label="Supprimer">
            <IconTrash />
          </button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-l border-t border-border px-l py-l">
          {fe[''] && <div className="field-error">{fe['']}</div>}
          <div className="grid gap-l sm:grid-cols-2">
            <Field label="Nom" error={fe.name}>
              <input className={cx('input', fe.name && 'invalid')} value={s.name} onChange={(e) => set('name', e.target.value)} aria-label="Nom du planning" />
            </Field>
            <Field label="Identifiant" error={fe.id} hint="Vide = généré à partir du nom">
              <input className={cx('input', fe.id && 'invalid')} value={s.id} placeholder={slugify(s.name) || 'PLANNING'} onChange={(e) => set('id', e.target.value)} />
            </Field>
            <Field label="Services" className="sm:col-span-2" error={errorsStarting(fe, 'serviceIds')[0]} hint="Aucun service sélectionné = tous les services du transporteur">
              {services.length ? (
                <ChipSelect options={services.map((x) => x.id)} value={s.serviceIds ?? []} onChange={(v) => set('serviceIds', v)} renderLabel={svcName} />
              ) : (
                <div className="text-xs text-neutral-500">Aucun service pour ce transporteur.</div>
              )}
            </Field>
            <Field label="Zones (départements de destination)" error={errorsStarting(fe, 'zones')[0]} hint="Séparés par des virgules, vide = toutes. Seulement pour la livraison au client.">
              <ListInput value={s.zones} onChange={(v) => set('zones', v)} placeholder="20, 2A, 2B" invalid={errorsStarting(fe, 'zones').length > 0} />
            </Field>
            <div />
            <Field label="Jours d'enlèvement" error={errorsStarting(fe, 'pickupDays')[0]} hint="Aucun jour = valeur du service">
              <WeekdayToggles value={s.pickupDays ?? []} onChange={(v) => set('pickupDays', v)} />
            </Field>
            <Field label="Cut-off" error={fe.cutoff} hint="Dernière remise pour un enlèvement le jour même, vide = valeur du service">
              <TimeInput value={s.cutoff} onChange={(v) => set('cutoff', v)} invalid={!!fe.cutoff} label="Cut-off" />
            </Field>
            <Field label="Jours de livraison" error={errorsStarting(fe, 'deliveryDays')[0]} hint="Aucun jour = valeur du service">
              <WeekdayToggles value={s.deliveryDays ?? []} onChange={(v) => set('deliveryDays', v)} />
            </Field>
            <Field label="Transit (jours de livraison)" error={fe.transitDays} hint="0 = jour même, vide = valeur du service">
              <OptNumberInput value={s.transitDays} onChange={(v) => set('transitDays', v)} step={1} invalid={!!fe.transitDays} ariaLabel="Transit" />
            </Field>
            <div className="grid grid-cols-2 gap-m">
              <Field label="Créneau début" error={fe.windowStart}>
                <TimeInput value={s.windowStart} onChange={(v) => set('windowStart', v)} invalid={!!fe.windowStart} label="Créneau début" />
              </Field>
              <Field label="Créneau fin" error={fe.windowEnd}>
                <TimeInput value={s.windowEnd} onChange={(v) => set('windowEnd', v)} invalid={!!fe.windowEnd} label="Créneau fin" />
              </Field>
            </div>
            <div className="flex items-end pb-s">
              <Switch checked={s.honorHolidays} onChange={(b) => set('honorHolidays', b)} label="Ni enlèvement ni livraison les jours fériés" />
            </div>
            <Field label="Jours de fermeture" className="sm:col-span-2" error={errorsStarting(fe, 'closedDates')[0]}>
              <DateChips value={s.closedDates ?? []} onChange={(v) => set('closedDates', v)} />
            </Field>
            <Field label="Grilles de coût du planning" className="sm:col-span-2" error={errorsStarting(fe, 'rateCardIds')[0]} hint="Remplacent les grilles du service et du transporteur (ex. Corse). Aucune = grilles du niveau précédent.">
              <RateCardChips cards={cards} carrierId={carrierId} value={s.rateCardIds ?? []} onChange={(v) => set('rateCardIds', v)} />
            </Field>
          </div>
          <FieldErrors
            messages={Object.entries(fe)
              .filter(([k]) => k && !/^(name|id|serviceIds|zones|pickupDays|cutoff|deliveryDays|transitDays|windowStart|windowEnd|closedDates|rateCardIds)\b/.test(k))
              .map(([k, m]) => `${k} : ${m}`)}
          />
          <Switch checked={s.active} onChange={(b) => set('active', b)} label={s.active ? 'Planning actif' : 'Planning inactif'} />
        </div>
      )}
    </li>
  );
}

function TimeInput({ value, onChange, invalid, label }: { value?: string; onChange: (v: string | undefined) => void; invalid?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-s">
      <input type="time" className={cx('input', invalid && 'invalid')} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />
      {value && (
        <button type="button" className="btn btn-tertiary btn-sm btn-icon" onClick={() => onChange(undefined)} title="Vider (valeur du service)" aria-label={`Vider ${label}`}>
          <IconClose />
        </button>
      )}
    </div>
  );
}

function DateChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [d, setD] = useState('');
  const add = () => {
    if (d && !value.includes(d)) onChange([...value, d].sort());
    setD('');
  };
  return (
    <div className="flex flex-col gap-m">
      <div className="flex items-center gap-m">
        <input type="date" className="input w-[180px]" value={d} onChange={(e) => setD(e.target.value)} aria-label="Date de fermeture" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!d} onClick={add}>
          <IconPlus /> Ajouter
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-s">
          {value.map((x) => (
            <span key={x} className="chip" aria-pressed="true">
              {x.split('-').reverse().join('/')}
              <button type="button" className="ml-xs inline-flex" onClick={() => onChange(value.filter((y) => y !== x))} aria-label={`Retirer ${x}`}>
                <IconClose size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview

function SchedulePreviewPanel({ carrier, services, dirty }: { carrier: Carrier; services: CarrierService[]; dirty: boolean }) {
  const preview = useSchedulePreview();
  const [serviceId, setServiceId] = useState('');
  const [postalCode, setPostalCode] = useState('75011');
  const [readyAt, setReadyAt] = useState(() => toLocalInput(new Date().toISOString()));
  useEffect(() => {
    if (!serviceId && services.length) setServiceId(services[0].id);
  }, [services, serviceId]);
  const r = preview.data;
  const schName = (id: string) => (carrier.schedules ?? []).find((s) => s.id === id)?.name ?? id;
  const fe = preview.error instanceof ApiError ? preview.error.byField : {};
  const run = () => preview.mutate({ carrierId: carrier.id, body: { serviceId, postalCode: postalCode.trim(), readyAt: fromLocalInput(readyAt) } });
  return (
    <section className="flex flex-col gap-m rounded-m border border-border p-l" data-testid="schedule-preview">
      <div>
        <div className="os-title-s">Tester un planning</div>
        <Hint>Calcule l'enlèvement et la livraison d'un colis avec les plannings enregistrés.</Hint>
      </div>
      {dirty && (
        <Alert kind="warning">Des modifications ne sont pas enregistrées : le test utilise la dernière version enregistrée.</Alert>
      )}
      <div className="grid items-end gap-l sm:grid-cols-[minmax(0,1fr)_140px_220px_auto]">
        <Field label="Service" error={fe.serviceId}>
          <select className={cx('select', fe.serviceId && 'invalid')} value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label="Service à tester">
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Code postal" error={fe.postalCode}>
          <input className={cx('input', fe.postalCode && 'invalid')} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} aria-label="Code postal" />
        </Field>
        <Field label="Colis prêt le" error={fe.readyAt}>
          <input type="datetime-local" className={cx('input', fe.readyAt && 'invalid')} value={readyAt} onChange={(e) => setReadyAt(e.target.value)} aria-label="Colis prêt le" />
        </Field>
        <button className="btn btn-primary" disabled={!serviceId || !postalCode || !readyAt || preview.isPending} onClick={run} data-testid="run-preview">
          {preview.isPending ? <Spinner size={16} className="text-white" /> : <IconPlay />}
          Tester
        </button>
      </div>
      {preview.error ? (
        <ErrorAlert error={preview.error} title={preview.error instanceof ApiError && preview.error.status === 404 ? 'Test indisponible (API non disponible)' : 'Test impossible'} />
      ) : null}
      {r && !preview.error && (
        <div className="grid gap-l rounded-m bg-[var(--surface-hover)] p-l sm:grid-cols-2" data-testid="preview-result">
          <div className="sm:col-span-2">
            <div className="field-label">Plannings appliqués</div>
            {(r.scheduleIds ?? []).length ? (
              <div className="flex flex-wrap items-center gap-s text-s">
                <span className="text-neutral-500">Service</span>
                {r.scheduleIds!.map((id) => (
                  <span key={id} className="inline-flex items-center gap-s">
                    <span className="text-neutral-500">→</span>
                    <Badge color="purple" title={id}>
                      {schName(id)}
                    </Badge>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-s">Aucun planning : valeurs du service</div>
            )}
          </div>
          <PreviewItem label="Enlèvement" value={`${fmtDays(r.pickupDays) || '–'}, cut-off ${r.cutoff || '–'}`} />
          <PreviewItem label="Départ" value={fmtDateTime(r.departure)} />
          <PreviewItem label="Livraison" value={`${r.transitDays === 0 ? 'Jour même' : `J+${r.transitDays}`}, ${fmtDays(r.deliveryDays) || '–'}`} />
          <PreviewItem label="Créneau de livraison" value={r.delivery ? fmtWindow(r.delivery.from, r.delivery.to) : '–'} strong />
          <div className="sm:col-span-2">
            <div className="field-label">Grilles de coût utilisées</div>
            {(r.rateCardIds ?? []).length ? (
              <div className="flex flex-wrap gap-s">
                {r.rateCardIds.map((id) => (
                  <Badge key={id} color="blue">
                    {id}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-s text-neutral-500">Aucune grille : coût de base et coût par kg du service</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className={cx('text-s', strong && 'font-medium')}>{value}</div>
    </div>
  );
}
