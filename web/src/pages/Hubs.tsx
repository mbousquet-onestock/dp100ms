import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { qk, useCrud, useHubs } from '../api/hooks';
import type { Hub } from '../api/types';
import { IconPlus, IconTrash } from '../components/Icons';
import { Alert, Badge, Card, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, Loading, NumberInput, PageHeader, SearchInput, Spinner, Switch, useToast, WeekdayToggles } from '../components/ui';
import { fmtDateTime, fmtMoney, fromLocalInput, toLocalInput } from '../lib/format';
import { HUB_KIND_LABEL } from '../lib/labels';

export const emptyHub = (): Hub => ({
  id: '',
  name: '',
  kind: 'CONSOLIDATION',
  postalCode: '',
  city: '',
  lat: 46.6,
  lon: 2.4,
  calendar: { workingDays: [1, 2, 3, 4, 5, 6], honorHolidays: true },
  openingTime: '05:00',
  closingTime: '22:00',
  sortingMinutes: 60,
  consolidationEnabled: true,
  consolidationMinutes: 90,
  maxConsolidationWaitHours: 48,
  consolidationCost: 0.8,
  unavailability: [],
  active: true,
});

function isUnavailableNow(h: Hub): boolean {
  const now = Date.now();
  return (h.unavailability ?? []).some((u) => new Date(u.from).getTime() <= now && now < new Date(u.to).getTime());
}

export default function Hubs() {
  const hubs = useHubs();
  const crud = useCrud<Hub>('hubs', [qk.hubs, qk.graph]);
  const toast = useToast();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ v: Hub; isNew: boolean } | null>(null);
  const items = (hubs.data?.items ?? []).filter((h) => !q || `${h.id} ${h.name} ${h.city}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Hubs"
        subtitle="Plateformes de consolidation et hubs dernier kilomètre"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: emptyHub(), isNew: true })}>
            <IconPlus /> Créer un hub
          </button>
        }
      />
      <Card
        title={`${items.length} hubs`}
        bodyClassName="overflow-x-auto"
        actions={<SearchInput className="w-[240px]" value={q} onChange={setQ} placeholder="Rechercher un hub" />}
      >
        {hubs.isLoading ? (
          <Loading />
        ) : hubs.error ? (
          <div className="p-xl">
            <ErrorAlert error={hubs.error} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="Aucun hub" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Hub</th>
                <th>Type</th>
                <th>Ville</th>
                <th>Horaires</th>
                <th className="num">Tri</th>
                <th>Consolidation</th>
                <th>Indisponibilités</th>
                <th>Disponibilité</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="clickable" onClick={() => setEdit({ v: h, isNew: false })}>
                  <td>
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-neutral-500">
                      {h.id}
                      {h.stockPointId ? ' · aussi point de stock' : ''}
                    </div>
                  </td>
                  <td>
                    <Badge color={h.kind === 'CONSOLIDATION' ? 'green' : 'orange'}>{HUB_KIND_LABEL[h.kind]}</Badge>
                  </td>
                  <td className="whitespace-nowrap">
                    {h.postalCode} {h.city}
                  </td>
                  <td className="whitespace-nowrap">
                    {h.openingTime} – {h.closingTime}
                  </td>
                  <td className="num whitespace-nowrap">{h.sortingMinutes} min</td>
                  <td className="whitespace-nowrap text-xs">
                    {h.consolidationEnabled ? (
                      <span>
                        {h.consolidationMinutes} min · attente max {h.maxConsolidationWaitHours || '∞'} h · {fmtMoney(h.consolidationCost)}
                      </span>
                    ) : (
                      <span className="text-neutral-500">Désactivée</span>
                    )}
                  </td>
                  <td className="text-xs">{(h.unavailability ?? []).length || '–'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={h.active}
                      onChange={(b) =>
                        crud.update.mutate(
                          { ...h, active: b },
                          { onSuccess: () => toast(b ? 'Hub réactivé' : 'Hub temporairement indisponible'), onError: (e) => toast(errorMessage(e), 'error') },
                        )
                      }
                      label={!h.active ? <Badge color="red">Temporairement indisponible</Badge> : isUnavailableNow(h) ? <Badge color="orange">Période d'indisponibilité</Badge> : <Badge color="green">Disponible</Badge>}
                    />
                  </td>
                  <td className="text-right">
                    <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(h.id, { onSuccess: () => toast('Hub supprimé'), onError: (e) => toast(errorMessage(e), 'error') })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <HubDrawer state={edit} onClose={() => setEdit(null)} crud={crud} />
    </div>
  );
}

export function HubDrawer({ state, onClose, crud, onSaved }: { state: { v: Hub; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<Hub>>; onSaved?: (h: Hub) => void }) {
  const [v, setV] = useState<Hub | null>(null);
  const toast = useToast();
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV({ ...state.v, unavailability: state.v.unavailability ?? [] });
      crud.create.reset();
      crud.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (!v) return null;
  const fe = m.error instanceof ApiError ? m.error.byField : {};
  const set = <K extends keyof Hub>(k: K, val: Hub[K]) => setV((x) => (x ? { ...x, [k]: val } : x));
  const unav = v.unavailability ?? [];
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouveau hub' : `Hub ${v.id}`}
      width={680}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={m.isPending}
            onClick={() =>
              m.mutate(
                { ...v, stockPointId: v.stockPointId || undefined },
                {
                  onSuccess: (h) => {
                    toast('Enregistré');
                    onSaved?.(h);
                    onClose();
                  },
                },
              )
            }
          >
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        {!v.active && <Alert kind="warning" title="Hub temporairement indisponible">Le moteur n'utilise plus ce hub tant qu'il est désactivé.</Alert>}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe.id}>
            <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => set('id', e.target.value)} placeholder="HUB-OUEST" />
          </Field>
          <Field label="Nom" error={fe.name}>
            <input className={cx('input', fe.name && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type" error={fe.kind}>
            <select className={cx('select', fe.kind && 'invalid')} value={v.kind} onChange={(e) => set('kind', e.target.value as Hub['kind'])}>
              <option value="CONSOLIDATION">Consolidation</option>
              <option value="LAST_MILE">Dernier kilomètre</option>
            </select>
          </Field>
          <Field label="Point de stock associé" error={fe.stockPointId} hint="Facultatif, doit partager le même identifiant">
            <input className={cx('input', fe.stockPointId && 'invalid')} value={v.stockPointId ?? ''} onChange={(e) => set('stockPointId', e.target.value)} />
          </Field>
          <Field label="Code postal">
            <input className="input" value={v.postalCode} onChange={(e) => set('postalCode', e.target.value)} maxLength={5} />
          </Field>
          <Field label="Ville">
            <input className="input" value={v.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Latitude">
            <NumberInput value={v.lat} step={0.0001} onChange={(n) => set('lat', n)} />
          </Field>
          <Field label="Longitude">
            <NumberInput value={v.lon} step={0.0001} onChange={(n) => set('lon', n)} />
          </Field>
          <Field label="Ouverture">
            <input type="time" className="input" value={v.openingTime} onChange={(e) => set('openingTime', e.target.value)} />
          </Field>
          <Field label="Fermeture">
            <input type="time" className="input" value={v.closingTime} onChange={(e) => set('closingTime', e.target.value)} />
          </Field>
          <Field label="Jours d'activité" className="sm:col-span-2" error={fe['calendar.workingDays']}>
            <div className="flex flex-wrap items-center gap-l">
              <WeekdayToggles value={v.calendar.workingDays} onChange={(d) => set('calendar', { ...v.calendar, workingDays: d })} />
              <Switch checked={v.calendar.honorHolidays} onChange={(b) => set('calendar', { ...v.calendar, honorHolidays: b })} label="Fermé les jours fériés" />
            </div>
          </Field>
          <Field label="Temps de tri (min)" error={fe.minutes}>
            <NumberInput value={v.sortingMinutes} onChange={(n) => set('sortingMinutes', n)} invalid={!!fe.minutes} />
          </Field>
          <Field label="Statut">
            <div className="flex h-control items-center">
              <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Disponible' : 'Temporairement indisponible'} />
            </div>
          </Field>
        </div>

        <div className="border-t border-border pt-l">
          <div className="mb-m flex items-center justify-between">
            <span className="os-title-s">Consolidation</span>
            <Switch checked={v.consolidationEnabled} onChange={(b) => set('consolidationEnabled', b)} label={v.consolidationEnabled ? 'Activée' : 'Désactivée'} />
          </div>
          <div className="grid gap-l sm:grid-cols-3">
            <Field label="Durée de consolidation (min)">
              <NumberInput value={v.consolidationMinutes} onChange={(n) => set('consolidationMinutes', n)} />
            </Field>
            <Field label="Attente max (h, 0 = illimitée)">
              <NumberInput value={v.maxConsolidationWaitHours} onChange={(n) => set('maxConsolidationWaitHours', n)} />
            </Field>
            <Field label="Coût par consolidation (€)">
              <NumberInput value={v.consolidationCost} step={0.01} onChange={(n) => set('consolidationCost', n)} />
            </Field>
          </div>
        </div>

        <div className="border-t border-border pt-l">
          <div className="mb-m flex items-center justify-between">
            <span className="os-title-s">Périodes d'indisponibilité</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const from = new Date();
                const to = new Date(from.getTime() + 24 * 3600 * 1000);
                set('unavailability', [...unav, { from: from.toISOString(), to: to.toISOString(), reason: '' }]);
              }}
            >
              <IconPlus /> Ajouter une période
            </button>
          </div>
          {unav.length === 0 ? (
            <div className="text-xs text-neutral-500">Aucune période d'indisponibilité planifiée.</div>
          ) : (
            <div className="flex flex-col gap-m">
              {unav.map((u, i) => {
                const err = fe[`unavailability[${i}]`];
                const upd = (patch: Partial<typeof u>) => set('unavailability', unav.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="rounded-m border border-border p-m">
                    <div className="grid items-end gap-m sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <Field label="Du">
                        <input type="datetime-local" className={cx('input', err && 'invalid')} value={toLocalInput(u.from)} onChange={(e) => e.target.value && upd({ from: fromLocalInput(e.target.value) })} />
                      </Field>
                      <Field label="Au">
                        <input type="datetime-local" className={cx('input', err && 'invalid')} value={toLocalInput(u.to)} onChange={(e) => e.target.value && upd({ to: fromLocalInput(e.target.value) })} />
                      </Field>
                      <Field label="Motif">
                        <input className="input" value={u.reason ?? ''} onChange={(e) => upd({ reason: e.target.value })} placeholder="Inventaire, grève" />
                      </Field>
                      <button className="btn btn-tertiary-red btn-icon" onClick={() => set('unavailability', unav.filter((_, j) => j !== i))} aria-label="Retirer la période" title="Retirer la période">
                        <IconTrash />
                      </button>
                    </div>
                    <div className="mt-s text-xs text-neutral-500">
                      {fmtDateTime(u.from)} → {fmtDateTime(u.to)}
                    </div>
                    {err && <div className="field-error">{err}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
