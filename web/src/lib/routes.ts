import type { CarrierRoute, Hub, Range, RateCard, RouteDay, StockPoint, Zone } from '../api/types';

/** Variables expressed in kilograms (displayed in g or kg in the route grid). */
export const WEIGHT_VARS = new Set(['weightKg', 'volumetricWeightKg', 'chargeableWeightKg']);

/** Short column titles of the condition variables in the route grid. */
export const COND_SHORT: Record<string, string> = {
  weightKg: 'Poids réel',
  volumetricWeightKg: 'Poids volumétrique',
  chargeableWeightKg: 'Poids taxable',
  lengthCm: 'Longueur',
  widthCm: 'Largeur',
  heightCm: 'Hauteur',
  girthCm: 'Longueur + pourtour',
  sumDimensionsCm: 'Somme des dimensions',
  volumeL: 'Volume',
  itemCount: 'Articles',
  parcelCount: 'Colis',
  orderAmount: 'Montant commande',
  goodsValue: 'Valeur marchandises',
  distanceKm: 'Distance',
  legs: 'Legs',
  transitDays: 'Transit',
};

/** Unit of a condition variable. */
export function condUnit(v: string, weightUnit: 'g' | 'kg'): string {
  if (WEIGHT_VARS.has(v)) return weightUnit;
  if (v.endsWith('Cm')) return 'cm';
  if (v === 'volumeL') return 'L';
  if (v === 'orderAmount' || v === 'goodsValue') return '€';
  if (v === 'distanceKm') return 'km';
  if (v === 'transitDays') return 'j';
  return '';
}

/** Factor from the API value to the displayed value. */
export const condFactor = (v: string, weightUnit: 'g' | 'kg') => (WEIGHT_VARS.has(v) && weightUnit === 'g' ? 1000 : 1);

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
export const fmtN = (n: number) => nf.format(n).replace(/[  ]/g, ' ');

/** "≥ 500 g | < 1 000 g", "< 1 000 g", "-" (ranges are [min, max)). */
export function fmtRange(r: Range | undefined, unit: string, factor = 1): string {
  if (!r || (r.min === undefined && r.max === undefined)) return '-';
  const u = unit ? ` ${unit}` : '';
  const parts: string[] = [];
  if (r.min !== undefined && r.min !== 0) parts.push(`≥ ${fmtN(r.min * factor)}${u}`);
  if (r.max !== undefined) parts.push(`< ${fmtN(r.max * factor)}${u}`);
  if (!parts.length) return `≥ 0${u}`;
  return parts.join(' | ');
}

/** "12 h", "1 j 12 h", "2 j". */
export function fmtHours(h: number): string {
  if (!h) return '0 h';
  const d = Math.floor(h / 24);
  const r = h % 24;
  if (!d) return `${r} h`;
  return r ? `${d} j ${r} h` : `${d} j`;
}

export const fmtEur = (n: number) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n).replace(/[  ]/g, ' ')} €`;

/** Min and max of the fixed transport costs of a grid (null without cost). */
export function costRange(card: RateCard | undefined, key = 'cost'): { min: number; max: number; variable: boolean } | null {
  if (!card) return null;
  let min = Infinity;
  let max = -Infinity;
  let variable = false;
  for (const r of card.rows ?? []) {
    const c = r.outputs?.[key];
    if (!c) continue;
    const v = c.fixed ?? 0;
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (c.perKg || c.perItem || c.perParcel || c.perKm || c.perKgKm || c.percentOfValue || Object.keys(c.perUnit ?? {}).length) variable = true;
  }
  return min === Infinity ? null : { min, max, variable };
}

export function fmtCostRange(card: RateCard | undefined): string {
  const r = costRange(card);
  if (!r) return '–';
  const s = r.min === r.max ? fmtEur(r.min) : `${fmtEur(r.min)} → ${fmtEur(r.max)}`;
  return r.variable ? `${s} + variable` : s;
}

/** "HH:MM" → minutes after midnight. */
export const toMin = (t: string | undefined) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const DAY_LONG = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Days 1..7 (missing days are empty). */
export function fullWeek(days: RouteDay[] | undefined): RouteDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((n) => days?.find((d) => d.weekday === n) ?? { weekday: n });
}

/** Route payload without empty optional values. */
export function cleanRoute(r: CarrierRoute, costs: RateCard | undefined): CarrierRoute {
  const opt = <T,>(a: T[] | undefined) => (a && a.length ? a : undefined);
  const meta = Object.fromEntries(Object.entries(r.metadata ?? {}).filter(([k]) => k.trim()));
  const pl = r.planning;
  return {
    ...r,
    name: r.name || undefined,
    costs,
    restrictions: opt(r.restrictions),
    metadata: Object.keys(meta).length ? meta : undefined,
    planning: pl
      ? {
          timezone: pl.timezone || undefined,
          honorHolidays: pl.honorHolidays,
          closedDates: opt(pl.closedDates),
          days: pl.days
            .map((d) => ({
              weekday: d.weekday,
              pickups: opt([...(d.pickups ?? [])].filter(Boolean).sort()),
              deliveryStart: d.deliveryStart || undefined,
              deliveryEnd: d.deliveryEnd || undefined,
            }))
            .filter((d) => d.pickups || d.deliveryStart || d.deliveryEnd),
        }
      : undefined,
  };
}

/** "France métropolitaine", "75, 92, 93 (+5)". */
export function zoneSummary(z: Zone): string {
  const parts: string[] = [];
  const d = z.departments ?? [];
  const ex = z.excludedDepartments ?? [];
  const sauf = ex.length ? ` sauf ${ex.slice(0, 6).join(', ')}${ex.length > 6 ? ` (+${ex.length - 6})` : ''}` : '';
  if (d.includes('*')) parts.push(`France métropolitaine${sauf}`);
  else if (d.length) parts.push(`Dép. ${d.slice(0, 6).join(', ')}${d.length > 6 ? ` (+${d.length - 6})` : ''}${sauf}`);
  else if (ex.length) parts.push(`Exclus : ${ex.join(', ')}`);
  if (z.postalCodes?.length) parts.push(`CP ${z.postalCodes.slice(0, 4).join(', ')}${z.postalCodes.length > 4 ? '…' : ''}`);
  if (z.stockPointIds?.length) parts.push(`${z.stockPointIds.length} point${z.stockPointIds.length > 1 ? 's' : ''} de stock`);
  return parts.join(' · ') || '–';
}


export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

const deptOf = (pc: string) => (pc.length < 2 ? pc : pc.startsWith('97') && pc.length >= 3 ? pc.slice(0, 3) : pc.slice(0, 2));
const overseas = (pc: string) => pc.startsWith('97') || pc.startsWith('98');

/** Same rule as the engine: excluded departments win, then "*" (metropolitan France), departments and postal code prefixes. */
export function zoneContainsPostalCode(z: Zone, pc: string): boolean {
  if (!pc) return false;
  const d = deptOf(pc);
  if ((z.excludedDepartments ?? []).includes(d)) return false;
  const depts = z.departments ?? [];
  if (depts.includes('*') && !overseas(pc)) return true;
  if (pc.length >= 2 && depts.includes(d)) return true;
  return (z.postalCodes ?? []).some((p) => pc.startsWith(p));
}

/** Active stock points of a zone: the shipping points of the routes leaving it. */
export function zoneStockPoints(z: Zone | undefined, points: StockPoint[]): StockPoint[] {
  if (!z) return [];
  const ids = new Set(z.stockPointIds ?? []);
  return points.filter((sp) => sp.active && (ids.has(sp.id) || zoneContainsPostalCode(z, sp.address?.postalCode ?? '')));
}

export interface ShippingSite {
  id: string;
  name: string;
  kind: 'STOCK_POINT' | 'HUB';
  type: string;
  postalCode: string;
  city: string;
}

/**
 * Sites able to ship on a route leaving the zone (same rule as the engine):
 * active stock points of the zone, plus hubs / platforms named explicitly in
 * the zone's stock point list.
 */
export function zoneShippingSites(z: Zone | undefined, points: StockPoint[], hubs: Hub[]): ShippingSite[] {
  if (!z) return [];
  const ids = new Set(z.stockPointIds ?? []);
  const out: ShippingSite[] = zoneStockPoints(z, points).map((sp) => ({ id: sp.id, name: sp.name, kind: 'STOCK_POINT', type: sp.type, postalCode: sp.address?.postalCode ?? '', city: sp.address?.city ?? '' }));
  const seen = new Set(out.map((x) => x.id));
  for (const h of hubs) {
    if (!h.active || !ids.has(h.id) || seen.has(h.id) || (h.stockPointId && seen.has(h.stockPointId))) continue;
    out.push({ id: h.id, name: h.name, kind: 'HUB', type: h.kind, postalCode: h.postalCode, city: h.city });
  }
  return out;
}
