import { useState } from 'react';
import { ApiError } from '../api/client';
import { useModes } from '../api/hooks';
import type { StockPoint } from '../api/types';
import { STOCK_POINT_TYPES } from '../api/types';
import { STOCK_POINT_TYPE_LABEL } from '../lib/labels';
import { ChipSelect, cx, ErrorAlert, Field, NumberInput, Spinner, Switch, WeekdayToggles } from './ui';

export const emptyStockPoint = (): StockPoint => ({
  id: '',
  name: '',
  type: 'STORE',
  address: { line1: '', postalCode: '', city: '', country: 'FR' },
  lat: 46.6,
  lon: 2.4,
  timezone: 'Europe/Paris',
  openingTime: '09:00',
  closingTime: '19:00',
  prepCalendar: { workingDays: [1, 2, 3, 4, 5, 6], honorHolidays: true },
  prepTimeMinutes: 120,
  cutoff: '16:00',
  dailyCapacity: 100,
  safetyStock: 1,
  allowedModes: ['STANDARD', 'EXPRESS', 'RELAY'],
  prepCostPerParcel: 2.5,
  active: true,
});

export function StockPointForm({ initial, isNew, onSubmit, pending, error, submitLabel = 'Enregistrer' }: { initial: StockPoint; isNew?: boolean; onSubmit: (v: StockPoint) => void; pending?: boolean; error?: unknown; submitLabel?: string }) {
  const [v, setV] = useState<StockPoint>(initial);
  const modes = useModes();
  const fe = error instanceof ApiError ? error.byField : {};
  const set = <K extends keyof StockPoint>(k: K, val: StockPoint[K]) => setV((x) => ({ ...x, [k]: val }));
  const setAddr = (k: keyof StockPoint['address'], val: string) => setV((x) => ({ ...x, address: { ...x.address, [k]: val } }));
  const err = (k: string) => fe[k];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="flex flex-col gap-l"
      noValidate
    >
      {error ? <ErrorAlert error={error} title="Enregistrement impossible" /> : null}
      <div className="grid gap-l sm:grid-cols-2">
        <Field label="Identifiant" error={err('id')}>
          <input className={cx('input', err('id') && 'invalid')} value={v.id} disabled={!isNew} onChange={(e) => set('id', e.target.value)} placeholder="STORE-200" />
        </Field>
        <Field label="Nom" error={err('name')}>
          <input className={cx('input', err('name') && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Type" error={err('type')}>
          <select className={cx('select', err('type') && 'invalid')} value={v.type} onChange={(e) => set('type', e.target.value as StockPoint['type'])}>
            {STOCK_POINT_TYPES.map((t) => (
              <option key={t} value={t}>
                {STOCK_POINT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Statut">
          <div className="flex h-control items-center">
            <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Actif' : 'Inactif'} />
          </div>
        </Field>
        <Field label="Adresse" className="sm:col-span-2">
          <input className="input" value={v.address.line1} onChange={(e) => setAddr('line1', e.target.value)} />
        </Field>
        <Field label="Code postal" error={err('address.postalCode')}>
          <input className={cx('input', err('address.postalCode') && 'invalid')} value={v.address.postalCode} onChange={(e) => setAddr('postalCode', e.target.value)} inputMode="numeric" maxLength={5} />
        </Field>
        <Field label="Ville">
          <input className="input" value={v.address.city} onChange={(e) => setAddr('city', e.target.value)} />
        </Field>
        <Field label="Latitude" error={err('lat/lon')}>
          <NumberInput value={v.lat} step={0.0001} onChange={(n) => set('lat', n)} invalid={!!err('lat/lon')} />
        </Field>
        <Field label="Longitude" error={err('lat/lon')}>
          <NumberInput value={v.lon} step={0.0001} onChange={(n) => set('lon', n)} invalid={!!err('lat/lon')} />
        </Field>
        <Field label="Ouverture">
          <input type="time" className="input" value={v.openingTime} onChange={(e) => set('openingTime', e.target.value)} />
        </Field>
        <Field label="Fermeture" error={err('closingTime')}>
          <input type="time" className={cx('input', err('closingTime') && 'invalid')} value={v.closingTime} onChange={(e) => set('closingTime', e.target.value)} />
        </Field>
        <Field label="Heure limite de commande (cut-off)">
          <input type="time" className="input" value={v.cutoff} onChange={(e) => set('cutoff', e.target.value)} />
        </Field>
        <Field label="Temps de préparation (min)" error={err('prepTimeMinutes')}>
          <NumberInput value={v.prepTimeMinutes} onChange={(n) => set('prepTimeMinutes', n)} invalid={!!err('prepTimeMinutes')} />
        </Field>
        <Field label="Capacité journalière (commandes)">
          <NumberInput value={v.dailyCapacity} onChange={(n) => set('dailyCapacity', n)} />
        </Field>
        <Field label="Stock de sécurité (unités par SKU)" error={err('safetyStock')}>
          <NumberInput value={v.safetyStock} onChange={(n) => set('safetyStock', n)} invalid={!!err('safetyStock')} />
        </Field>
        <Field label="Coût de préparation par colis (€)">
          <NumberInput value={v.prepCostPerParcel} step={0.01} onChange={(n) => set('prepCostPerParcel', n)} />
        </Field>
        <Field label="Fuseau horaire">
          <input className="input" value={v.timezone} onChange={(e) => set('timezone', e.target.value)} />
        </Field>
        <Field label="Jours de préparation" error={err('prepCalendar.workingDays')} className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-l">
            <WeekdayToggles value={v.prepCalendar.workingDays} onChange={(d) => set('prepCalendar', { ...v.prepCalendar, workingDays: d })} />
            <Switch checked={v.prepCalendar.honorHolidays} onChange={(b) => set('prepCalendar', { ...v.prepCalendar, honorHolidays: b })} label="Fermé les jours fériés" />
          </div>
        </Field>
        <Field label="Modes de livraison autorisés" error={Object.entries(fe).find(([k]) => k.startsWith('allowedModes'))?.[1]} className="sm:col-span-2">
          <ChipSelect options={(modes.data?.items ?? []).map((m) => m.id)} value={v.allowedModes ?? []} onChange={(m) => set('allowedModes', m)} />
        </Field>
      </div>
      <div className="flex justify-end gap-m border-t border-border pt-l">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending && <Spinner size={16} className="text-white" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
