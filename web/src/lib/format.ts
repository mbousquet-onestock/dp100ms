// European formatting helpers (OneStock content rules: dd/mm/yyyy HH:MM, €12.50).

const TZ = 'Europe/Paris';

const dtf = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dmf = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const tf = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const wdf = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short' });

function toDate(v: string | Date | undefined | null): Date | null {
  if (!v) return null;
  const d = typeof v === 'string' ? new Date(v) : v;
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d;
}

/** 13/09/2024 17:58 */
export function fmtDateTime(v: string | Date | undefined | null): string {
  const d = toDate(v);
  return d ? dtf.format(d).replace(',', '') : '–';
}
/** 13/09/2024 */
export function fmtDate(v: string | Date | undefined | null): string {
  const d = toDate(v);
  return d ? df.format(d) : '–';
}
/** 17:58 */
export function fmtTime(v: string | Date | undefined | null): string {
  const d = toDate(v);
  return d ? tf.format(d) : '–';
}
/** 13/09 17:58 */
export function fmtShort(v: string | Date | undefined | null): string {
  const d = toDate(v);
  return d ? `${dmf.format(d)} ${tf.format(d)}` : '–';
}
export function fmtWeekday(v: string | Date | undefined | null): string {
  const d = toDate(v);
  return d ? wdf.format(d).replace('.', '') : '';
}

/** Promised window: "lun 12/10 14:00 – 20:00" or "12/10 14:00 – 13/10 09:00". */
export function fmtWindow(from: string, to: string): string {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return '–';
  const sameDay = dmf.format(a) === dmf.format(b);
  const day = `${fmtWeekday(a)} ${dmf.format(a)}`;
  return sameDay ? `${day} ${tf.format(a)} – ${tf.format(b)}` : `${day} ${tf.format(a)} – ${dmf.format(b)} ${tf.format(b)}`;
}

/** €17.98 (euro sign left, no space, two decimals). */
export function fmtMoney(v: number | undefined | null, currency = 'EUR'): string {
  if (v === undefined || v === null || isNaN(v)) return '–';
  const sign = v < 0 ? '-' : '';
  const sym = currency === 'EUR' ? '€' : currency + ' ';
  return `${sign}${sym}${Math.abs(v).toFixed(2)}`;
}

const nf = new Intl.NumberFormat('fr-FR');
export function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null || isNaN(v)) return '–';
  return nf.format(Math.round(v)).replace(/ | /g, ' ');
}

export function fmtNum(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || isNaN(v)) return '–';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(v)
    .replace(/ | /g, ' ');
}

/** Latency with adaptive precision: 0.42 ms, 4.2 ms, 42 ms. */
export function fmtMs(v: number | undefined | null): string {
  if (v === undefined || v === null || isNaN(v)) return '–';
  const digits = v < 1 ? 2 : v < 10 ? 1 : 0;
  return `${fmtNum(v, digits)} ms`;
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || isNaN(v)) return '–';
  return `${fmtNum(v * 100, digits)} %`;
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
  const h = Math.floor(sec / 3600);
  return `${h} h ${Math.floor((sec % 3600) / 60)} min`;
}

/** Converts an RFC 3339 date into a value for <input type="datetime-local"> in Paris time. */
export function toLocalInput(v: string | undefined | null): string {
  const d = toDate(v);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Offset of Europe/Paris at a given UTC instant, e.g. "+02:00". */
function parisOffset(utc: Date): string {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(utc).find((p) => p.type === 'timeZoneName')?.value;
  const m = s?.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+01:00';
}

/** Converts a datetime-local value (interpreted as Paris time) to RFC 3339. */
export function fromLocalInput(v: string): string {
  if (!v) return '';
  const base = v.length === 16 ? v + ':00' : v;
  const guess = new Date(base + 'Z');
  const off = parisOffset(new Date(guess.getTime() - 2 * 3600 * 1000));
  return base + off;
}
