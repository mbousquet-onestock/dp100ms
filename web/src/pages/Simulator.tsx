import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../api/client';
import { qk, useAdditionalServices, useModes, useRunScenario, useScenarios, useSimulate, useStockViews, type Timed } from '../api/hooks';
import { CriteriaEditor } from '../components/pricing/CriteriaEditor';
import type { AlternativesSort, PackageAlternative, PackageResult, PromiseOption, Scenario, SimulationResponse } from '../api/types';
import { IconBox, IconChevronDown, IconChevronUp, IconClock, IconEuro, IconHub, IconLeaf, IconMap, IconPlay, IconPlus, IconRoute, IconTool, IconTrash } from '../components/Icons';
import { FlowDiagram } from '../components/sim/FlowDiagram';
import { JourneyMap } from '../components/sim/JourneyMap';
import { SkuInput } from '../components/sim/SkuInput';
import { Alert, Badge, Card, Checkbox, ChipSelect, cx, EmptyState, ErrorAlert, Field, Modal, NumberInput, PageHeader, ScoreBar, Spinner, Switch, useToast } from '../components/ui';
import { fmtCarbon, fmtDateTime, fmtInt, fmtKm, fmtMoney, fmtMs, fmtNum, fmtShort, fmtWindow } from '../lib/format';
import { ADDITIONAL_KIND_LABEL, metricLabel, modeBadge, NODE_BADGE, outputLabel, PACKAGE_COLORS, STOCK_POINT_TYPE_LABEL, SHIPMENT_KIND_LABEL, STRATEGY_BADGE, STRATEGY_LABEL, TIMELINE_LABEL, UNAVAILABLE_LABEL } from '../lib/labels';
import { fromRequest, loadSimForm, saveSimForm, toRequest, type SimForm } from '../lib/simState';

export default function Simulator() {
  const [form, setForm] = useState<SimForm>(loadSimForm);
  const [result, setResult] = useState<Timed<SimulationResponse> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const modes = useModes();
  const views = useStockViews();
  const extras = useAdditionalServices();
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
            <div className="mt-l border-t border-border pt-l" data-testid="sim-pricing">
              <div className="os-title-s mb-m">Prix, services et stock</div>
              <div className="grid gap-l sm:grid-cols-2">
                <Field label="Vue de stock" hint="Vide = vue de chaque mode" error={fe.stockViewId}>
                  <select className={cx('select', fe.stockViewId && 'invalid')} value={form.stockViewId} onChange={(e) => set('stockViewId', e.target.value)} data-testid="sim-stock-view">
                    <option value="">Vue de chaque mode</option>
                    {(views.data?.items ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Montant de commande (€)" hint={form.useOrderAmount ? 'Remplace la somme des prix articles' : 'Somme des prix articles'} error={fe.orderAmount}>
                  <div className="flex items-center gap-m">
                    <Switch checked={form.useOrderAmount} onChange={(b) => set('useOrderAmount', b)} />
                    <NumberInput value={form.useOrderAmount ? form.orderAmount : undefined} step={1} min={0} onChange={(n) => setForm((f) => ({ ...f, orderAmount: n, useOrderAmount: true }))} placeholder="auto" />
                  </div>
                </Field>
                <Field label="Services associés demandés" className="sm:col-span-2" error={Object.entries(fe).find(([k]) => k.startsWith('additionalServices'))?.[1]}>
                  <ChipSelect options={(extras.data?.items ?? []).filter((x) => x.active).map((x) => x.id)} value={form.additionalServices} onChange={(v) => set('additionalServices', v)} renderLabel={(id) => extras.data?.items.find((x) => x.id === id)?.name ?? id} />
                </Field>
              </div>
            </div>
            <div className="mt-l border-t border-border pt-l">
              <Switch checked={form.useAlternatives} onChange={(b) => set('useAlternatives', b)} label="Origines alternatives par colis" />
              {form.useAlternatives && (
                <div className="mt-l grid gap-l sm:grid-cols-2">
                  <Field label="Nombre d'alternatives" hint="1 à 20" error={fe['alternatives.limit']}>
                    <NumberInput value={form.altLimit} min={1} max={20} onChange={(n) => set('altLimit', n)} />
                  </Field>
                  <Field label="Trier par" error={fe['alternatives.sortBy']}>
                    <select className="select" value={form.altSort} onChange={(e) => set('altSort', e.target.value as AlternativesSort)}>
                      {(['deliveryHours', 'distanceKm', 'cost', 'carbonKg'] as AlternativesSort[]).map((k) => (
                        <option key={k} value={k}>
                          {metricLabel(k)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
            </div>
            <div className="mt-l border-t border-border pt-l">
              <Switch checked={form.useCriteria} onChange={(b) => set('useCriteria', b)} label="Critères de sélection personnalisés" />
              {form.useCriteria && (
                <div className="mt-l">
                  <CriteriaEditor criteria={form.criteria} selection={form.selection} onChange={(c, sel) => setForm((f) => ({ ...f, criteria: c, selection: sel }))} errors={fe} />
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
      <div className="grid grid-cols-3 gap-m text-xs text-neutral-500" data-testid="option-pricing">
        <div>
          <PriceValue o={o} />
          Prix client
        </div>
        <div>
          <div className="text-s font-medium text-neutral-800">{fmtMoney(o.metrics?.cost ?? o.totalCost, o.currency)}</div>
          Coût
        </div>
        <div>
          <div className="flex items-center gap-xs text-s font-medium text-neutral-800">
            <IconLeaf size={14} className="text-neutral-500" />
            {fmtNum(carbonOf(o), 3)}
          </div>
          kg CO2e
        </div>
      </div>
      <div className="grid grid-cols-3 gap-m text-xs text-neutral-500">
        <div>
          <div className="text-s font-medium text-neutral-800">{o.packagesBeforeConsolidation !== o.totalPackages ? `${o.packagesBeforeConsolidation} colis → ${o.totalPackages} colis` : `${o.totalPackages} colis`}</div>
          Colis
        </div>
        <div>
          <div className="text-s font-medium text-neutral-800">{(o.additionalServices ?? []).filter((x) => x.requested).length || '–'}</div>
          Services
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
            <th>Fenêtre promise</th>
            <th className="num">Délai (h)</th>
            <th className="num">Prix client</th>
            <th className="num">Coût</th>
            <th className="num">Carbone (kg CO2e)</th>
            <th className="num">Colis</th>
            <th className="num">Sources</th>
            <th className="num">Legs</th>
            <th>Stratégie</th>
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
              <td className="whitespace-nowrap">{fmtWindow(o.estimatedDelivery.from, o.estimatedDelivery.to)}</td>
              <td className="num">{fmtNum(o.criteria.deliveryHours, 1)}</td>
              <td className="num">
                <PriceValue o={o} inline />
              </td>
              <td className="num">{fmtMoney(o.metrics?.cost ?? o.totalCost, o.currency)}</td>
              <td className="num">{fmtNum(carbonOf(o), 3)}</td>
              <td className="num whitespace-nowrap">{o.packagesBeforeConsolidation !== o.totalPackages ? `${o.packagesBeforeConsolidation} → ${o.totalPackages}` : o.totalPackages}</td>
              <td className="num">{o.criteria.sources}</td>
              <td className="num">{o.criteria.legs}</td>
              <td>
                <Badge color={STRATEGY_BADGE[o.strategy] ?? 'grey'}>{STRATEGY_LABEL[o.strategy] ?? o.strategy}</Badge>
              </td>
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
  const extraLegMetrics = Array.from(new Set(o.shipments.flatMap((s) => s.legs.flatMap((l) => Object.keys(l.metrics ?? {}))))).filter((k) => k !== 'cost' && k !== 'carbonKg' && k !== 'price');
  return (
    <div className="flex flex-col gap-l" data-testid="option-detail">
      <div className="flex flex-wrap items-center gap-m">
        <h2 className="os-title-m m-0">Détail de l'option {o.id}</h2>
        <Badge color={modeBadge(o.deliveryMode)}>{o.deliveryMode}</Badge>
        <Badge color={STRATEGY_BADGE[o.strategy] ?? 'grey'}>{STRATEGY_LABEL[o.strategy] ?? o.strategy}</Badge>
        <span className="text-s text-neutral-700">
          Livraison {fmtWindow(o.estimatedDelivery.from, o.estimatedDelivery.to)} · coût {fmtMoney(o.metrics?.cost ?? o.totalCost, o.currency)} · prix client {priceText(o)} · {fmtCarbon(carbonOf(o))}
          {o.stockViewId && <> · vue de stock {o.stockViewId}</>}
        </span>
      </div>

      <MetricsCard o={o} />
      <ServicesCard o={o} />

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
            <PackageMetrics p={p} currency={o.currency} />
            {(p.alternatives ?? []).length > 0 && <AlternativesTable p={p} />}
          </div>
        ))}
      </Card>

      <div className="grid gap-l 2xl:grid-cols-2">
        <Card title="Parcours géographique" icon={<IconMap size={20} />}>
          <JourneyMap option={o} nodes={r.nodes} postalCode={r.request.destination.postalCode} />
        </Card>
        <Card title="Schéma des flux" icon={<IconRoute size={20} />}>
          <FlowDiagram option={o} nodes={r.nodes} />
        </Card>
      </div>

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
              <th className="num">Distance</th>
              <th className="num">Coût</th>
              <th className="num">Carbone (kg CO2e)</th>
              {extraLegMetrics.map((k) => (
                <th key={k} className="num">
                  {outputLabel(k)}
                </th>
              ))}
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
                  <td className="num whitespace-nowrap">{fmtKm(l.distanceKm)}</td>
                  <td className="num">{fmtMoney(l.metrics?.cost ?? l.cost)}</td>
                  <td className="num">{l.metrics?.carbonKg !== undefined ? fmtNum(l.metrics.carbonKg, 3) : '–'}</td>
                  {extraLegMetrics.map((k) => (
                    <td key={k} className="num">
                      {l.metrics?.[k] !== undefined ? fmtNum(l.metrics[k], 2) : '–'}
                    </td>
                  ))}
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

// ---------------------------------------------------------------------------
// Pricing helpers and blocks

const carbonOf = (o: PromiseOption) => o.metrics?.carbonKg ?? o.criteria.carbonKg ?? 0;
const priceOf = (o: PromiseOption) => o.metrics?.price ?? o.criteria.price ?? 0;
/** Part of the customer price coming from requested additional services. */
const servicesPrice = (o: PromiseOption) => (o.additionalServices ?? []).filter((x) => x.requested).reduce((a, x) => a + (x.metrics?.price ?? 0), 0);
const priceText = (o: PromiseOption) => (priceOf(o) <= 0.0001 ? 'offert' : fmtMoney(priceOf(o), o.currency));

function PriceValue({ o, inline }: { o: PromiseOption; inline?: boolean }) {
  const total = priceOf(o);
  const shipping = total - servicesPrice(o);
  const free = total <= 0.0001;
  const freeShipping = !free && shipping <= 0.0001;
  if (inline)
    return (
      <span className="whitespace-nowrap">
        {free ? <Badge color="green">Offert</Badge> : fmtMoney(total, o.currency)}
        {freeShipping && <span className="ml-s text-2xs text-neutral-500">livraison offerte</span>}
      </span>
    );
  return (
    <div className="text-s font-medium text-neutral-800">
      {free ? <span style={{ color: 'var(--green-1000)' }}>Offert</span> : fmtMoney(total, o.currency)}
      {freeShipping && <div className="text-2xs font-normal" style={{ color: 'var(--green-1000)' }}>livraison offerte</div>}
    </div>
  );
}

function MetricsCard({ o }: { o: PromiseOption }) {
  const metrics = o.metrics ?? {};
  const custom = Object.keys(metrics).filter((k) => !['cost', 'price', 'carbonKg'].includes(k));
  const total = priceOf(o);
  const svc = servicesPrice(o);
  const shipping = total - svc;
  return (
    <div className="card px-xl py-l" data-testid="option-metrics">
      <div className="grid grid-cols-2 gap-x-xl gap-y-l sm:grid-cols-4 lg:grid-cols-6">
        <div>
          <div className="text-2xl tabular-nums" style={{ color: total <= 0.0001 ? 'var(--green-1000)' : 'var(--neutral-800)' }}>
            {total <= 0.0001 ? 'Offert' : fmtMoney(total, o.currency)}
          </div>
          <div className="mt-xs flex items-center gap-xs text-xs text-neutral-500">
            <IconEuro size={14} /> Prix client
          </div>
        </div>
        <div>
          <div className="text-2xl tabular-nums" style={{ color: shipping <= 0.0001 ? 'var(--green-1000)' : 'var(--neutral-800)' }}>
            {shipping <= 0.0001 ? 'Offerte' : fmtMoney(shipping, o.currency)}
          </div>
          <div className="mt-xs text-xs text-neutral-500">dont livraison{svc > 0 ? ` · services ${fmtMoney(svc, o.currency)}` : ''}</div>
        </div>
        <HeadMetric label="Coût transporteur" value={fmtMoney(metrics.cost ?? o.totalCost, o.currency)} />
        <div>
          <div className="text-2xl tabular-nums text-neutral-800">{fmtNum(carbonOf(o), 3)}</div>
          <div className="mt-xs flex items-center gap-xs text-xs text-neutral-500">
            <IconLeaf size={14} /> Carbone (kg CO2e)
          </div>
        </div>
        <HeadMetric label="Délai (h)" value={fmtNum(o.criteria.deliveryHours, 1)} />
        {custom.map((k) => (
          <HeadMetric key={k} label={outputLabel(k)} value={fmtNum(metrics[k], 2)} />
        ))}
      </div>
    </div>
  );
}

function ServicesCard({ o }: { o: PromiseOption }) {
  const list = o.additionalServices ?? [];
  if (!list.length) return null;
  return (
    <Card title="Services associés" icon={<IconTool size={20} />} bodyClassName="overflow-x-auto">
      <table className="table" data-testid="option-services">
        <thead>
          <tr>
            <th>Service</th>
            <th>Statut</th>
            <th>Articles concernés</th>
            <th className="num">Prix client</th>
            <th className="num">Coût</th>
            <th className="num">Carbone</th>
            <th className="num">Jours en plus</th>
          </tr>
        </thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.id}>
              <td>
                <div className="font-medium">{x.name}</div>
                <div className="text-xs text-neutral-500">{ADDITIONAL_KIND_LABEL[x.kind] ?? x.kind}</div>
              </td>
              <td>{x.requested ? <Badge color="green">Appliqué</Badge> : <Badge color="blue">Proposé</Badge>}</td>
              <td className="text-xs">{x.items.map((i) => `${i.sku} × ${i.quantity}`).join(', ') || '–'}</td>
              <td className="num">{x.metrics?.price !== undefined ? (x.metrics.price === 0 ? 'Offert' : fmtMoney(x.metrics.price, o.currency)) : '–'}</td>
              <td className="num">{x.metrics?.cost !== undefined ? fmtMoney(x.metrics.cost, o.currency) : '–'}</td>
              <td className="num">{x.metrics?.carbonKg !== undefined ? fmtNum(x.metrics.carbonKg, 3) : '–'}</td>
              <td className="num">{x.extraDays > 0 ? `+${x.extraDays} j` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PackageMetrics({ p, currency }: { p: PackageResult; currency: string }) {
  const m = p.metrics ?? {};
  const custom = Object.keys(m).filter((k) => !['cost', 'price', 'carbonKg'].includes(k));
  const items: [string, string][] = [
    ['Délai', `${fmtNum(p.leadTimeHours, 1)} h`],
    ['Distance', fmtKm(p.distanceKm)],
    ['Coût', fmtMoney(m.cost, currency)],
    ['Part du prix client', m.price !== undefined ? fmtMoney(m.price, currency) : '–'],
    ['Carbone', fmtCarbon(m.carbonKg)],
    ...custom.map((k) => [outputLabel(k), fmtNum(m[k], 2)] as [string, string]),
  ];
  return (
    <div className="mt-l flex flex-wrap gap-x-2xl gap-y-m rounded-m bg-neutral-20 px-l py-m" data-testid="package-metrics">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="text-2xs text-neutral-500">{k}</div>
          <div className="text-s font-medium tabular-nums text-neutral-800">{v}</div>
        </div>
      ))}
    </div>
  );
}

type AltKey = 'name' | 'city' | 'type' | 'deliveryHours' | 'distanceKm' | 'cost' | 'carbonKg' | 'carriers';
const ALT_COLS: { key: AltKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Point de stock' },
  { key: 'city', label: 'Ville' },
  { key: 'type', label: 'Type' },
  { key: 'deliveryHours', label: 'Livraison', num: true },
  { key: 'distanceKm', label: 'Distance', num: true },
  { key: 'cost', label: 'Coût', num: true },
  { key: 'carbonKg', label: 'CO2e (kg)', num: true },
  { key: 'carriers', label: 'Transporteurs' },
];
const altValue = (a: PackageAlternative, k: AltKey): string | number => {
  switch (k) {
    case 'cost':
    case 'carbonKg':
      return a.metrics?.[k] ?? Number.POSITIVE_INFINITY;
    case 'carriers':
      return a.carriers.join(', ');
    case 'name':
      return a.name || a.stockPointId;
    default:
      return a[k];
  }
};

function AlternativesTable({ p }: { p: PackageResult }) {
  const [sort, setSort] = useState<{ key: AltKey; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    const list = [...(p.alternatives ?? [])];
    if (sort)
      list.sort((a, b) => {
        const x = altValue(a, sort.key);
        const y = altValue(b, sort.key);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * sort.dir;
      });
    return list;
  }, [p.alternatives, sort]);
  return (
    <div className="mt-l" data-testid="alternatives">
      <div className="os-label mb-s">Origines alternatives ({rows.length})</div>
      <div className="overflow-x-auto rounded-m border border-border">
        <table className="table table-compact">
          <thead>
            <tr>
              {ALT_COLS.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} className={cx(c.num && 'num')} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      className={cx('inline-flex items-center gap-xs font-medium', on ? 'text-neutral-800' : 'text-grey-800')}
                      onClick={() => setSort(on ? (sort!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}
                    >
                      {c.label}
                      {on ? sort!.dir === 1 ? <IconChevronUp size={14} /> : <IconChevronDown size={14} /> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.stockPointId} className={cx(a.current && 'selected')} data-current={a.current || undefined}>
                <td>
                  <div className="flex items-center gap-s">
                    <span className="font-medium">{a.name || a.stockPointId}</span>
                    {a.current && <Badge color="primary">Origine retenue</Badge>}
                  </div>
                  <div className="text-xs text-neutral-500">{a.stockPointId}</div>
                </td>
                <td className="text-xs">{a.city}</td>
                <td>
                  <Badge color={NODE_BADGE[a.type] ?? 'grey'}>{STOCK_POINT_TYPE_LABEL[a.type] ?? a.type}</Badge>
                </td>
                <td className="num whitespace-nowrap" title={fmtWindow(a.estimatedDelivery.from, a.estimatedDelivery.to)}>
                  <div>{fmtNum(a.deliveryHours, 1)} h</div>
                  <div className="text-xs text-neutral-500">
                    {fmtShort(a.estimatedDelivery.to)} · {a.parcels} colis
                  </div>
                </td>
                <td className="num whitespace-nowrap">{fmtKm(a.distanceKm)}</td>
                <td className="num">{fmtMoney(a.metrics?.cost)}</td>
                <td className="num">{a.metrics?.carbonKg !== undefined ? fmtNum(a.metrics.carbonKg, 3) : '–'}</td>
                <td className="text-xs">
                  {a.carriers.join(', ')}
                  <div className="text-neutral-500">via {a.route.map((x) => (x === 'CUSTOMER' ? 'client' : x)).join(' → ')}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
