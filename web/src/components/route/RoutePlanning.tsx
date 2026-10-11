import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useAllStockPoints, useHubs, useSchedulePreview, useSettings } from '../../api/hooks';
import type { RouteDay, RoutePlanning as Planning } from '../../api/types';
import { fmtDateTime, fmtWindow, fromLocalInput, toLocalInput } from '../../lib/format';
import { DAY_LONG, fmtHours, fullWeek, toMin } from '../../lib/routes';
import { IconClose, IconCopy, IconPlay, IconPlus, IconTrash } from '../Icons';
import { Alert, Badge, cx, EmptyState, ErrorAlert, Field, ListInput, Modal, Spinner, Switch } from '../ui';

const HOUR_H = 26;

export const defaultPlanning = (timezone = 'Europe/Paris'): Planning => ({
  timezone,
  honorHolidays: true,
  closedDates: [],
  days: [1, 2, 3, 4, 5, 6].map((n) => ({ weekday: n, pickups: n <= 5 ? ['18:00'] : [], deliveryStart: '09:00', deliveryEnd: '18:00' })),
});

/** Errors of the planning ("planning.days[1].weekday" → by weekday, using the days sent). */
export interface PlanningErrors {
  byDay: Record<number, string[]>;
  general: string[];
}

export function RoutePlanningEditor({ value, onChange, errors }: { value: Planning | undefined; onChange: (p: Planning | undefined) => void; errors: PlanningErrors }) {
  const settings = useSettings();
  const tz = settings.data?.timezone || 'Europe/Paris';
  const [editDay, setEditDay] = useState<number | null>(null);
  if (!value)
    return (
      <EmptyState title="Pas de planning sur cette route">
        <p className="m-0 mb-l">Les plannings du transporteur et les calendriers du service s'appliquent.</p>
        <button className="btn btn-primary" onClick={() => onChange(defaultPlanning(tz))} data-testid="create-planning">
          <IconPlus /> Créer un planning
        </button>
      </EmptyState>
    );
  const week = fullWeek(value.days);
  const setDay = (d: RouteDay) => onChange({ ...value, days: fullWeek(value.days).map((x) => (x.weekday === d.weekday ? d : x)) });
  const copyTo = (from: RouteDay, targets: number[]) =>
    onChange({ ...value, days: fullWeek(value.days).map((x) => (targets.includes(x.weekday) ? { ...from, pickups: [...(from.pickups ?? [])], weekday: x.weekday } : x)) });
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="flex flex-col gap-xl" data-testid="route-planning">
      <div className="grid gap-l sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <Field label="Fuseau horaire" hint="Seul le fuseau du déploiement est pris en charge" error={errors.general.find((m) => m.startsWith('timezone'))}>
          <select className="select" value={value.timezone || tz} onChange={(e) => onChange({ ...value, timezone: e.target.value })} aria-label="Fuseau horaire">
            <option value={tz}>{tz}</option>
          </select>
        </Field>
        <div className="flex flex-wrap items-end gap-l">
          <Switch checked={value.honorHolidays} onChange={(b) => onChange({ ...value, honorHolidays: b })} label="Jours fériés respectés (ni enlèvement ni livraison)" />
        </div>
      </div>

      <div>
        <div className="mb-s flex flex-wrap items-center gap-l text-xs text-neutral-700">
          <span className="inline-flex items-center gap-s">
            <span className="inline-block h-[10px] w-[16px] rounded-s" style={{ background: 'var(--blue-t-100)', borderLeft: '3px solid var(--blue-1000)' }} /> Créneau de livraison
          </span>
          <span className="inline-flex items-center gap-s">
            <span className="inline-block h-[10px] w-[16px] rounded-s" style={{ background: 'var(--orange-1000)' }} /> Enlèvement
          </span>
          <span className="text-neutral-500">Cliquer sur un jour pour le modifier.</span>
        </div>
        <div className="overflow-x-auto rounded-m border border-border">
          <div className="min-w-[760px]" data-testid="planning-calendar">
            {/* header */}
            <div className="grid border-b border-border" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              <div />
              {week.map((d) => (
                <button
                  key={d.weekday}
                  type="button"
                  className={cx('border-l border-border px-s py-m text-center text-s font-medium hover:bg-neutral-30', !!errors.byDay[d.weekday]?.length && 'text-[var(--red-1000)]')}
                  onClick={() => setEditDay(d.weekday)}
                  data-testid={`day-header-${d.weekday}`}
                >
                  {DAY_LONG[d.weekday]}
                </button>
              ))}
            </div>
            <div className="grid border-b border-border" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              <div />
              <div className="col-span-7 m-xs rounded-s px-m py-xs text-xs font-medium text-white" style={{ background: 'var(--primary-1000)' }}>
                Heures d'activité
              </div>
            </div>
            {/* body */}
            <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
              <div className="relative" style={{ height: 24 * HOUR_H }}>
                {hours.map((h) => (
                  <div key={h} className="absolute right-s text-2xs text-neutral-500" style={{ top: h * HOUR_H - 6 }}>
                    {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                  </div>
                ))}
              </div>
              {week.map((d) => {
                const hasSlot = d.deliveryStart && d.deliveryEnd;
                const s = toMin(d.deliveryStart);
                const e = toMin(d.deliveryEnd);
                return (
                  <div
                    key={d.weekday}
                    role="button"
                    tabIndex={0}
                    aria-label={`Modifier ${DAY_LONG[d.weekday]}`}
                    onClick={() => setEditDay(d.weekday)}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && setEditDay(d.weekday)}
                    className={cx('relative cursor-pointer border-l border-border hover:bg-neutral-20', !!errors.byDay[d.weekday]?.length && 'bg-red-tint')}
                    style={{ height: 24 * HOUR_H, backgroundImage: `repeating-linear-gradient(to bottom, var(--border-primary) 0, var(--border-primary) 1px, transparent 1px, transparent ${HOUR_H}px)` }}
                    data-testid={`day-col-${d.weekday}`}
                  >
                    {hasSlot && e > s && (
                      <div
                        className="absolute left-xs right-xs overflow-hidden rounded-s px-s py-xs text-xs"
                        style={{ top: (s / 60) * HOUR_H + 1, height: Math.max(((e - s) / 60) * HOUR_H - 2, 18), background: 'var(--blue-t-100)', borderLeft: '3px solid var(--blue-1000)', color: '#1c78c6' }}
                        data-testid="delivery-block"
                      >
                        <div className="font-medium">Livraison</div>
                        <div>
                          {d.deliveryStart} - {d.deliveryEnd}
                        </div>
                      </div>
                    )}
                    {(d.pickups ?? []).map((p, i) => (
                      <div
                        key={i}
                        className="absolute left-m right-m z-[1] truncate rounded-s px-s text-2xs font-medium leading-[18px] text-white"
                        style={{ top: Math.min((toMin(p) / 60) * HOUR_H - 9, 24 * HOUR_H - 18), height: 18, background: 'var(--orange-1000)' }}
                        title={`Enlèvement ${p}`}
                        data-testid="pickup-chip"
                      >
                        Enlèvement {p}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Field label="Dates fermées (AAAA-MM-JJ)" hint="Ni enlèvement ni livraison ces jours-là, séparées par des virgules" error={errors.general.find((m) => m.startsWith('closedDates'))?.replace(/^closedDates\S*\s*:\s*/, '')}>
        <ListInput value={value.closedDates} onChange={(x) => onChange({ ...value, closedDates: x })} placeholder="2026-12-24, 2026-12-31" />
      </Field>
      {errors.general.filter((m) => !m.startsWith('timezone') && !m.startsWith('closedDates')).map((m) => (
        <div key={m} className="field-error">
          {m}
        </div>
      ))}
      <div>
        <button className="btn btn-tertiary-red btn-sm" onClick={() => onChange(undefined)}>
          <IconTrash /> Retirer le planning de la route
        </button>
      </div>

      {editDay !== null && (
        <DayModal
          day={week.find((d) => d.weekday === editDay)!}
          errors={errors.byDay[editDay] ?? []}
          onChange={setDay}
          onCopy={(targets) => copyTo(week.find((d) => d.weekday === editDay)!, targets)}
          onClose={() => setEditDay(null)}
        />
      )}
    </div>
  );
}

function DayModal({ day, errors, onChange, onCopy, onClose }: { day: RouteDay; errors: string[]; onChange: (d: RouteDay) => void; onCopy: (targets: number[]) => void; onClose: () => void }) {
  const hasSlot = !!(day.deliveryStart || day.deliveryEnd);
  const pickups = day.pickups ?? [];
  const [copied, setCopied] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={DAY_LONG[day.weekday]}
      width={460}
      footer={
        <button className="btn btn-primary" onClick={onClose} data-testid="close-day">
          Fermer
        </button>
      }
    >
      <div className="flex flex-col gap-l" data-testid="day-editor">
        {errors.map((m) => (
          <Alert key={m} kind="error">
            {m}
          </Alert>
        ))}
        <div>
          <div className="mb-m flex items-center justify-between">
            <span className="os-title-s">Créneau de livraison</span>
            <Switch checked={hasSlot} onChange={(b) => onChange({ ...day, deliveryStart: b ? '09:00' : undefined, deliveryEnd: b ? '18:00' : undefined })} label={hasSlot ? 'Livraison' : 'Pas de livraison'} />
          </div>
          {hasSlot && (
            <div className="grid grid-cols-2 gap-m">
              <Field label="Début">
                <input type="time" className="input" value={day.deliveryStart ?? ''} onChange={(e) => onChange({ ...day, deliveryStart: e.target.value })} aria-label="Début du créneau" />
              </Field>
              <Field label="Fin">
                <input type="time" className="input" value={day.deliveryEnd ?? ''} onChange={(e) => onChange({ ...day, deliveryEnd: e.target.value })} aria-label="Fin du créneau" />
              </Field>
            </div>
          )}
        </div>
        <div>
          <div className="mb-m flex items-center justify-between">
            <span className="os-title-s">Enlèvements</span>
            <button className="btn btn-tertiary btn-sm" onClick={() => onChange({ ...day, pickups: [...pickups, pickups.length ? '18:00' : '12:00'] })} data-testid="add-pickup">
              <IconPlus /> Ajouter un enlèvement
            </button>
          </div>
          {pickups.length === 0 && <div className="text-xs text-neutral-500">Pas d'enlèvement ce jour.</div>}
          <div className="flex flex-col gap-s">
            {pickups.map((p, i) => (
              <div key={i} className="flex items-center gap-s">
                <input type="time" className="input" value={p} onChange={(e) => onChange({ ...day, pickups: pickups.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Enlèvement ${i + 1}`} />
                <button className="btn btn-tertiary-red btn-icon" onClick={() => onChange({ ...day, pickups: pickups.filter((_, j) => j !== i) })} aria-label="Retirer l'enlèvement" title="Retirer l'enlèvement">
                  <IconClose />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border pt-l">
          <div className="field-label">Copier ce jour</div>
          <div className="flex flex-wrap gap-s">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                onCopy([1, 2, 3, 4, 5]);
                setCopied('Copié sur les jours ouvrés');
              }}
            >
              <IconCopy /> Lun. à ven.
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                onCopy([1, 2, 3, 4, 5, 6]);
                setCopied('Copié du lundi au samedi');
              }}
            >
              <IconCopy /> Lun. à sam.
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                onCopy([1, 2, 3, 4, 5, 6, 7]);
                setCopied('Copié sur tous les jours');
              }}
            >
              <IconCopy /> Tous les jours
            </button>
            <button className="btn btn-tertiary-red btn-sm" onClick={() => onChange({ weekday: day.weekday })}>
              <IconTrash /> Vider
            </button>
          </div>
          {copied && <div className="mt-s text-xs text-[var(--green-1000)]">{copied}</div>}
        </div>
      </div>
    </Modal>
  );
}

/** Schedule preview of the saved route: departure and delivery slot for a destination. */
export function RouteTestPanel({ carrierId, serviceId, routeId, dirty }: { carrierId: string; serviceId: string; routeId: string; dirty: boolean }) {
  const preview = useSchedulePreview();
  const points = useAllStockPoints();
  const hubs = useHubs();
  const [postalCode, setPostalCode] = useState('75011');
  const [originId, setOriginId] = useState('');
  const [readyAt, setReadyAt] = useState(() => toLocalInput(new Date().toISOString()));
  const fe = preview.error instanceof ApiError ? preview.error.byField : {};
  const r = preview.data;
  return (
    <section className="flex flex-col gap-m rounded-m border border-border p-l" data-testid="route-test">
      <div>
        <div className="os-title-s">Tester la route</div>
        <p className="m-0 text-xs text-neutral-500">Calcule le départ et le créneau de livraison d'un colis avec la version enregistrée (route la plus prioritaire applicable).</p>
      </div>
      {dirty && <Alert kind="warning">Des modifications ne sont pas enregistrées : le test utilise la dernière version enregistrée.</Alert>}
      <div className="grid items-end gap-l sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_120px_210px_auto]">
        <Field label="Origine (facultatif)" error={fe.originId}>
          <select className="select" value={originId} onChange={(e) => setOriginId(e.target.value)} aria-label="Origine">
            <option value="">Premier leg du service</option>
            {(points.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
            {(hubs.data?.items ?? [])
              .filter((h) => !h.stockPointId)
              .map((h) => (
                <option key={h.id} value={h.id}>
                  Hub {h.name} ({h.id})
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
        <button
          className="btn btn-primary"
          disabled={!serviceId || !postalCode || !readyAt || preview.isPending}
          onClick={() => preview.mutate({ carrierId, body: { serviceId, postalCode: postalCode.trim(), readyAt: fromLocalInput(readyAt), originId: originId || undefined } })}
          data-testid="run-route-test"
        >
          {preview.isPending ? <Spinner size={16} className="text-white" /> : <IconPlay />}
          Tester
        </button>
      </div>
      {preview.error ? <ErrorAlert error={preview.error} title="Test impossible" /> : null}
      {r && !preview.error && (
        <div className="grid gap-l rounded-m bg-[var(--surface-hover)] p-l sm:grid-cols-2 lg:grid-cols-4" data-testid="route-test-result">
          <div>
            <div className="field-label">Route appliquée</div>
            <div className="text-s">
              {r.routeId ? (
                <span className="inline-flex items-center gap-s">
                  {r.routeId}
                  {r.routeId === routeId ? <Badge color="green">Cette route</Badge> : <Badge color="orange">Autre route</Badge>}
                </span>
              ) : (
                <span className="text-neutral-500">Aucune route : plannings du service</span>
              )}
            </div>
          </div>
          <div>
            <div className="field-label">Transit</div>
            <div className="text-s">{r.routeId && (r.transitMinHours || r.transitMaxHours) ? `${fmtHours(r.transitMinHours ?? 0)} à ${fmtHours(r.transitMaxHours ?? 0)}` : `J+${r.transitDays}`}</div>
          </div>
          <div>
            <div className="field-label">Départ (enlèvement)</div>
            <div className="text-s">{r.departure ? fmtDateTime(r.departure) : '–'}</div>
          </div>
          <div>
            <div className="field-label">Créneau de livraison</div>
            <div className="text-s font-medium">{r.delivery ? fmtWindow(r.delivery.from, r.delivery.to) : r.final === false ? 'Leg vers un hub' : '–'}</div>
          </div>
          {r.legId && <div className="text-xs text-neutral-500 sm:col-span-2 lg:col-span-4">Leg utilisé : {r.legId}</div>}
        </div>
      )}
    </section>
  );
}
