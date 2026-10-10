import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../api/client';
import { qk, useModes, useRunScenario, useScenarios, useSimulate, type Timed } from '../api/hooks';
import type { PromiseOption, Scenario, SimulationResponse } from '../api/types';
import { IconBox, IconClock, IconHub, IconMap, IconPlay, IconPlus, IconRoute, IconTrash } from '../components/Icons';
import { FlowDiagram } from '../components/sim/FlowDiagram';
import { JourneyMap } from '../components/sim/JourneyMap';
import { SkuInput } from '../components/sim/SkuInput';
import { Alert, Badge, Card, Checkbox, ChipSelect, cx, EmptyState, ErrorAlert, Field, Modal, NumberInput, PageHeader, ScoreBar, Spinner, Switch, useToast } from '../components/ui';
import { fmtDateTime, fmtInt, fmtMoney, fmtMs, fmtNum, fmtShort, fmtWindow } from '../lib/format';
import { modeBadge, PACKAGE_COLORS, SHIPMENT_KIND_LABEL, STRATEGY_BADGE, STRATEGY_LABEL, TIMELINE_LABEL, UNAVAILABLE_LABEL } from '../lib/labels';
import { fromRequest, loadSimForm, saveSimForm, toRequest, type SimForm } from '../lib/simState';

export default function Simulator() {
  const [form, setForm] = useState<SimForm>(loadSimForm);
  const [result, setResult] = useState<Timed<SimulationResponse> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const modes = useModes();
  const scenarios = useScenarios();
  const simulate = useSimulate();
  const runScenario = useRunScenario();

  useEffect(() => saveSimForm(form), [form]);

  const onResult = (r: Timed<SimulationResponse>) => {
    setResult(r);
    setSelected(r.data.options[0]?.id ?? null);
  };

  const run = () => {
    runScenario.reset();
    simulate.mutate(toRequest(form), { onSuccess: onResult });
  };
  const loadScenario = (id: string) => {
    if (!id) return;
    simulate.reset();
    runScenario.mutate(id, {
      onSuccess: (r) => {
        setForm((f) => fromRequest(r.data.request, f));
        onResult(r);
      },
    });
  };

  // /simulator?scenario=SCN-003 runs a scenario directly (used by the scenarios page)
  useEffect(() => {
    const id = params.get('scenario');
    if (id) {
      setScenarioId(id);
      loadScenario(id);
      params.delete('scenario');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = simulate.isPending || runScenario.isPending;
  const error = simulate.error ?? runScenario.error;
  const fe = error instanceof ApiError ? error.byField : {};
  const set = <K extends keyof SimForm>(k: K, v: SimForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const activeModes = (modes.data?.items ?? []).filter((m) => m.active);

  return (
    <div>
      <PageHeader title="Simulateur de promesse" subtitle="Calcul des options de livraison d'un panier : sources, colis, routes multi-leg, consolidations et dates promises" />

      <div className="grid gap-l xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* ---------------- Request form ---------------- */}
        <div className="flex flex-col gap-l">
          <Card title="Scénario enregistré" bodyClassName="card-pad">
            <div className="flex gap-m">
              <select className="select" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} aria-label="Scénario">
                <option value="">Choisir un scénario</option>
                {(scenarios.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary" disabled={!scenarioId || pending} onClick={() => loadScenario(scenarioId)} data-testid="load-scenario">
                {runScenario.isPending ? <Spinner size={16} /> : <IconPlay />}
                Charger un scénario
              </button>
            </div>
          </Card>

          <Card
            title="Panier"
            icon={<IconBox size={20} />}
            actions={
              <button className="btn btn-tertiary btn-sm" onClick={() => set('items', [...form.items, { sku: '', quantity: 1 }])}>
                <IconPlus /> Ajouter une ligne
              </button>
            }
          >
            <div className="flex flex-col gap-m">
              <div className="grid grid-cols-[minmax(0,1fr)_84px_36px] gap-m text-xs font-medium text-grey-800">
                <span>SKU</span>
                <span>Quantité</span>
                <span />
              </div>
              {form.items.map((it, i) => (
                <div key={i}>
                  <div className="grid grid-cols-[minmax(0,1fr)_84px_36px] gap-m">
                    <SkuInput value={it.sku} invalid={!!fe[`items[${i}].sku`]} onChange={(v) => set('items', form.items.map((x, j) => (j === i ? { ...x, sku: v } : x)))} />
                    <input
                      type="number"
                      min={1}
                      className={cx('input', fe[`items[${i}].quantity`] && 'invalid')}
                      value={it.quantity}
                      aria-label="Quantité"
                      onChange={(e) => set('items', form.items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))}
                    />
                    <button className="btn btn-tertiary-red btn-icon" disabled={form.items.length <= 1} onClick={() => set('items', form.items.filter((_, j) => j !== i))} aria-label="Retirer la ligne" title="Retirer la ligne">
                      <IconTrash />
                    </button>
                  </div>
                  {(fe[`items[${i}].sku`] || fe[`items[${i}].quantity`]) && <div className="field-error">{fe[`items[${i}].sku`] ?? fe[`items[${i}].quantity`]}</div>}
                </div>
              ))}
              {fe.items && <div className="field-error">{fe.items}</div>}
            </div>
          </Card>

          <Card title="Commande">
            <div className="grid gap-l sm:grid-cols-2">
              <Field label="Code postal de livraison" error={fe['destination.postalCode']}>
                <input className={cx('input', fe['destination.postalCode'] && 'invalid')} value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} maxLength={5} inputMode="numeric" />
              </Field>
              <Field label="Date de commande (Europe/Paris)" error={fe.orderDate}>
                <input type="datetime-local" className={cx('input', fe.orderDate && 'invalid')} value={form.orderDate} onChange={(e) => set('orderDate', e.target.value)} />
              </Field>
              <Field label="Modes de livraison" className="sm:col-span-2" hint="Aucun mode sélectionné = tous les modes actifs" error={Object.entries(fe).find(([k]) => k.startsWith('deliveryModes'))?.[1]}>
                <ChipSelect options={activeModes.map((m) => m.id)} value={form.modes} onChange={(v) => set('modes', v)} />
              </Field>
              <Field label="Nombre d'options max" error={fe.maxOptions}>
                <NumberInput value={form.maxOptions} min={1} max={50} onChange={(n) => set('maxOptions', n)} invalid={!!fe.maxOptions} />
              </Field>
            </div>
            <div className="mt-l border-t border-border pt-l">
              <Switch checked={form.useConstraints} onChange={(b) => set('useConstraints', b)} label="Contraintes de colis" />
              {form.useConstraints && (
                <div className="mt-l grid gap-l sm:grid-cols-2">
                  <Field label="Colis max" hint="0 = sans limite">
                    <NumberInput value={form.maxPackages} min={0} onChange={(n) => set('maxPackages', n)} />
                  </Field>
                  <Field label="Poids max par colis (kg)" hint="0 = limite du service">
                    <NumberInput value={form.maxWeightKg} min={0} step={0.5} onChange={(n) => set('maxWeightKg', n)} />
                  </Field>
                  <Field label="Sources max" hint="0 = limite du mode">
                    <NumberInput value={form.maxSources} min={0} onChange={(n) => set('maxSources', n)} />
                  </Field>
                  <div className="flex items-end pb-s">
                    <Checkbox checked={form.forbidConsolidation} onChange={(b) => set('forbidConsolidation', b)} label="Interdire la consolidation" />
                  </div>
                </div>
              )}
            </div>
            <div className="mt-l border-t border-border pt-l">
              <Switch checked={form.useWeights} onChange={(b) => set('useWeights', b)} label="Pondération du score personnalisée" />
              {form.useWeights && (
                <div className="mt-l grid gap-m">
                  {(
                    [
                      ['deliveryTime', 'Délai de livraison'],
                      ['packages', 'Nombre de colis'],
                      ['cost', 'Coût'],
                      ['legs', 'Nombre de legs'],
                      ['sources', 'Nombre de sources'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="grid grid-cols-[140px_minmax(0,1fr)_44px] items-center gap-m text-s">
                      <span>{label}</span>
                      <input type="range" min={0} max={1} step={0.05} value={form.weights[k]} onChange={(e) => set('weights', { ...form.weights, [k]: Number(e.target.value) })} className="accent-[#24bdb0]" />
                      <span className="text-right tabular-nums">{form.weights[k].toFixed(2)}</span>
                    </label>
                  ))}
                  {fe.weights && <div className="field-error">{fe.weights}</div>}
                </div>
              )}
            </div>
            <div className="mt-l flex flex-wrap justify-between gap-m border-t border-border pt-l">
              <button className="btn btn-secondary" onClick={() => setSaveOpen(true)}>
                Enregistrer comme scénario
              </button>
              <button className="btn btn-primary" onClick={run} disabled={pending} data-testid="run-simulation">
                {simulate.isPending ? <Spinner size={16} className="text-white" /> : <IconPlay />}
                Calculer la promesse
              </button>
            </div>
          </Card>
        </div>

        {/* ---------------- Results ---------------- */}
        <div className="min-w-0">
          {error ? <ErrorAlert error={error} title="Calcul impossible" className="mb-l" /> : null}
          {pending && !result ? (
            <Card title="Résultats">
              <div className="flex items-center justify-center gap-m py-3xl text-neutral-500">
                <Spinner /> Calcul en cours
              </div>
            </Card>
          ) : !result ? (
            <Card title="Résultats">
              <EmptyState title="Aucun calcul" icon={<IconRoute size={40} />}>
                Composer un panier puis lancer « Calculer la promesse », ou charger un scénario enregistré.
              </EmptyState>
            </Card>
          ) : (
            <Results result={result} selected={selected} onSelect={setSelected} pending={pending} />
          )}
        </div>
      </div>

      <SaveScenarioModal open={saveOpen} onClose={() => setSaveOpen(false)} form={form} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Results({ result, selected, onSelect, pending }: { result: Timed<SimulationResponse>; selected: string | null; onSelect: (id: string) => void; pending: boolean }) {
  const r = result.data;
  const opt = r.options.find((o) => o.id === selected) ?? r.options[0];
  return (
    <div className={cx('flex flex-col gap-l', pending && 'opacity-60')} data-testid="sim-results">
      {/* Header metrics */}
      <div className="card px-xl py-l">
        <div className="grid grid-cols-2 gap-x-xl gap-y-l sm:grid-cols-3 lg:grid-cols-6">
          <HeadMetric label="Calcul moteur" value={fmtMs(r.calculationTimeMs)} accent />
          <HeadMetric label="Temps serveur" value={fmtMs(r.serverTimeMs)} />
          <HeadMetric label="Aller-retour navigateur" value={fmtMs(result.roundTripMs)} />
          <HeadMetric label="Points candidats" value={fmtInt(r.stats.candidateStockPoints)} />
          <HeadMetric label="Allocations" value={fmtInt(r.stats.allocations)} />
          <HeadMetric label="Plans évalués" value={fmtInt(r.stats.plansEvaluated)} />
        </div>
        <div className="mt-m flex flex-wrap items-center gap-m text-xs text-neutral-500">
          <span>Requête {r.requestId}</span>
          <span>· {fmtInt(r.stats.pathsConsidered)} chemins considérés</span>
          <span>· cache des routes {r.stats.routeCacheHit ? 'utilisé' : 'non utilisé'}</span>
          <span>
            · versions stock {r.stats.stockVersion} / config {r.stats.configVersion}
          </span>
          <span>· livraison {r.request.destination.postalCode}, commande du {fmtDateTime(r.request.orderDate)}</span>
        </div>
      </div>

      {(r.unavailable ?? []).length > 0 && (
        <Card title="Modes indisponibles" bodyClassName="card-pad">
          <div className="flex flex-col gap-m">
            {r.unavailable.map((u) => (
              <div key={u.deliveryMode} className="flex flex-wrap items-center gap-m text-s">
                <Badge color={modeBadge(u.deliveryMode)}>{u.deliveryMode}</Badge>
                <Badge color="red" title={u.code}>
                  {UNAVAILABLE_LABEL[u.code] ?? u.code}
                </Badge>
                <span className="text-neutral-700">{u.reason}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {r.options.length === 0 ? (
        <Alert kind="warning" title="Aucune option de livraison">
          Le moteur n'a trouvé aucune option réalisable pour ce panier.
        </Alert>
      ) : (
        <>
          <div className="grid gap-l sm:grid-cols-2 2xl:grid-cols-3">
            {r.options.map((o, i) => (
              <OptionCard key={o.id} o={o} rank={i + 1} active={o.id === opt?.id} onClick={() => onSelect(o.id)} />
            ))}
          </div>
          <ComparisonTable options={r.options} selected={opt?.id} onSelect={onSelect} />
          {opt && <OptionDetail o={opt} r={r} />}
        </>
      )}

      <StockTable r={r} />
    </div>
  );
}

function HeadMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={cx('text-2xl tabular-nums', accent ? 'text-primary' : 'text-neutral-800')}>{value}</div>
      <div className="mt-xs text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function OptionCard({ o, rank, active, onClick }: { o: PromiseOption; rank: number; active: boolean; onClick: () => void }) {
  const legs = o.shipments.reduce((n, s) => n + s.legs.length, 0);
  const sources = new Set(o.allocations.map((a) => a.stockPointId)).size;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('card flex flex-col gap-m p-l text-left hover:bg-neutral-20', active && 'border-primary')}
      style={active ? { boxShadow: 'inset 0 0 0 1px var(--primary-1000)' } : undefined}
      aria-pressed={active}
      data-testid="option-card"
    >
      <div className="flex flex-wrap items-center gap-s">
        <span className="text-xs text-neutral-500">#{rank}</span>
        <Badge color={modeBadge(o.deliveryMode)}>{o.deliveryMode}</Badge>
        <Badge color={STRATEGY_BADGE[o.strategy] ?? 'grey'}>{STRATEGY_LABEL[o.strategy] ?? o.strategy}</Badge>
      </div>
      <div className="flex items-center gap-s text-m font-medium text-neutral-800">
        <IconClock size={18} className="text-neutral-500" />
        {fmtWindow(o.estimatedDelivery.from, o.estimatedDelivery.to)}
      </div>
      <div className="grid grid-cols-3 gap-m text-xs text-neutral-500">
        <div>
          <div className="text-s font-medium text-neutral-800">{o.packagesBeforeConsolidation !== o.totalPackages ? `${o.packagesBeforeConsolidation} colis → ${o.totalPackages} colis` : `${o.totalPackages} colis`}</div>
          Colis
        </div>
        <div>
          <div className="text-s font-medium text-neutral-800">{fmtMoney(o.totalCost, o.currency)}</div>
          Coût
        </div>
        <div>
          <div className="text-s font-medium text-neutral-800">
            {sources} · {legs}
          </div>
          Sources · legs
        </div>
      </div>
      <ScoreBar value={o.score} />
    </button>
  );
}

function ComparisonTable({ options, selected, onSelect }: { options: PromiseOption[]; selected?: string; onSelect: (id: string) => void }) {
  return (
    <Card title="Comparaison des options" bodyClassName="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Mode</th>
            <th>Stratégie</th>
            <th>Fenêtre promise</th>
            <th className="num">Délai (h)</th>
            <th className="num">Colis</th>
            <th className="num">Sources</th>
            <th className="num">Legs</th>
            <th className="num">Coût</th>
            <th className="w-[140px]">Score</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.id} className={cx('clickable', o.id === selected && 'selected')} onClick={() => onSelect(o.id)}>
              <td className="font-medium">{o.id}</td>
              <td>
                <Badge color={modeBadge(o.deliveryMode)}>{o.deliveryMode}</Badge>
              </td>
              <td>
                <Badge color={STRATEGY_BADGE[o.strategy] ?? 'grey'}>{STRATEGY_LABEL[o.strategy] ?? o.strategy}</Badge>
              </td>
              <td className="whitespace-nowrap">{fmtWindow(o.estimatedDelivery.from, o.estimatedDelivery.to)}</td>
              <td className="num">{fmtNum(o.criteria.deliveryHours, 1)}</td>
              <td className="num whitespace-nowrap">{o.packagesBeforeConsolidation !== o.totalPackages ? `${o.packagesBeforeConsolidation} → ${o.totalPackages}` : o.totalPackages}</td>
              <td className="num">{o.criteria.sources}</td>
              <td className="num">{o.criteria.legs}</td>
              <td className="num">{fmtMoney(o.totalCost, o.currency)}</td>
              <td>
                <ScoreBar value={o.score} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function OptionDetail({ o, r }: { o: PromiseOption; r: SimulationResponse }) {
  const name = (id: string) => (id === 'CUSTOMER' ? 'Client' : r.nodes[id]?.name ?? id);
  const nodeLabel = (id: string) => (
    <span>
      <span className="font-medium">{name(id)}</span>
      {id !== 'CUSTOMER' && <span className="text-xs text-neutral-500"> {id}</span>}
    </span>
  );
  const pkgColor = (pid: string) => PACKAGE_COLORS[Math.max(0, o.packages.findIndex((p) => p.packageId === pid)) % PACKAGE_COLORS.length];
  return (
    <div className="flex flex-col gap-l" data-testid="option-detail">
      <div className="flex flex-wrap items-center gap-m">
        <h2 className="os-title-m m-0">Détail de l'option {o.id}</h2>
        <Badge color={modeBadge(o.deliveryMode)}>{o.deliveryMode}</Badge>
        <Badge color={STRATEGY_BADGE[o.strategy] ?? 'grey'}>{STRATEGY_LABEL[o.strategy] ?? o.strategy}</Badge>
        <span className="text-s text-neutral-700">
          Livraison {fmtWindow(o.estimatedDelivery.from, o.estimatedDelivery.to)} · {fmtMoney(o.totalCost, o.currency)}
        </span>
      </div>

      <div className="grid gap-l 2xl:grid-cols-2">
        <Card title="Parcours géographique" icon={<IconMap size={20} />}>
          <JourneyMap option={o} nodes={r.nodes} postalCode={r.request.destination.postalCode} />
        </Card>
        <Card title="Schéma des flux" icon={<IconRoute size={20} />}>
          <FlowDiagram option={o} nodes={r.nodes} />
        </Card>
      </div>

      <Card title={`Colis (${o.packages.length})`} icon={<IconBox size={20} />} bodyClassName="">
        {o.packages.map((p) => (
          <div key={p.packageId} className="border-b border-border px-xl py-l last:border-b-0">
            <div className="mb-m flex flex-wrap items-center gap-m">
              <span className="inline-block h-[10px] w-[10px] rounded-round" style={{ background: pkgColor(p.packageId) }} />
              <span className="font-medium">{p.packageId}</span>
              <span className="text-xs text-neutral-500">
                {fmtNum(p.weightKg, 2)} kg · {fmtNum(p.volumeL, 1)} L
              </span>
              <span className="text-xs text-neutral-700">Livraison {fmtWindow(p.estimatedDelivery.from, p.estimatedDelivery.to)}</span>
              {p.consolidationId && <Badge color="purple">Consolidé · {p.consolidationId}</Badge>}
            </div>
            <div className="grid gap-l md:grid-cols-3">
              <div>
                <div className="os-label mb-s">Articles</div>
                <div className="flex flex-wrap gap-s">
                  {p.items.map((it) => (
                    <Badge key={it.sku} color="grey">
                      {it.sku} × {it.quantity}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <div className="os-label mb-s">Points de stock sources</div>
                <div className="flex flex-col gap-xs text-s">{p.sourceStockPoints.map((s) => <span key={s}>{nodeLabel(s)}</span>)}</div>
              </div>
              <div>
                <div className="os-label mb-s">Hubs traversés</div>
                <div className="flex flex-col gap-xs text-s">{p.hubs.length ? p.hubs.map((h) => <span key={h}>{nodeLabel(h)}</span>) : <span className="text-neutral-500">Aucun</span>}</div>
              </div>
            </div>
          </div>
        ))}
      </Card>

      <Card title="Expéditions et legs" icon={<IconRoute size={20} />} bodyClassName="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Expédition</th>
              <th>Leg</th>
              <th>De</th>
              <th>Vers</th>
              <th>Transporteur</th>
              <th>Service</th>
              <th>Départ</th>
              <th>Arrivée</th>
              <th className="num">Coût</th>
            </tr>
          </thead>
          <tbody>
            {o.shipments.flatMap((s) =>
              s.legs.map((l, i) => (
                <tr key={`${s.id}-${i}`}>
                  <td className="whitespace-nowrap">
                    {i === 0 ? (
                      <span className="flex items-center gap-s">
                        <span className="inline-block h-[8px] w-[8px] rounded-round" style={{ background: pkgColor(s.packageId) }} />
                        <span className="font-medium">{s.id}</span>
                        <Badge color={s.kind === 'INBOUND' ? 'purple' : s.kind === 'OUTBOUND' ? 'orange' : 'blue'}>{SHIPMENT_KIND_LABEL[s.kind] ?? s.kind}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="text-xs">{l.legId}</td>
                  <td>{nodeLabel(l.from)}</td>
                  <td>{nodeLabel(l.to)}</td>
                  <td>{l.carrierName}</td>
                  <td className="text-xs">
                    {l.service} · {l.serviceKind}
                  </td>
                  <td className="whitespace-nowrap">{fmtShort(l.estimatedDeparture)}</td>
                  <td className="whitespace-nowrap">{fmtShort(l.estimatedArrival)}</td>
                  <td className="num">{fmtMoney(l.cost)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </Card>

      {o.consolidations.length > 0 && (
        <Card title="Consolidations" icon={<IconHub size={20} />} bodyClassName="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Consolidation</th>
                <th>Hub</th>
                <th>Expéditions entrantes</th>
                <th>Dernière arrivée</th>
                <th>Prêt à</th>
                <th>Colis sortants</th>
                <th className="num">Coût</th>
              </tr>
            </thead>
            <tbody>
              {o.consolidations.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.id}</td>
                  <td>
                    {c.hubName} <span className="text-xs text-neutral-500">{c.hubId}</span>
                  </td>
                  <td className="text-xs">{c.inboundShipments.join(', ')}</td>
                  <td className="whitespace-nowrap">{fmtShort(c.lastArrival)}</td>
                  <td className="whitespace-nowrap">{fmtShort(c.readyAt)}</td>
                  <td className="text-xs">{c.outboundPackages.join(', ')}</td>
                  <td className="num">{fmtMoney(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid gap-l lg:grid-cols-2">
        <Card title="Préparations" bodyClassName="overflow-x-auto">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Groupe</th>
                <th>Point de stock</th>
                <th>Articles</th>
                <th>Prêt à</th>
                <th className="num">Colis</th>
              </tr>
            </thead>
            <tbody>
              {o.preparationGroups.map((g) => (
                <tr key={g.id}>
                  <td className="text-xs">{g.id}</td>
                  <td>{nodeLabel(g.stockPointId)}</td>
                  <td className="text-xs">{g.items.map((i) => `${i.sku} × ${i.quantity}`).join(', ')}</td>
                  <td className="whitespace-nowrap">{fmtShort(g.readyAt)}</td>
                  <td className="num">{g.parcels}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Allocations de stock" bodyClassName="overflow-x-auto">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Point de stock</th>
                <th>SKU</th>
                <th className="num">Quantité</th>
              </tr>
            </thead>
            <tbody>
              {o.allocations.map((a, i) => (
                <tr key={i}>
                  <td>{nodeLabel(a.stockPointId)}</td>
                  <td>{a.sku}</td>
                  <td className="num">{a.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Chronologie" icon={<IconClock size={20} />}>
        <ol className="m-0 list-none p-0">
          {o.timeline.map((ev, i) => {
            const last = i === o.timeline.length - 1;
            const color = ev.type === 'DELIVERY' ? 'var(--primary-1000)' : ev.type === 'ORDER' ? 'var(--grey-800)' : ev.type === 'CONSOLIDATION_READY' ? 'var(--purple-1000)' : ev.packageId ? pkgColor(ev.packageId) : 'var(--blue-1000)';
            return (
              <li key={i} className="relative grid grid-cols-[110px_20px_minmax(0,1fr)] gap-m pb-l last:pb-0">
                <div className="pt-[1px] text-right text-xs tabular-nums text-neutral-700">{fmtShort(ev.at)}</div>
                <div className="relative flex justify-center">
                  <span className="z-[1] mt-[3px] inline-block h-[12px] w-[12px] rounded-round border-2 bg-white" style={{ borderColor: color }} />
                  {!last && <span className="absolute bottom-[-16px] top-[16px] w-px bg-neutral-100" />}
                </div>
                <div className="min-w-0">
                  <div className="text-s font-medium text-neutral-800">
                    {TIMELINE_LABEL[ev.type] ?? ev.type}
                    {ev.packageId && <span className="ml-s text-xs font-normal text-neutral-500">{ev.packageId}</span>}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {ev.description} · {name(ev.node)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function StockTable({ r }: { r: SimulationResponse }) {
  const rows = r.stock ?? [];
  return (
    <Card title="Disponibilité du stock" icon={<IconBox size={20} />} bodyClassName="overflow-x-auto">
      {rows.length === 0 ? (
        <EmptyState title="Aucune donnée de stock" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="num">Demandé</th>
              <th className="num">Total promettable</th>
              <th className="num">Points avec stock</th>
              <th>Couverture</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.sku}>
                <td className="font-medium">{s.sku}</td>
                <td className="num">{s.requested}</td>
                <td className="num">{fmtInt(s.totalPromisable)}</td>
                <td className="num">{s.pointsWithStock}</td>
                <td>{s.totalPromisable >= s.requested ? <Badge color="green">Suffisant</Badge> : <Badge color="red">Insuffisant</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function SaveScenarioModal({ open, onClose, form }: { open: boolean; onClose: () => void; form: SimForm }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const req = useMemo(() => toRequest(form), [form]);
  const save = useMutation({
    mutationFn: (s: Partial<Scenario>) => api.post<Scenario>('/scenarios', s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.scenarios });
      toast('Scénario enregistré');
      onClose();
    },
  });
  useEffect(() => {
    if (open) {
      setId(`SCN-${Date.now().toString().slice(-6)}`);
      setName('');
      setDescription('');
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fe = save.error instanceof ApiError ? save.error.byField : {};
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enregistrer le panier comme scénario"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate({ id, name, description, request: req, createdAt: new Date().toISOString() })}>
            {save.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {save.error ? <Alert kind="error" title="Enregistrement impossible">{errorMessage(save.error)}</Alert> : null}
        <Field label="Identifiant" error={fe.id}>
          <input className={cx('input', fe.id && 'invalid')} value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label="Nom" error={fe.name}>
          <input className={cx('input', fe.name && 'invalid')} value={name} onChange={(e) => setName(e.target.value)} placeholder="Panier multi-sources Lille" />
        </Field>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="text-xs text-neutral-500">
          {req.items.length} lignes · livraison {req.destination.postalCode} · commande du {fmtDateTime(req.orderDate)}
        </div>
      </div>
    </Modal>
  );
}
