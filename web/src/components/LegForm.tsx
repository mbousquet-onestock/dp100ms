import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { useCarriers, useModes, useRateCards, useServices } from '../api/hooks';
import { RestrictionsEditor } from './pricing/RuleBuilder';
import { RATE_SCOPE_LABEL } from '../lib/labels';
import type { Leg } from '../api/types';
import { ChipSelect, ConfirmButton, cx, Drawer, ErrorAlert, Field, ListInput, NumberInput, Spinner, Switch } from './ui';

export const newLeg = (from: string, to: string): Leg => ({
  id: `LEG-${Date.now().toString().slice(-6)}`,
  from,
  to,
  carrierId: '',
  serviceId: '',
  departures: ['17:00'],
  cutoffMinutesBefore: 30,
  transitMinutes: 0,
  destinationZones: [],
  extraCost: 0,
  modes: [],
  active: true,
});

export function LegDrawer({
  state,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
  error,
  nodeName,
}: {
  state: { leg: Leg; isNew: boolean } | null;
  onClose: () => void;
  onSave: (l: Leg, isNew: boolean) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  deleting: boolean;
  error: unknown;
  nodeName: (id: string) => string;
}) {
  const [v, setV] = useState<Leg | null>(null);
  const carriers = useCarriers();
  const services = useServices(v?.carrierId || undefined);
  const modes = useModes();
  const cards = useRateCards();
  useEffect(() => {
    if (state) setV({ ...state.leg, destinationZones: state.leg.destinationZones ?? [], modes: state.leg.modes ?? [] });
  }, [state]);
  if (!v || !state) return null;
  const fe = error instanceof ApiError ? error.byField : {};
  const set = <K extends keyof Leg>(k: K, val: Leg[K]) => setV((x) => (x ? { ...x, [k]: val } : x));
  const svcList = (services.data?.items ?? []).filter((s) => !v.carrierId || s.carrierId === v.carrierId);
  const toCustomer = v.to === 'CUSTOMER';
  const clean = (): Leg => ({
    ...v,
    destinationZones: v.destinationZones?.length ? v.destinationZones : undefined,
    modes: v.modes?.length ? v.modes : undefined,
    transitMinutes: v.transitMinutes || undefined,
    rateCardIds: v.rateCardIds?.length ? v.rateCardIds : undefined,
    restrictions: v.restrictions?.length ? v.restrictions : undefined,
  });
  const svc = svcList.find((s) => s.id === v.serviceId);
  return (
    <Drawer
      open
      onClose={onClose}
      title={state.isNew ? 'Nouveau leg' : `Leg ${v.id}`}
      width={600}
      footer={
        <>
          {!state.isNew && (
            <div className="mr-auto">
              <ConfirmButton onConfirm={() => onDelete(v.id)} pending={deleting} label="Supprimer le leg" small={false} />
            </div>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(clean(), state.isNew)} data-testid="save-leg">
            {saving && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {error ? <ErrorAlert error={error} title="Enregistrement impossible" /> : null}
        <div className="rounded-m border border-border bg-neutral-20 px-l py-m text-s">
          <span className="font-medium">{nodeName(v.from)}</span>
          <span className="mx-m text-neutral-500">→</span>
          <span className="font-medium">{nodeName(v.to)}</span>
          {fe.from && <div className="field-error">Origine : {fe.from}</div>}
          {fe.to && <div className="field-error">Destination : {fe.to}</div>}
        </div>
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe.id}>
            <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state.isNew} onChange={(e) => set('id', e.target.value)} />
          </Field>
          <Field label="Statut">
            <div className="flex h-control items-center">
              <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Actif' : 'Inactif'} />
            </div>
          </Field>
          <Field label="Transporteur" error={fe.carrierId}>
            <select className={cx('select', fe.carrierId && 'invalid')} value={v.carrierId} onChange={(e) => setV({ ...v, carrierId: e.target.value, serviceId: '' })} data-testid="leg-carrier">
              <option value="">Choisir</option>
              {(carriers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service" error={fe.serviceId}>
            <select className={cx('select', fe.serviceId && 'invalid')} value={v.serviceId} onChange={(e) => set('serviceId', e.target.value)} disabled={!v.carrierId} data-testid="leg-service">
              <option value="">Choisir</option>
              {svcList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.kind})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Départs (HH:MM)" hint="Séparés par des virgules" className="sm:col-span-2" error={fe.departures}>
            <ListInput value={v.departures} onChange={(d) => set('departures', d)} placeholder="12:00, 17:30" invalid={!!fe.departures} />
          </Field>
          <Field label="Délai avant départ (min)" hint="Colis prêts avant chaque départ" error={fe.minutes}>
            <NumberInput value={v.cutoffMinutesBefore} min={0} onChange={(n) => set('cutoffMinutesBefore', n)} invalid={!!fe.minutes} />
          </Field>
          <Field label="Transit (min)" hint="Remplace le transit du service (legs vers hub)">
            <NumberInput value={v.transitMinutes} min={0} onChange={(n) => set('transitMinutes', n)} />
          </Field>
          <Field label="Surcoût (€)">
            <NumberInput value={v.extraCost} step={0.01} onChange={(n) => set('extraCost', n)} />
          </Field>
          <Field label="Poids max (kg)" hint="0 = limite du service">
            <NumberInput value={v.maxWeightKg ?? 0} min={0} onChange={(n) => set('maxWeightKg', n || undefined)} />
          </Field>
          {toCustomer && (
            <>
              <Field label="Zones de destination (départements)" hint="Vide = couverture du service" className="sm:col-span-2">
                <ListInput value={v.destinationZones} onChange={(d) => set('destinationZones', d)} placeholder="69, 01, 38" />
              </Field>
              <Field label="Modes (remplacent ceux du service)" className="sm:col-span-2" error={Object.entries(fe).find(([k]) => k.startsWith('modes'))?.[1]}>
                <ChipSelect options={(modes.data?.items ?? []).map((m) => m.id)} value={v.modes ?? []} onChange={(m) => set('modes', m)} />
              </Field>
            </>
          )}
        </div>
        <div>
          <div className="os-title-s mb-s">Grilles tarifaires du leg</div>
          <p className="m-0 mb-m text-xs text-neutral-500">
            Remplacent les grilles du service pour ce segment.{' '}
            {svc && ((svc.rateCardIds ?? []).length ? `Grilles du service : ${svc.rateCardIds!.join(', ')}.` : 'Le service n’a pas de grille : coût de base + coût par kg.')}
          </p>
          <ChipSelect
            options={(cards.data?.items ?? [])
              .filter((c) => c.scope !== 'ORDER')
              .sort((a, b) => Number(b.carrierId === v.carrierId) - Number(a.carrierId === v.carrierId))
              .map((c) => c.id)}
            value={v.rateCardIds ?? []}
            onChange={(x) => set('rateCardIds', x)}
            renderLabel={(id) => {
              const c = cards.data?.items.find((x) => x.id === id);
              return (
                <span title={c?.name}>
                  {id} <span className="font-normal text-neutral-500">· {RATE_SCOPE_LABEL[c?.scope ?? ''] ?? ''}</span>
                </span>
              );
            }}
          />
          {Object.entries(fe).filter(([k]) => k.startsWith('rateCardIds')).map(([k, msg]) => (
            <div key={k} className="field-error">{msg}</div>
          ))}
        </div>
        <div>
          <div className="os-title-s mb-s">Restrictions articles du leg</div>
          <p className="m-0 mb-m text-xs text-neutral-500">S'ajoutent aux restrictions du service.</p>
          <RestrictionsEditor value={v.restrictions} onChange={(x) => set('restrictions', x)} errors={fe} />
        </div>
      </div>
    </Drawer>
  );
}
