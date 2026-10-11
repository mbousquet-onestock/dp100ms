import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../api/client';
import { qk, useAdminToken, useDatabaseStatus, useHolidays, useSettings } from '../api/hooks';
import type { Counts, EngineSettings } from '../api/types';
import { IconAlert, IconClock, IconDatabase, IconRefresh, IconSettings } from '../components/Icons';
import { Alert, Badge, Card, cx, DL, ErrorAlert, Field, Loading, NumberInput, PageHeader, Segmented, Spinner, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtInt, fmtWeekday } from '../lib/format';

const WEIGHTS: [keyof EngineSettings['weights'], string, string][] = [
  ['deliveryTime', 'Délai de livraison', 'Favorise les livraisons les plus rapides'],
  ['packages', 'Nombre de colis', 'Favorise les options avec moins de colis'],
  ['cost', 'Coût', 'Favorise les options les moins chères'],
  ['legs', 'Nombre de legs', 'Favorise les routes les plus directes'],
  ['sources', 'Nombre de sources', 'Favorise les expéditions depuis un seul point'],
];

export default function Settings() {
  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Réglages du moteur de promesse, calendrier et administration du jeu de données" />
      <div className="grid gap-l xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <EngineCard />
        <div className="flex flex-col gap-l">
          <DatabaseCard />
          <AdminCard />
          <HolidaysCard />
        </div>
      </div>
    </div>
  );
}

function EngineCard() {
  const s = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<EngineSettings | null>(null);
  useEffect(() => {
    if (s.data) setV(s.data);
  }, [s.data]);
  const save = useMutation({
    mutationFn: (x: EngineSettings) => api.put<EngineSettings>('/settings', x),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings });
      toast('Enregistré');
    },
  });
  if (s.isLoading || !v) return <Card title="Moteur de promesse">{s.error ? <ErrorAlert error={s.error} /> : <Loading />}</Card>;
  const fe = save.error instanceof ApiError ? save.error.byField : {};
  const total = Object.values(v.weights).reduce((a, b) => a + b, 0);
  return (
    <Card title="Moteur de promesse" icon={<IconSettings size={20} />}>
      {save.error ? <ErrorAlert error={save.error} title="Enregistrement impossible" className="mb-l" /> : null}
      <div className="os-title-s mb-s">Pondération du score</div>
      <p className="m-0 mb-l text-xs text-neutral-500">Les options sont classées par un score normalisé combinant ces critères. Somme actuelle : {total.toFixed(2)}.</p>
      <div className="flex flex-col gap-l">
        {WEIGHTS.map(([k, label, hint]) => (
          <div key={k} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_56px] items-center gap-l">
            <div>
              <div className="text-s">{label}</div>
              <div className="text-xs text-neutral-500">{hint}</div>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={v.weights[k]} onChange={(e) => setV({ ...v, weights: { ...v.weights, [k]: Number(e.target.value) } })} className="accent-[#24bdb0]" aria-label={label} />
            <span className="text-right text-s tabular-nums">{v.weights[k].toFixed(2)}</span>
          </div>
        ))}
        {fe.weights && <div className="field-error">{fe.weights}</div>}
      </div>
      <div className="os-title-s mb-m mt-xl">Exploration</div>
      <div className="grid gap-l sm:grid-cols-2">
        <Field label="Largeur de faisceau (beam width)" error={fe.beamWidth} hint="1 à 64 plans conservés par étape">
          <NumberInput value={v.beamWidth} min={1} max={64} onChange={(n) => setV({ ...v, beamWidth: n })} invalid={!!fe.beamWidth} />
        </Field>
        <Field label="Allocations max" error={fe.maxAllocations} hint="1 à 100 répartitions de stock évaluées">
          <NumberInput value={v.maxAllocations} min={1} max={100} onChange={(n) => setV({ ...v, maxAllocations: n })} invalid={!!fe.maxAllocations} />
        </Field>
        <Field label="Legs max par route" error={fe.maxLegs} hint="1 à 5">
          <NumberInput value={v.maxLegs} min={1} max={5} onChange={(n) => setV({ ...v, maxLegs: n })} invalid={!!fe.maxLegs} />
        </Field>
        <Field label="Hubs max par plan" error={fe.maxHubsPerPlan} hint="1 à 20">
          <NumberInput value={v.maxHubsPerPlan} min={1} max={20} onChange={(n) => setV({ ...v, maxHubsPerPlan: n })} invalid={!!fe.maxHubsPerPlan} />
        </Field>
        <Field label="Fuseau horaire" error={fe.timezone}>
          <input className={cx('input', fe.timezone && 'invalid')} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} />
        </Field>
      </div>
      <div className="mt-xl flex justify-end gap-m border-t border-border pt-l">
        <button className="btn btn-secondary" onClick={() => s.data && setV(s.data)}>
          Annuler les modifications
        </button>
        <button className="btn btn-primary" onClick={() => save.mutate(v)} disabled={save.isPending}>
          {save.isPending && <Spinner size={16} className="text-white" />}
          Enregistrer
        </button>
      </div>
    </Card>
  );
}

function HolidaysCard() {
  const [year, setYear] = useState(2026);
  const h = useHolidays(year);
  return (
    <Card
      title="Jours fériés français"
      icon={<IconClock size={20} />}
      bodyClassName=""
      actions={
        <select className="select h-[30px] w-[96px]" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Année">
          {[2025, 2026, 2027, 2028].map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      }
    >
      {h.isLoading ? (
        <Loading />
      ) : h.error ? (
        <div className="p-xl">
          <ErrorAlert error={h.error} />
        </div>
      ) : (
        <table className="table table-compact">
          <tbody>
            {[...(h.data?.holidays ?? [])]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((d) => (
                <tr key={d.date}>
                  <td className="w-[56px] text-xs text-neutral-500">{fmtWeekday(d.date + 'T12:00:00Z')}</td>
                  <td className="w-[110px] tabular-nums">{fmtDate(d.date + 'T12:00:00Z')}</td>
                  <td>{d.name}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DatabaseCard() {
  const [token] = useAdminToken();
  const db = useDatabaseStatus(token);
  const d = db.data;
  return (
    <Card title="Base de données" icon={<IconDatabase size={20} />} actions={d ? d.persistence ? <Badge color="green">Persistance active</Badge> : <Badge color="grey">En mémoire</Badge> : null}>
      {db.isLoading ? (
        <Loading />
      ) : db.error ? (
        <ErrorAlert error={db.error} title="Statut indisponible" />
      ) : !d ? null : !d.persistence ? (
        <div data-testid="database-status">
          <p className="m-0 text-s text-neutral-700">Aucune base PostgreSQL configurée : le jeu de données est généré en mémoire au démarrage et perdu à l'arrêt.</p>
          {d.detail && <p className="m-0 mt-s text-xs text-neutral-500">{d.detail}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-l" data-testid="database-status">
          <DL
            items={[
              ['Persistance', 'PostgreSQL'],
              ['Stockage du stock', d.dataset?.stockMode === 'full' ? 'Complet (toutes les lignes)' : d.dataset?.stockMode === 'delta' ? 'Delta (écarts au jeu généré)' : d.dataset?.stockMode ?? '–'],
              ['Graine (seed)', d.dataset?.seed ?? '–'],
              ['Lignes de stock stockées', fmtInt(d.dataset?.stockRows)],
              ['Généré le', fmtDateTime(d.dataset?.generatedAt)],
              ['Initialisé le', fmtDateTime(d.dataset?.initializedAt)],
            ]}
          />
          {d.lastPersistError && <Alert kind="error" title="Dernière erreur d'écriture">{d.lastPersistError}</Alert>}
        </div>
      )}
    </Card>
  );
}

function AdminCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [seed, setSeed] = useState(42);
  const [stockStorage, setStockStorage] = useState<'delta' | 'full'>('delta');
  const [confirm, setConfirm] = useState(false);
  const reseed = useMutation({
    mutationFn: () => api.post<{ seed: number; counts: Counts; durationMs: number }>('/admin/reseed', { seed, stockStorage }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      setConfirm(false);
      toast(`Jeu de données régénéré en ${r.durationMs} ms (${fmtInt(r.counts.stockLines)} lignes de stock)`);
    },
  });
  const reset = useMutation({
    mutationFn: () => api.post<void>('/metrics/reset'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.dashboard });
      toast('Métriques réinitialisées');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Card title="Administration" icon={<IconRefresh size={20} />}>
      <div className="os-title-s mb-s">Régénérer le jeu de données</div>
      <p className="m-0 mb-m text-xs text-neutral-500">Recrée l'ensemble du référentiel (points de stock, réseau, catalogue et environ 1,2 million de lignes de stock) à partir d'une graine. Les modifications manuelles sont perdues.</p>
      {reseed.error ? <ErrorAlert error={reseed.error} className="mb-m" /> : null}
      <div className="flex flex-wrap items-end gap-m">
        <Field label="Graine (seed)">
          <NumberInput value={seed} onChange={setSeed} />
        </Field>
        <Field label="Stockage du stock en base">
          <Segmented<'delta' | 'full'>
            value={stockStorage}
            onChange={setStockStorage}
            options={[
              { value: 'delta', label: 'Delta' },
              { value: 'full', label: 'Complet' },
            ]}
          />
        </Field>
        {!confirm ? (
          <button className="btn btn-secondary" onClick={() => setConfirm(true)}>
            Régénérer
          </button>
        ) : null}
      </div>
      {confirm && (
        <Alert kind="warning" title="Confirmer la régénération" className="mt-m">
          <div className="mb-m">
            Toutes les données actuelles seront remplacées par un jeu généré avec la graine {seed}. Stock en base : {stockStorage === 'delta' ? 'seuls les écarts au jeu généré sont écrits' : 'toutes les lignes sont écrites'}.
          </div>
          <div className="flex gap-m">
            <button className="btn btn-danger btn-sm" onClick={() => reseed.mutate()} disabled={reseed.isPending}>
              {reseed.isPending ? <Spinner size={14} className="text-white" /> : <IconAlert />}
              Confirmer la régénération
            </button>
            <button className="btn btn-tertiary btn-sm" onClick={() => setConfirm(false)}>
              Annuler
            </button>
          </div>
        </Alert>
      )}
      <div className="mt-xl border-t border-border pt-l">
        <div className="os-title-s mb-s">Métriques en direct</div>
        <p className="m-0 mb-m text-xs text-neutral-500">Remet à zéro les compteurs de latence affichés sur le tableau de bord.</p>
        <button className="btn btn-secondary" onClick={() => reset.mutate()} disabled={reset.isPending}>
          {reset.isPending && <Spinner size={16} />}
          Réinitialiser les métriques
        </button>
      </div>
    </Card>
  );
}
