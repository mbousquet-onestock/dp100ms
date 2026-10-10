import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ApiError, api, errorMessage } from '../api/client';
import { qk, useBenchmark, useBenchmarks, useModes, usePresets } from '../api/hooks';
import type { BenchPoint, BenchRun, RunConfig } from '../api/types';
import { IconChart, IconGauge, IconPlay, IconStop } from '../components/Icons';
import { Alert, Badge, Card, Checkbox, ChipSelect, ConfirmButton, cx, DL, EmptyState, ErrorAlert, Field, ListInput, Loading, NumberInput, PageHeader, Spinner, Switch, useToast } from '../components/ui';
import { fmtDateTime, fmtInt, fmtMs, fmtNum, fmtPct } from '../lib/format';
import { CATEGORY_LABEL, P95_TARGET_MS, RUN_STATUS_BADGE, RUN_STATUS_LABEL } from '../lib/labels';

interface BenchForm {
  name: string;
  profile: string;
  vus: number;
  durationSec: number;
  useRate: boolean;
  rateRps: number;
  target: 'inprocess' | 'http';
  baseUrl: string;
  skusMin: number;
  skusMax: number;
  qtyMin: number;
  qtyMax: number;
  postalCodes: string[];
  modes: string[];
  pctMono: number;
  pctMulti: number;
  pctMultiSource: number;
  pctConsolidation: number;
  spreadOrderDates: boolean;
}

const defaultForm = (): BenchForm => ({
  name: '',
  profile: '',
  vus: 50,
  durationSec: 20,
  useRate: false,
  rateRps: 500,
  target: 'inprocess',
  baseUrl: '',
  skusMin: 2,
  skusMax: 5,
  qtyMin: 1,
  qtyMax: 2,
  postalCodes: [],
  modes: [],
  pctMono: 30,
  pctMulti: 40,
  pctMultiSource: 20,
  pctConsolidation: 10,
  spreadOrderDates: true,
});

function toConfig(f: BenchForm): RunConfig {
  return {
    name: f.name,
    profile: f.profile || undefined,
    vus: f.vus,
    durationSec: f.durationSec,
    rateRps: f.useRate ? f.rateRps : 0,
    target: f.target,
    baseUrl: f.target === 'http' && f.baseUrl ? f.baseUrl : undefined,
    baskets: {
      count: 2000,
      seed: 0,
      skusMin: f.skusMin,
      skusMax: f.skusMax,
      qtyMin: f.qtyMin,
      qtyMax: f.qtyMax,
      postalCodes: f.postalCodes.length ? f.postalCodes : null,
      modes: f.modes.length ? f.modes : null,
      pctMono: f.pctMono,
      pctMulti: f.pctMulti,
      pctMultiSource: f.pctMultiSource,
      pctConsolidation: f.pctConsolidation,
      spreadOrderDates: f.spreadOrderDates,
    },
  };
}

const passed = (r: BenchRun) => !!r.summary && r.summary.p95Ms < P95_TARGET_MS;

export default function Benchmarks() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<BenchForm>(defaultForm);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const history = useBenchmarks();
  const runningInHistory = history.data?.items.find((r) => r.status === 'running' || r.status === 'stopping');
  useEffect(() => {
    if (!activeId && runningInHistory) setActiveId(runningInHistory.id);
  }, [activeId, runningInHistory]);
  const active = useBenchmark(activeId);
  const run = active.data;
  const isRunning = run?.status === 'running' || run?.status === 'stopping';
  useEffect(() => {
    // refresh history once a run finishes
    if (run && !isRunning) qc.invalidateQueries({ queryKey: qk.benchmarks });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);

  const start = useMutation({
    mutationFn: (cfg: RunConfig) => api.post<BenchRun>('/benchmarks', cfg),
    onSuccess: (r) => {
      setActiveId(r.id);
      qc.setQueryData(qk.benchmark(r.id), r);
      qc.invalidateQueries({ queryKey: qk.benchmarks });
      toast(r.status === 'running' ? 'Benchmark démarré' : 'Benchmark terminé');
    },
  });
  const stop = useMutation({
    mutationFn: (id: string) => api.post<void>(`/benchmarks/${encodeURIComponent(id)}/stop`),
    onSuccess: () => toast('Arrêt demandé'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/benchmarks/${encodeURIComponent(id)}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: qk.benchmarks });
      setCompare((c) => c.filter((x) => x !== id));
      if (activeId === id) setActiveId(null);
      toast('Benchmark supprimé');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div>
      <PageHeader title="Benchmarks" subtitle={`Tests de charge du moteur de promesse · objectif P95 < ${P95_TARGET_MS} ms`} />
      <div className="grid gap-l xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <ConfigCard form={form} setForm={setForm} onStart={() => start.mutate(toConfig(form))} starting={start.isPending} disabled={isRunning} error={start.error} />
        <div className="flex min-w-0 flex-col gap-l">
          {!run ? (
            <Card title="Exécution">
              {active.isLoading ? (
                <Loading />
              ) : (
                <EmptyState title="Aucun benchmark sélectionné" icon={<IconGauge size={40} />}>
                  Choisir un profil puis lancer un benchmark, ou ouvrir un run de l'historique.
                </EmptyState>
              )}
            </Card>
          ) : (
            <RunView run={run} onStop={() => stop.mutate(run.id)} stopping={stop.isPending} />
          )}
        </div>
      </div>

      <HistoryCard
        runs={history.data?.items ?? []}
        loading={history.isLoading}
        error={history.error}
        activeId={activeId}
        compare={compare}
        setCompare={setCompare}
        onOpen={setActiveId}
        onDelete={(id) => del.mutate(id)}
      />
      {compare.length >= 2 && <CompareCard runs={(history.data?.items ?? []).filter((r) => compare.includes(r.id))} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConfigCard({ form, setForm, onStart, starting, disabled, error }: { form: BenchForm; setForm: (f: BenchForm) => void; onStart: () => void; starting: boolean; disabled: boolean; error: unknown }) {
  const presets = usePresets();
  const modes = useModes();
  const set = <K extends keyof BenchForm>(k: K, v: BenchForm[K]) => setForm({ ...form, [k]: v });
  const fe = error instanceof ApiError ? error.byField : {};
  const pctTotal = form.pctMono + form.pctMulti + form.pctMultiSource + form.pctConsolidation;
  return (
    <Card title="Configuration" icon={<IconChart size={20} />}>
      <div className="os-label mb-s">Profils prédéfinis</div>
      <div className="mb-l flex flex-wrap gap-s">
        {(presets.data ?? []).map((p) => (
          <button
            key={p.profile}
            type="button"
            className="chip"
            aria-pressed={form.profile === p.profile}
            title={p.name}
            onClick={() => setForm({ ...form, name: p.name, profile: p.profile ?? '', vus: p.vus, durationSec: p.durationSec, useRate: p.rateRps > 0, rateRps: p.rateRps || form.rateRps })}
          >
            {p.rateRps > 0 ? `${p.rateRps} req/s` : `${p.vus} VU`}
          </button>
        ))}
      </div>
      {error ? <ErrorAlert error={error} title="Démarrage impossible" className="mb-l" /> : null}
      <div className="grid gap-l sm:grid-cols-2">
        <Field label="Nom" className="sm:col-span-2" hint="Généré automatiquement si vide">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, profile: '' })} />
        </Field>
        <Field label="Utilisateurs virtuels (VU)" error={fe.vus}>
          <NumberInput value={form.vus} min={1} max={2000} onChange={(n) => setForm({ ...form, vus: n, profile: '' })} />
        </Field>
        <Field label="Durée (s)" error={fe.durationSec}>
          <NumberInput value={form.durationSec} min={1} max={600} onChange={(n) => setForm({ ...form, durationSec: n, profile: '' })} />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={form.useRate} onChange={(b) => setForm({ ...form, useRate: b, profile: '' })} label="Débit constant (modèle ouvert)" />
        </div>
        {form.useRate && (
          <Field label="Débit cible (req/s)" className="sm:col-span-2" hint="Les VU bornent la concurrence, les itérations excédentaires sont comptées comme abandonnées">
            <NumberInput value={form.rateRps} min={1} onChange={(n) => setForm({ ...form, rateRps: n, profile: '' })} />
          </Field>
        )}
        <Field label="Cible" className="sm:col-span-2">
          <div className="segmented">
            <button type="button" aria-pressed={form.target === 'inprocess'} onClick={() => set('target', 'inprocess')}>
              En processus
            </button>
            <button type="button" aria-pressed={form.target === 'http'} onClick={() => set('target', 'http')}>
              HTTP
            </button>
          </div>
        </Field>
        {form.target === 'http' && (
          <Field label="URL de base" className="sm:col-span-2" hint="Vide = le serveur lui-même" error={fe.baseUrl}>
            <input className="input" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="http://localhost:8080" />
          </Field>
        )}
      </div>
      <div className="os-title-s mb-m mt-xl">Profil des paniers</div>
      <div className="grid grid-cols-2 gap-l">
        <Field label="SKU par panier min">
          <NumberInput value={form.skusMin} min={1} onChange={(n) => set('skusMin', n)} />
        </Field>
        <Field label="SKU par panier max">
          <NumberInput value={form.skusMax} min={1} onChange={(n) => set('skusMax', n)} />
        </Field>
        <Field label="Quantité min">
          <NumberInput value={form.qtyMin} min={1} onChange={(n) => set('qtyMin', n)} />
        </Field>
        <Field label="Quantité max">
          <NumberInput value={form.qtyMax} min={1} onChange={(n) => set('qtyMax', n)} />
        </Field>
        <Field label="Codes postaux" className="col-span-2" hint="Séparés par des virgules, vide = 46 codes représentatifs">
          <ListInput value={form.postalCodes} onChange={(v) => set('postalCodes', v)} placeholder="75011, 69003, 33000" />
        </Field>
        <Field label="Modes de livraison" className="col-span-2" hint="Aucun = tous">
          <ChipSelect options={(modes.data?.items ?? []).map((m) => m.id)} value={form.modes} onChange={(v) => set('modes', v)} />
        </Field>
        <Field label="% mono-article">
          <NumberInput value={form.pctMono} min={0} onChange={(n) => set('pctMono', n)} />
        </Field>
        <Field label="% multi-articles">
          <NumberInput value={form.pctMulti} min={0} onChange={(n) => set('pctMulti', n)} />
        </Field>
        <Field label="% multi-sources">
          <NumberInput value={form.pctMultiSource} min={0} onChange={(n) => set('pctMultiSource', n)} />
        </Field>
        <Field label="% consolidation">
          <NumberInput value={form.pctConsolidation} min={0} onChange={(n) => set('pctConsolidation', n)} />
        </Field>
        <div className="col-span-2 text-xs text-neutral-500">Répartition relative (total {pctTotal}).</div>
        <div className="col-span-2">
          <Checkbox checked={form.spreadOrderDates} onChange={(b) => set('spreadOrderDates', b)} label="Répartir les dates de commande sur une semaine (cut-offs, week-ends)" />
        </div>
      </div>
      <div className="mt-xl flex justify-end border-t border-border pt-l">
        <button className="btn btn-primary" onClick={onStart} disabled={starting || disabled} data-testid="start-benchmark">
          {starting ? <Spinner size={16} className="text-white" /> : <IconPlay />}
          {disabled ? 'Benchmark en cours' : 'Lancer le benchmark'}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function RunView({ run, onStop, stopping }: { run: BenchRun; onStop: () => void; stopping: boolean }) {
  const isRunning = run.status === 'running' || run.status === 'stopping';
  const series = run.series ?? [];
  const elapsed = series.length ? series[series.length - 1].t : 0;
  const s = run.summary;
  return (
    <>
      <Card
        title={run.config.name}
        icon={<IconGauge size={20} />}
        actions={
          <>
            <Badge color={RUN_STATUS_BADGE[run.status] ?? 'grey'}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Badge>
            {s && <Badge color={passed(run) ? 'green' : 'red'}>{passed(run) ? 'P95 < 100 ms' : 'P95 ≥ 100 ms'}</Badge>}
            {isRunning && (
              <button className="btn btn-danger btn-sm" onClick={onStop} disabled={stopping || run.status === 'stopping'} data-testid="stop-benchmark">
                <IconStop /> Arrêter
              </button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-l text-xs text-neutral-500">
          <span>{run.id}</span>
          <span>Démarré le {fmtDateTime(run.startedAt)}</span>
          <span>
            {run.config.vus} VU{run.config.rateRps > 0 ? ` · ${run.config.rateRps} req/s` : ''} · {run.config.durationSec} s · cible {run.config.target === 'http' ? `HTTP ${run.config.baseUrl ?? ''}` : 'en processus'}
          </span>
          {isRunning && (
            <span className="flex items-center gap-s text-blue">
              <Spinner size={14} className="text-blue" /> {elapsed} / {run.config.durationSec} s
            </span>
          )}
        </div>
        {isRunning && (
          <div className="mt-m h-[4px] overflow-hidden rounded-round bg-neutral-50">
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, (elapsed / Math.max(1, run.config.durationSec)) * 100)}%` }} />
          </div>
        )}
        {run.error && (
          <Alert kind="error" title="Échec du benchmark" className="mt-m">
            {run.error}
          </Alert>
        )}
      </Card>

      {s && <SummaryTiles run={run} />}

      {series.length > 0 ? <LiveCharts series={series} /> : isRunning ? <Card title="Mesures en direct"><Loading label="En attente des premières mesures" /></Card> : null}

      {s && (
        <div className="grid gap-l 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card title="Latence par catégorie de panier" bodyClassName="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Catégorie</th>
                  <th className="num">Requêtes</th>
                  <th className="num">Erreurs</th>
                  <th className="num">Moyenne</th>
                  <th className="num">P50</th>
                  <th className="num">P95</th>
                  <th className="num">P99</th>
                  <th className="num">Max</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(s.byCategory ?? {})
                  .sort()
                  .map(([cat, l]) => (
                    <tr key={cat}>
                      <td className="font-medium">{CATEGORY_LABEL[cat] ?? cat}</td>
                      <td className="num">{fmtInt(l.requests)}</td>
                      <td className="num">{fmtInt(l.errors)}</td>
                      <td className="num">{fmtMs(l.avgMs)}</td>
                      <td className="num">{fmtMs(l.p50Ms)}</td>
                      <td className="num" style={{ color: l.p95Ms < P95_TARGET_MS ? undefined : 'var(--red-1000)' }}>
                        {fmtMs(l.p95Ms)}
                      </td>
                      <td className="num">{fmtMs(l.p99Ms)}</td>
                      <td className="num">{fmtMs(l.maxMs)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
          <Card title="Statuts HTTP et environnement">
            <div className="mb-l flex flex-wrap gap-s">
              {Object.entries(s.statusCodes ?? {}).map(([code, n]) => (
                <Badge key={code} color={code === '200' ? 'green' : code.startsWith('4') ? 'orange' : 'red'}>
                  {code === '0' ? 'Erreur réseau' : code} · {fmtInt(n)}
                </Badge>
              ))}
            </div>
            <DL
              items={[
                ['Plateforme', run.environment.platform || '–'],
                ['Hôte', run.environment.hostname || '–'],
                ['CPU', `${run.environment.numCpu} cœurs (GOMAXPROCS ${run.environment.gomaxprocs})`],
                ['Go', run.environment.goVersion],
                ['OS / arch', `${run.environment.os} / ${run.environment.arch}`],
                ['Source', run.source],
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}

function SummaryTiles({ run }: { run: BenchRun }) {
  const s = run.summary!;
  const tiles: [string, string, string?][] = [
    ['Débit', `${fmtNum(s.rps, 0)} req/s`],
    ['P50', fmtMs(s.p50Ms)],
    ['P95', fmtMs(s.p95Ms), s.p95Ms < P95_TARGET_MS ? 'var(--green-1000)' : 'var(--red-1000)'],
    ['P99', fmtMs(s.p99Ms)],
    ['Max', fmtMs(s.maxMs)],
    ["Taux d'erreur", fmtPct(s.errorRate, 2), s.errorRate > 0 ? 'var(--red-1000)' : undefined],
    ['Requêtes', fmtInt(s.requests)],
    ['CPU moyen / pic', `${fmtNum(s.cpuAvgPct, 0)} / ${fmtNum(s.cpuPeakPct, 0)} %`],
    ['Mémoire pic', `${fmtNum(s.memPeakMb, 0)} Mo`],
    ['Cache des routes', fmtPct(s.cacheHitRate)],
    ['Paniers distincts', fmtInt(s.distinctBaskets)],
    ['Itérations abandonnées', fmtInt(s.droppedIterations), s.droppedIterations > 0 ? 'var(--orange-1000)' : undefined],
  ];
  return (
    <div className="grid grid-cols-2 gap-l sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" data-testid="bench-summary">
      {tiles.map(([label, value, color]) => (
        <div key={label} className="card px-l py-l">
          <div className="text-2xl tabular-nums text-neutral-800" style={color ? { color } : undefined}>
            {value}
          </div>
          <div className="mt-xs text-xs text-neutral-500">{label}</div>
        </div>
      ))}
      <div className="card col-span-2 px-l py-l text-xs text-neutral-500 sm:col-span-3 lg:col-span-4 2xl:col-span-6">
        Durée effective {fmtNum(s.durationSec, 1)} s · calcul moteur moyen {fmtMs(s.avgComputeMs)} · moyenne {fmtMs(s.avgMs)} · min {fmtMs(s.minMs)} · P90 {fmtMs(s.p90Ms)}
        {s.errors > 0 && <span className="ml-s text-red">· {fmtInt(s.errors)} requêtes en erreur</span>}
      </div>
    </div>
  );
}

const axis = { fontSize: 11, fill: '#7f7f7f' };
const grid = <CartesianGrid stroke="#f2f2f2" vertical={false} />;

function LiveCharts({ series }: { series: BenchPoint[] }) {
  return (
    <div className="grid gap-l lg:grid-cols-2">
      <Card title="Latence (ms)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="t" tick={axis} tickFormatter={(t) => `${t}s`} stroke="#e5e5e5" />
            <YAxis tick={axis} stroke="#e5e5e5" width={44} domain={[0, (max: number) => Math.ceil(Math.max(max, P95_TARGET_MS * 1.1) / 10) * 10]} tickFormatter={(v: number) => String(Math.round(v))} />
            <Tooltip formatter={(v: number) => fmtMs(v)} labelFormatter={(t) => `${t} s`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={P95_TARGET_MS} stroke="#f44539" strokeDasharray="5 4" label={{ value: 'Objectif P95 100 ms', position: 'insideTopRight', fontSize: 11, fill: '#f44539' }} />
            <Line type="monotone" dataKey="p50" name="P50" stroke="#2695f3" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="p95" name="P95" stroke="#fd7e14" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="p99" name="P99" stroke="#673ab7" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Débit (req/s)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="t" tick={axis} tickFormatter={(t) => `${t}s`} stroke="#e5e5e5" />
            <YAxis tick={axis} stroke="#e5e5e5" width={52} />
            <Tooltip formatter={(v: number) => `${fmtInt(v)} req/s`} labelFormatter={(t) => `${t} s`} />
            <Line type="monotone" dataKey="rps" name="Débit" stroke="#24bdb0" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card title="CPU (%)">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="t" tick={axis} tickFormatter={(t) => `${t}s`} stroke="#e5e5e5" />
            <YAxis tick={axis} stroke="#e5e5e5" width={44} domain={[0, 100]} />
            <Tooltip formatter={(v: number) => `${fmtNum(v, 1)} %`} labelFormatter={(t) => `${t} s`} />
            <Line type="monotone" dataKey="cpuPct" name="CPU" stroke="#2695f3" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Mémoire heap (Mo)">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="t" tick={axis} tickFormatter={(t) => `${t}s`} stroke="#e5e5e5" />
            <YAxis tick={axis} stroke="#e5e5e5" width={44} />
            <Tooltip formatter={(v: number) => `${fmtNum(v, 1)} Mo`} labelFormatter={(t) => `${t} s`} />
            <Line type="monotone" dataKey="heapMb" name="Heap" stroke="#673ab7" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HistoryCard({ runs, loading, error, activeId, compare, setCompare, onOpen, onDelete }: { runs: BenchRun[]; loading: boolean; error: unknown; activeId: string | null; compare: string[]; setCompare: (c: string[]) => void; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <Card
      title="Historique des benchmarks"
      className="mt-l"
      bodyClassName="overflow-x-auto"
      actions={<span className="text-xs text-neutral-500">{compare.length >= 2 ? `${compare.length} runs comparés` : 'Cocher au moins 2 runs pour comparer'}</span>}
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <div className="p-xl">
          <ErrorAlert error={error} />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState title="Aucun benchmark">Les runs terminés apparaissent ici.</EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="w-[36px]"></th>
              <th>Run</th>
              <th>Date</th>
              <th>Statut</th>
              <th>Objectif</th>
              <th className="num">VU</th>
              <th className="num">Débit</th>
              <th className="num">P50</th>
              <th className="num">P95</th>
              <th className="num">P99</th>
              <th className="num">Erreurs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const s = r.summary;
              return (
                <tr key={r.id} className={cx('clickable', r.id === activeId && 'selected')} onClick={() => onOpen(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-[16px] w-[16px] accent-[#24bdb0]"
                      checked={compare.includes(r.id)}
                      disabled={!s}
                      onChange={(e) => setCompare(e.target.checked ? [...compare, r.id] : compare.filter((x) => x !== r.id))}
                      aria-label={`Comparer ${r.id}`}
                    />
                  </td>
                  <td>
                    <div className="font-medium">{r.config.name}</div>
                    <div className="text-xs text-neutral-500">
                      {r.id} · {r.source} · {r.config.target || 'inprocess'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(r.startedAt)}</td>
                  <td>
                    <Badge color={RUN_STATUS_BADGE[r.status] ?? 'grey'}>{RUN_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </td>
                  <td>
                    {s ? (
                      <span className="inline-flex flex-wrap gap-s">
                        <Badge color={passed(r) ? 'green' : 'red'}>{passed(r) ? 'Atteint' : 'Manqué'}</Badge>
                        {s.errors > 0 && <Badge color="orange">Erreurs</Badge>}
                      </span>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num">
                    {r.config.vus}
                    {r.config.rateRps > 0 && <div className="text-xs text-neutral-500">{r.config.rateRps} req/s</div>}
                  </td>
                  <td className="num">{s ? `${fmtNum(s.rps, 0)} req/s` : '–'}</td>
                  <td className="num">{s ? fmtMs(s.p50Ms) : '–'}</td>
                  <td className="num">{s ? fmtMs(s.p95Ms) : '–'}</td>
                  <td className="num">{s ? fmtMs(s.p99Ms) : '–'}</td>
                  <td className="num">{s ? fmtPct(s.errorRate, 2) : '–'}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {r.status !== 'running' && <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => onDelete(r.id)} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CompareCard({ runs }: { runs: BenchRun[] }) {
  const data = useMemo(
    () =>
      [...runs]
        .reverse()
        .map((r) => ({ name: r.config.name.length > 22 ? r.config.name.slice(0, 21) + '…' : r.config.name, id: r.id, p95: r.summary?.p95Ms ?? 0, p99: r.summary?.p99Ms ?? 0, rps: r.summary?.rps ?? 0 })),
    [runs],
  );
  return (
    <div className="mt-l grid gap-l lg:grid-cols-2">
      <Card title="Comparaison · latence P95 / P99 (ms)">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="name" tick={axis} stroke="#e5e5e5" interval={0} />
            <YAxis tick={axis} stroke="#e5e5e5" width={44} domain={[0, (max: number) => Math.ceil(Math.max(max, P95_TARGET_MS * 1.1) / 10) * 10]} tickFormatter={(v: number) => String(Math.round(v))} />
            <Tooltip formatter={(v: number) => fmtMs(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={P95_TARGET_MS} stroke="#f44539" strokeDasharray="5 4" label={{ value: 'Objectif 100 ms', position: 'insideTopRight', fontSize: 11, fill: '#f44539' }} />
            <Bar dataKey="p95" name="P95" fill="#fd7e14" isAnimationActive={false} />
            <Bar dataKey="p99" name="P99" fill="#673ab7" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Comparaison · débit (req/s)">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="name" tick={axis} stroke="#e5e5e5" interval={0} />
            <YAxis tick={axis} stroke="#e5e5e5" width={52} />
            <Tooltip formatter={(v: number) => `${fmtInt(v)} req/s`} />
            <Bar dataKey="rps" name="Débit" fill="#24bdb0" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
