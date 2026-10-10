import { Link } from 'react-router-dom';
import { useDashboard } from '../api/hooks';
import { IconChart, IconGauge, IconInfo, IconStore } from '../components/Icons';
import { Alert, Badge, Card, Dot, ErrorAlert, Kpi, Loading, PageHeader } from '../components/ui';
import { fmtDateTime, fmtInt, fmtMs, fmtNum, fmtPct, fmtDuration } from '../lib/format';
import { NODE_COLORS, P95_TARGET_MS, RUN_STATUS_BADGE, RUN_STATUS_LABEL, STOCK_POINT_TYPE_LABEL } from '../lib/labels';

export default function Dashboard() {
  const { data, error, isLoading, dataUpdatedAt } = useDashboard();
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorAlert error={error} title="Tableau de bord indisponible" />;
  const c = data.counts;
  const pl = data.promiseLatency;
  const last = data.lastBenchmark;
  const types = ['STORE', 'WAREHOUSE', 'LAST_MILE_HUB'];
  const p95ok = pl.p95Ms < P95_TARGET_MS;

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        subtitle={`Moteur de promesse de livraison et de routage multi-leg · seed ${data.seed} · plateforme ${data.platform}`}
        actions={<span className="text-xs text-neutral-500">Actualisé à {new Date(dataUpdatedAt).toLocaleTimeString('fr-FR')} · toutes les 5 s</span>}
      />

      <h2 className="os-title-s mb-m mt-0 flex items-center gap-m">
        <IconStore size={20} /> Référentiel
      </h2>
      <div className="grid grid-cols-2 gap-l sm:grid-cols-4 2xl:grid-cols-8">
        <Kpi value={fmtInt(c.stockPoints)} label="Points de stock" />
        <Kpi value={fmtInt(c.skus)} label="SKU" />
        <Kpi value={fmtInt(c.stockLines)} label="Lignes de stock" />
        <Kpi value={fmtInt(c.legs + c.routes)} label="Routes" hint={`${fmtInt(c.legs)} legs + ${fmtInt(c.routes)} routes explicites`} />
        <Kpi value={fmtInt(c.carriers)} label="Transporteurs" />
        <Kpi value={fmtInt(c.services)} label="Services" />
        <Kpi value={fmtInt(c.hubs)} label="Hubs" />
        <Kpi value={fmtInt(c.deliveryModes)} label="Modes de livraison" />
      </div>

      <div className="mt-l grid gap-l lg:grid-cols-3">
        <Card title="Points de stock par type">
          <div className="flex flex-col gap-l">
            {types.map((t) => {
              const n = c.stockPointsByType[t] ?? 0;
              const pct = c.stockPoints ? (n / c.stockPoints) * 100 : 0;
              return (
                <div key={t}>
                  <div className="mb-s flex items-center justify-between text-s">
                    <span className="flex items-center gap-m">
                      <Dot color={NODE_COLORS[t]} /> {STOCK_POINT_TYPE_LABEL[t]}
                    </span>
                    <span className="font-medium tabular-nums">{fmtInt(n)}</span>
                  </div>
                  <div className="h-[6px] overflow-hidden rounded-round bg-neutral-50">
                    <div className="h-full" style={{ width: `${pct}%`, background: NODE_COLORS[t] }} />
                  </div>
                </div>
              );
            })}
            <div className="text-xs text-neutral-500">
              Versions : configuration {c.configVersion} · stock {c.stockVersion} · {fmtInt(c.scenarios)} scénarios enregistrés
            </div>
          </div>
        </Card>

        <Card
          title="Performance de la promesse"
          icon={<IconGauge size={20} />}
          className="lg:col-span-2"
          actions={pl.requests > 0 ? <Badge color={p95ok ? 'green' : 'red'}>{p95ok ? 'P95 < 100 ms' : 'P95 ≥ 100 ms'}</Badge> : undefined}
        >
          {pl.requests === 0 && (
            <Alert kind="info" className="mb-l" title="Aucune requête de promesse enregistrée">
              Les indicateurs se remplissent dès qu'une requête POST /api/v1/delivery-promises est reçue (via le <Link to="/benchmarks" className="underline">benchmark</Link> ou un appel API). Le simulateur utilise un endpoint distinct.
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-x-xl gap-y-l sm:grid-cols-4">
            <Metric label="Latence moyenne" value={fmtMs(pl.avgMs)} />
            <Metric label="P50" value={fmtMs(pl.p50Ms)} />
            <Metric label="P95" value={fmtMs(pl.p95Ms)} accent={pl.requests ? (p95ok ? 'var(--green-1000)' : 'var(--red-1000)') : undefined} />
            <Metric label="P99" value={fmtMs(pl.p99Ms)} />
            <Metric label="Max" value={fmtMs(pl.maxMs)} />
            <Metric label="Débit (1 min)" value={`${fmtNum(pl.rps1m, 1)} req/s`} />
            <Metric label="Taux d'erreur" value={fmtPct(pl.errorRate, 2)} />
            <Metric label="Requêtes" value={fmtInt(pl.requests)} />
          </div>
          <div className="mt-xl grid grid-cols-2 gap-x-xl gap-y-l border-t border-border pt-l sm:grid-cols-4">
            <Metric label="Cache des routes (hit rate)" value={fmtPct(data.routeCacheHitRate)} small />
            <Metric label="Mémoire heap" value={`${fmtNum(data.system.heapAllocMb, 1)} Mo`} small />
            <Metric label="Goroutines" value={fmtInt(data.system.goroutines)} small />
            <Metric label="CPU" value={`${data.system.numCpu} cœurs · ${data.system.goVersion}`} small />
          </div>
          <div className="mt-m text-xs text-neutral-500">
            Fenêtre glissante de {fmtInt(pl.window)} requêtes · uptime {fmtDuration(pl.uptimeSec)} · API toutes routes : {fmtInt(data.apiLatency.requests)} requêtes, P95 {fmtMs(data.apiLatency.p95Ms)}
          </div>
        </Card>
      </div>

      <Card title="Dernier benchmark" icon={<IconChart size={20} />} className="mt-l" actions={<Link to="/benchmarks" className="btn btn-secondary btn-sm">Voir les benchmarks</Link>}>
        {!last || !last.summary ? (
          <div className="flex items-center gap-m text-s text-neutral-500">
            <IconInfo size={18} /> Aucun benchmark terminé pour le moment.
          </div>
        ) : (
          <div>
            <div className="mb-l flex flex-wrap items-center gap-m">
              <span className="font-medium">{last.config.name}</span>
              <Badge color={RUN_STATUS_BADGE[last.status]}>{RUN_STATUS_LABEL[last.status]}</Badge>
              <Badge color={last.summary.p95Ms < P95_TARGET_MS ? 'green' : 'red'}>{last.summary.p95Ms < P95_TARGET_MS ? 'Objectif P95 atteint' : 'Objectif P95 manqué'}</Badge>
              <span className="text-xs text-neutral-500">{fmtDateTime(last.startedAt)} · {last.config.vus} VU · {last.config.durationSec} s · cible {last.config.target}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-xl gap-y-l sm:grid-cols-4 lg:grid-cols-7">
              <Metric label="Débit" value={`${fmtNum(last.summary.rps, 0)} req/s`} />
              <Metric label="P50" value={fmtMs(last.summary.p50Ms)} />
              <Metric label="P95" value={fmtMs(last.summary.p95Ms)} />
              <Metric label="P99" value={fmtMs(last.summary.p99Ms)} />
              <Metric label="Taux d'erreur" value={fmtPct(last.summary.errorRate, 2)} />
              <Metric label="CPU moyen" value={`${fmtNum(last.summary.cpuAvgPct, 0)} %`} />
              <Metric label="Requêtes" value={fmtInt(last.summary.requests)} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, accent, small }: { label: string; value: string; accent?: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={small ? 'text-m font-medium tabular-nums text-neutral-800' : 'text-2xl font-normal tabular-nums text-neutral-800'} style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-xs text-xs text-neutral-500">{label}</div>
    </div>
  );
}
