import type { ReactNode } from 'react';
import { ApiError } from '../../api/client';
import type { Carrier, DeliverySchedule, RateCard } from '../../api/types';
import { RATE_SCOPE_LABEL, WEEKDAYS } from '../../lib/labels';
import { ChipSelect } from '../ui';

const DAY_ABBR: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam', 7: 'Dim' };

/** "Lun–Ven", "Lun–Mer, Ven", "Sam". */
export function fmtDays(days: number[] | undefined): string {
  const d = Array.from(new Set(days ?? [])).sort((a, b) => a - b);
  if (!d.length) return '';
  if (d.length === 7) return 'Tous les jours';
  const runs: [number, number][] = [];
  for (const n of d) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs
    .map(([a, b]) => (a === b ? DAY_ABBR[a] : b === a + 1 ? `${DAY_ABBR[a]}, ${DAY_ABBR[b]}` : `${DAY_ABBR[a]}–${DAY_ABBR[b]}`))
    .join(', ');
}

export const WEEKDAY_LONG = (n: number) => WEEKDAYS.find((w) => w.n === n)?.long ?? String(n);

/** Layer of a schedule: carrier-wide, service, zone or service + zone. */
export type ScheduleLevel = 'carrier' | 'service' | 'zone' | 'service-zone';
export function scheduleLevel(s: DeliverySchedule): ScheduleLevel {
  const sv = (s.serviceIds ?? []).length > 0;
  const zn = (s.zones ?? []).length > 0;
  return sv && zn ? 'service-zone' : sv ? 'service' : zn ? 'zone' : 'carrier';
}
export const LEVEL_LABEL: Record<ScheduleLevel, string> = {
  carrier: 'Transporteur',
  service: 'Service',
  zone: 'Zone',
  'service-zone': 'Service + zone',
};

/** Readable summary: "Lun–Ven, cut-off 17:00 → livraison J+2 Lun–Sam 09:00–18:00". */
export function scheduleSummary(s: DeliverySchedule): string {
  const pick = [fmtDays(s.pickupDays), s.cutoff ? `cut-off ${s.cutoff}` : ''].filter(Boolean).join(', ');
  const transit = s.transitDays === undefined || s.transitDays === null ? '' : s.transitDays === 0 ? 'jour même' : `J+${s.transitDays}`;
  const win = s.windowStart || s.windowEnd ? `${s.windowStart || '…'}–${s.windowEnd || '…'}` : '';
  const del = [transit, fmtDays(s.deliveryDays), win].filter(Boolean).join(' ');
  const left = pick || 'enlèvement du service';
  const right = del ? `livraison ${del}` : 'livraison du service';
  return `${left} → ${right}`.replace(/^./, (c) => c.toUpperCase());
}

/** Field errors "prefix.field" → { field: message } for one object of a list. */
export function errorsFor(err: unknown, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(err instanceof ApiError)) return out;
  for (const f of err.fieldErrors) {
    if (f.field === prefix) out[''] ??= f.message;
    else if (f.field.startsWith(prefix + '.')) out[f.field.slice(prefix.length + 1)] ??= f.message;
  }
  return out;
}

/** Messages whose key is `key` or `key[...]`. */
export function errorsStarting(fe: Record<string, string>, key: string): string[] {
  return Object.entries(fe)
    .filter(([k]) => k === key || k.startsWith(key + '[') || k.startsWith(key + '.'))
    .map(([, m]) => m);
}

export function FieldErrors({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <>
      {messages.map((m, i) => (
        <div key={i} className="field-error">
          {m}
        </div>
      ))}
    </>
  );
}

/** Cost grids (PARCEL / SHIPMENT) of the carrier first, then the others. */
export function RateCardChips({ cards, carrierId, value, onChange, testId }: { cards: RateCard[]; carrierId: string; value: string[]; onChange: (v: string[]) => void; testId?: string }) {
  const options = cards
    .filter((c) => c.scope !== 'ORDER' && (c.carrierId === carrierId || !c.carrierId || value.includes(c.id)))
    .sort((a, b) => Number(b.carrierId === carrierId) - Number(a.carrierId === carrierId) || a.id.localeCompare(b.id))
    .map((c) => c.id);
  // keep unknown ids visible so they can be removed
  for (const id of value) if (!options.includes(id)) options.push(id);
  if (!options.length) return <div className="text-xs text-neutral-500">Aucune grille colis ou expédition disponible.</div>;
  return (
    <div data-testid={testId}>
      <ChipSelect
        options={options}
        value={value}
        onChange={onChange}
        renderLabel={(id) => {
          const c = cards.find((x) => x.id === id);
          return (
            <span title={c?.name}>
              {id} <span className="font-normal text-neutral-500">· {c ? RATE_SCOPE_LABEL[c.scope] ?? c.scope : 'introuvable'}</span>
            </span>
          );
        }}
      />
    </div>
  );
}

/** Carrier payload without empty optional lists. */
export function cleanCarrier(c: Carrier): Carrier {
  const opt = <T,>(a: T[] | undefined) => (a && a.length ? a : undefined);
  return {
    ...c,
    rateCardIds: opt(c.rateCardIds),
    restrictions: opt(c.restrictions),
    logoUrl: c.logoUrl || undefined,
    schedules: opt(
      (c.schedules ?? []).map((s) => ({
        ...s,
        serviceIds: opt(s.serviceIds),
        zones: opt(s.zones),
        pickupDays: opt(s.pickupDays),
        cutoff: s.cutoff || undefined,
        deliveryDays: opt(s.deliveryDays),
        transitDays: s.transitDays === null || s.transitDays === undefined || Number.isNaN(s.transitDays) ? undefined : s.transitDays,
        windowStart: s.windowStart || undefined,
        windowEnd: s.windowEnd || undefined,
        closedDates: opt(s.closedDates),
        rateCardIds: opt(s.rateCardIds),
      })),
    ),
  };
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs text-neutral-500">{children}</p>;
}
