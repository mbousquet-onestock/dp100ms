import { Fragment, useMemo, useState } from 'react';
import { usePricingFields } from '../../api/hooks';
import type { Components, Range, RateCard, RateRow, RateScope } from '../../api/types';
import { condFactor, condUnit, COND_SHORT, fmtEur, fmtN, fmtRange, WEIGHT_VARS } from '../../lib/routes';
import { varLabel } from '../../lib/labels';
import { IconChevronDown, IconChevronUp, IconCopy, IconEdit, IconPlus, IconTrash } from '../Icons';
import { cleanComponents, OutputsEditor, summarizeComponents } from '../pricing/Outputs';
import { DerivedEditor, normalizeCard, NoMatchToggle, QuotePanel, SurchargesEditor } from '../pricing/RateCardEditor';
import { Alert, cx, EmptyState, errorsUnder, Field, ListInput, OptNumberInput, Segmented } from '../ui';

const ROOTS = ['costs'];
const COND_VARS = ['weightKg', 'chargeableWeightKg', 'volumetricWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'girthCm', 'sumDimensionsCm', 'volumeL', 'itemCount', 'parcelCount', 'orderAmount', 'goodsValue', 'distanceKm'];

/** The three fixed outputs of the route grid (carbon shown in grams). */
const OUTS: { key: string; label: string; unit: string; factor: number }[] = [
  { key: 'cost', label: 'Coût de transport', unit: '€', factor: 1 },
  { key: 'carbonKg', label: 'Empreinte carbone', unit: 'g', factor: 1000 },
  { key: 'price', label: 'Frais de livraison', unit: '€', factor: 1 },
];

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export const emptyRouteCard = (): RateCard => ({
  id: '',
  name: '',
  scope: 'PARCEL',
  currency: 'EUR',
  volumetricDivisor: 5000,
  noMatch: 'REJECT',
  derived: [],
  surcharges: [],
  active: true,
  rows: [
    { conditions: { chargeableWeightKg: { max: 1 } }, outputs: { cost: { fixed: 5 }, carbonKg: { fixed: 0.1 } } },
    { conditions: { chargeableWeightKg: { min: 1, max: 5 } }, outputs: { cost: { fixed: 8 }, carbonKg: { fixed: 0.12 } } },
    { conditions: { chargeableWeightKg: { min: 5, max: 30 } }, outputs: { cost: { fixed: 15 }, carbonKg: { fixed: 0.15 } } },
  ],
});

const EXTRA_SUFFIX: [keyof Components, string][] = [
  ['perKg', '/kg'],
  ['perItem', '/article'],
  ['perParcel', '/colis'],
  ['perKm', '/km'],
  ['perKgKm', '/kg·km'],
];

/** Displayed value of an output: "20 €", "120 g", "80 g + 0,25 g/kg·km". */
function fmtOut(c: Components | undefined, unit: string, factor: number): string {
  if (!c) return '-';
  const u = (n: number) => (unit === '€' ? fmtEur(n) : `${fmtN(round(n))} ${unit}`);
  const parts = [u((c.fixed ?? 0) * factor)];
  for (const [k, suffix] of EXTRA_SUFFIX) {
    const v = c[k] as number | undefined;
    if (v) parts.push(`${u(v * factor)}${suffix}`);
  }
  if (c.percentOfValue) parts.push(`${fmtN(c.percentOfValue)} % de la valeur`);
  for (const [k, v] of Object.entries(c.perUnit ?? {})) if (v) parts.push(`${u(v * factor)} × ${k}`);
  let s = parts.join(' + ');
  if (c.min !== undefined) s += ` (min ${u(c.min * factor)})`;
  if (c.max !== undefined) s += ` (max ${u(c.max * factor)})`;
  return s;
}

type SortKey = { key: string; kind: 'out' | 'cond'; dir: 1 | -1 };

export function RouteCosts({ card, onChange, error, startEditing }: { card: RateCard | undefined; onChange: (c: RateCard | undefined) => void; error: unknown; startEditing?: boolean }) {
  const fields = usePricingFields();
  const [editing, setEditing] = useState(!!startEditing);
  const [unit, setUnit] = useState<'g' | 'kg'>('g');
  const [extraConds, setExtraConds] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const derivedKeys = (card?.derived ?? []).map((d) => d.key).filter(Boolean);
  const variables = useMemo(() => {
    const all = [...COND_VARS, ...(fields.data?.rateVariables ?? []), ...derivedKeys];
    return all.filter((x, i) => all.indexOf(x) === i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.data, derivedKeys.join(',')]);
  const condCols = useMemo(() => {
    const seen: string[] = [];
    for (const r of card?.rows ?? []) for (const k of Object.keys(r.conditions ?? {})) if (!seen.includes(k)) seen.push(k);
    for (const k of extraConds) if (!seen.includes(k)) seen.push(k);
    return seen;
  }, [card?.rows, extraConds]);
  const customOuts = useMemo(() => {
    const seen: string[] = [];
    for (const r of card?.rows ?? []) for (const k of Object.keys(r.outputs ?? {})) if (!OUTS.some((o) => o.key === k) && !seen.includes(k)) seen.push(k);
    return seen;
  }, [card?.rows]);

  if (!card)
    return (
      <EmptyState title="Pas de grille de coûts sur cette route">
        <p className="m-0 mb-l">Les grilles du service ou du transporteur s'appliquent.</p>
        <button className="btn btn-primary" onClick={() => { onChange(emptyRouteCard()); setEditing(true); }} data-testid="create-route-card">
          <IconPlus /> Créer une grille
        </button>
      </EmptyState>
    );

  const set = <K extends keyof RateCard>(k: K, val: RateCard[K]) => onChange({ ...card, [k]: val });
  const setRows = (rows: RateRow[]) => set('rows', rows);
  const setRow = (i: number, r: RateRow) => setRows(card.rows.map((x, j) => (j === i ? r : x)));
  const hasWeight = condCols.some((k) => WEIGHT_VARS.has(k));
  const rowErrors = (i: number) => errorsUnder(error, `rows[${i}]`, ROOTS);
  const fe = (name: string) => errorsUnder(error, name, ROOTS)[0]?.message;

  // view rows (sorted copy with original index)
  const indexed = card.rows.map((r, i) => ({ r, i }));
  if (!editing && sort) {
    const val = (r: RateRow) => {
      if (sort.kind === 'out') return r.outputs?.[sort.key]?.fixed ?? -Infinity;
      const c = r.conditions?.[sort.key];
      return c ? c.max ?? c.min ?? 0 : -Infinity;
    };
    indexed.sort((a, b) => (val(a.r) - val(b.r)) * sort.dir);
  }
  const SortTh = ({ k, kind, children, className }: { k: string; kind: 'out' | 'cond'; children: React.ReactNode; className?: string }) => (
    <th className={cx('num', className)}>
      {editing ? (
        children
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-xs font-medium"
          onClick={() => setSort((s) => (s?.key === k ? (s.dir === 1 ? { key: k, kind, dir: -1 } : null) : { key: k, kind, dir: 1 }))}
        >
          {children}
          <span className="flex flex-col text-neutral-300">
            <IconChevronUp size={10} strokeWidth={3} className={cx(sort?.key === k && sort.dir === 1 && 'text-primary')} />
            <IconChevronDown size={10} strokeWidth={3} className={cx(sort?.key === k && sort.dir === -1 && 'text-primary')} />
          </span>
        </button>
      )}
    </th>
  );
  const removeCond = (k: string) => {
    setExtraConds((x) => x.filter((y) => y !== k));
    setRows(
      card.rows.map((r) => {
        const c = { ...(r.conditions ?? {}) };
        delete c[k];
        return { ...r, conditions: c };
      }),
    );
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= card.rows.length) return;
    const rows = [...card.rows];
    [rows[i], rows[j]] = [rows[j], rows[i]];
    setRows(rows);
    if (open === i) setOpen(j);
  };
  const nCols = 3 + condCols.length + customOuts.length + (editing ? 2 : 0);

  return (
    <div className="flex flex-col gap-xl" data-testid="route-costs">
      <div className="flex flex-wrap items-center gap-m">
        <Segmented<'view' | 'edit'>
          value={editing ? 'edit' : 'view'}
          onChange={(x) => setEditing(x === 'edit')}
          options={[
            { value: 'view', label: 'Consulter' },
            { value: 'edit', label: <span className="inline-flex items-center gap-s"><IconEdit size={16} /> Modifier la grille</span> },
          ]}
        />
        {hasWeight && (
          <Segmented<'g' | 'kg'>
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'g', label: 'g' },
              { value: 'kg', label: 'kg' },
            ]}
          />
        )}
        {editing && (
          <>
            <select className="select h-[36px] w-[220px]" value="" aria-label="Ajouter une condition" data-testid="add-condition" onChange={(e) => e.target.value && setExtraConds((x) => [...x, e.target.value])}>
              <option value="">Ajouter une condition</option>
              {variables
                .filter((x) => !condCols.includes(x))
                .map((x) => (
                  <option key={x} value={x}>
                    {varLabel(x)}
                  </option>
                ))}
            </select>
            <button
              className="btn btn-secondary"
              data-testid="add-row"
              onClick={() => {
                const last = card.rows[card.rows.length - 1];
                const conds: Record<string, Range> = {};
                for (const [k, r] of Object.entries(last?.conditions ?? {})) if (r.max !== undefined) conds[k] = { min: r.max };
                setRows([...card.rows, { conditions: conds, outputs: last ? JSON.parse(JSON.stringify(last.outputs)) : { cost: { fixed: 0 } } }]);
              }}
            >
              <IconPlus /> Ajouter une ligne
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {card.rows.length} ligne{card.rows.length > 1 ? 's' : ''} · première ligne correspondante retenue
        </span>
      </div>
      {editing && <Alert kind="info">Les lignes sont évaluées dans l'ordre. Bornes [min, max) : minimum inclus, maximum exclu, case vide = ouverte. Le chevron d'une ligne ouvre ses composantes avancées (par kg, par kg·km, minimum…).</Alert>}
      {fe('rows') && !card.rows.length && <div className="field-error">{fe('rows')}</div>}

      <div className="overflow-x-auto rounded-m border border-border">
        <table className={cx('table', editing && 'table-compact')} data-testid="route-cost-table">
          <thead>
            <tr>
              {editing && <th className="w-[32px]">#</th>}
              {OUTS.map((o) => (
                <SortTh key={o.key} k={o.key} kind="out" className="min-w-[130px]">
                  {o.label} ({o.unit})
                </SortTh>
              ))}
              {customOuts.map((k) => (
                <SortTh key={k} k={k} kind="out">
                  {k}
                </SortTh>
              ))}
              {condCols.map((k) => (
                <SortTh key={k} k={k} kind="cond" className="min-w-[150px]">
                  <span className="inline-flex items-center gap-s" title={varLabel(k)}>
                    {COND_SHORT[k] ?? k}
                    {condUnit(k, unit) && <span className="font-normal text-neutral-500">({condUnit(k, unit)})</span>}
                    {editing && (
                      <button type="button" className="btn btn-tertiary btn-sm btn-icon h-[22px] w-[22px]" onClick={() => removeCond(k)} title="Retirer la colonne" aria-label={`Retirer la condition ${k}`}>
                        <IconTrash size={14} />
                      </button>
                    )}
                  </span>
                </SortTh>
              ))}
              {editing && <th className="w-[150px]"></th>}
            </tr>
          </thead>
          <tbody>
            {indexed.map(({ r, i }) => {
              const errs = rowErrors(i);
              return (
                <Fragment key={i}>
                  <tr className={cx(errs.length > 0 && 'bg-red-tint')} data-testid="route-cost-row">
                    {editing && <td className="text-xs text-neutral-500">{i + 1}</td>}
                    {OUTS.map((o) => (
                      <td key={o.key} className="num whitespace-nowrap">
                        {editing ? (
                          <FixedInput value={r.outputs?.[o.key]} factor={o.factor} label={`${o.label} ligne ${i + 1}`} onChange={(c) => setRow(i, { ...r, outputs: withOutput(r.outputs, o.key, c) })} />
                        ) : (
                          fmtOut(r.outputs?.[o.key], o.unit, o.factor)
                        )}
                      </td>
                    ))}
                    {customOuts.map((k) => (
                      <td key={k} className="num whitespace-nowrap text-xs">
                        {r.outputs?.[k] ? summarizeComponents(cleanComponents(r.outputs[k])) : '-'}
                      </td>
                    ))}
                    {condCols.map((k) => (
                      <td key={k} className="num whitespace-nowrap">
                        {editing ? (
                          <ScaledRange value={r.conditions?.[k]} factor={condFactor(k, unit)} invalid={errs.some((e) => e.field.includes('conditions'))} onChange={(x) => setRow(i, { ...r, conditions: withCond(r.conditions, k, x) })} />
                        ) : (
                          fmtRange(r.conditions?.[k], condUnit(k, unit), condFactor(k, unit))
                        )}
                      </td>
                    ))}
                    {editing && (
                      <td className="whitespace-nowrap text-right">
                        <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => setOpen(open === i ? null : i)} aria-label="Composantes avancées" title="Composantes avancées" aria-expanded={open === i}>
                          {open === i ? <IconChevronUp /> : <IconChevronDown />}
                        </button>
                        <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter la ligne" title="Monter la ligne">
                          <IconChevronUp size={16} />
                        </button>
                        <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => move(i, 1)} disabled={i === card.rows.length - 1} aria-label="Descendre la ligne" title="Descendre la ligne">
                          <IconChevronDown size={16} />
                        </button>
                        <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => setRows([...card.rows.slice(0, i + 1), JSON.parse(JSON.stringify(r)), ...card.rows.slice(i + 1)])} aria-label="Dupliquer la ligne" title="Dupliquer la ligne">
                          <IconCopy />
                        </button>
                        <button
                          className="btn btn-tertiary-red btn-sm btn-icon"
                          onClick={() => {
                            setRows(card.rows.filter((_, j) => j !== i));
                            setOpen(null);
                          }}
                          aria-label="Supprimer la ligne"
                          title="Supprimer la ligne"
                        >
                          <IconTrash />
                        </button>
                      </td>
                    )}
                  </tr>
                  {editing && open === i && (
                    <tr>
                      <td colSpan={nCols} className="bg-neutral-20 py-l">
                        <div className="grid gap-l lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                          <div className="flex flex-col gap-m">
                            <Field label="Libellé de la ligne">
                              <input className="input" value={r.label ?? ''} onChange={(e) => setRow(i, { ...r, label: e.target.value })} />
                            </Field>
                            <Field label="Départements (vide = tous)">
                              <ListInput value={r.zones} onChange={(z) => setRow(i, { ...r, zones: z })} placeholder="20, 2A" />
                            </Field>
                          </div>
                          <div>
                            <div className="field-label">Sorties et composantes (carbone en kg CO2e)</div>
                            <OutputsEditor value={r.outputs} onChange={(o) => setRow(i, { ...r, outputs: o })} variables={variables} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {errs.length > 0 && (
                    <tr className="bg-red-tint">
                      <td colSpan={nCols} className="text-xs" style={{ color: 'var(--red-1000)' }}>
                        Ligne {i + 1} : {errs.map((e) => `${e.field.replace(`rows[${i}]`, '').replace(/^\./, '') || 'ligne'} ${e.message}`).join(' · ')}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {card.rows.length === 0 && <EmptyState title="Aucune ligne">Ajouter au moins une ligne.</EmptyState>}
      </div>

      <section className="grid gap-l md:grid-cols-3">
        <Field label="Portée" hint="Colis : chaque colis ; expédition : une fois pour les colis partageant le trajet" error={fe('scope')}>
          <Segmented<RateScope>
            value={card.scope === 'SHIPMENT' ? 'SHIPMENT' : 'PARCEL'}
            onChange={(s) => set('scope', s)}
            options={[
              { value: 'PARCEL', label: 'Colis' },
              { value: 'SHIPMENT', label: 'Expédition' },
            ]}
          />
        </Field>
        <Field label="Diviseur volumétrique (cm³/kg)" hint="Poids taxable = max(poids réel, volume / diviseur)" error={fe('volumetricDivisor')}>
          <OptNumberInput value={card.volumetricDivisor} onChange={(n) => set('volumetricDivisor', n)} placeholder="5000" ariaLabel="Diviseur volumétrique" />
        </Field>
        <Field label="Si aucune ligne ne correspond" error={fe('noMatch')}>
          <NoMatchToggle value={card.noMatch} onChange={(x) => set('noMatch', x)} />
        </Field>
      </section>

      <div className="grid gap-l 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-l">
          <SurchargesEditor value={card.surcharges ?? []} onChange={(s) => set('surcharges', s)} variables={variables} error={error} />
          <DerivedEditor value={card.derived ?? []} onChange={(d) => set('derived', d)} variables={fields.data?.rateVariables ?? []} error={fe('derived')} />
          <div>
            <button className="btn btn-tertiary-red btn-sm" onClick={() => onChange(undefined)}>
              <IconTrash /> Retirer la grille de la route
            </button>
          </div>
        </div>
        <div className="min-w-0">
          <QuotePanel card={card} normalized={{ ...normalizeCard(card), id: 'ROUTE', name: card.name || 'Route' }} dirty />
        </div>
      </div>
    </div>
  );
}

function withOutput(o: RateRow['outputs'] | undefined, key: string, c: Components | undefined) {
  const out = { ...(o ?? {}) };
  if (c) out[key] = c;
  else delete out[key];
  return out;
}

function withCond(cs: Record<string, Range> | undefined, key: string, r: Range | undefined) {
  const out = { ...(cs ?? {}) };
  if (r) out[key] = r;
  else delete out[key];
  return out;
}

/** Fixed value of an output (other components kept). Empty = output removed when it has nothing else. */
function FixedInput({ value, factor, label, onChange }: { value: Components | undefined; factor: number; label: string; onChange: (c: Components | undefined) => void }) {
  const extra = value ? Object.keys(cleanComponents({ ...value, fixed: undefined })).length : 0;
  return (
    <span className="inline-flex items-center justify-end gap-xs">
      <OptNumberInput
        value={value?.fixed === undefined ? (value ? 0 : undefined) : round(value.fixed * factor)}
        onChange={(n) => {
          if (n === undefined) onChange(extra ? { ...value, fixed: undefined } : undefined);
          else onChange({ ...(value ?? {}), fixed: round(n / factor) });
        }}
        placeholder="-"
        className="h-[30px] w-[96px] px-m text-right text-xs"
        ariaLabel={label}
      />
      {extra > 0 && (
        <span className="text-2xs text-neutral-500" title={summarizeComponents(cleanComponents({ ...value!, fixed: undefined }))}>
          +{extra}
        </span>
      )}
    </span>
  );
}

function ScaledRange({ value, factor, onChange, invalid }: { value: Range | undefined; factor: number; onChange: (r: Range | undefined) => void; invalid?: boolean }) {
  const v = value ?? {};
  const set = (r: Range) => onChange(r.min === undefined && r.max === undefined ? undefined : r);
  const show = (x: number | undefined) => (x === undefined ? undefined : round(x * factor));
  const back = (x: number | undefined) => (x === undefined ? undefined : round(x / factor));
  return (
    <span className="inline-grid grid-cols-2 gap-xs">
      <OptNumberInput value={show(v.min)} onChange={(min) => set({ ...v, min: back(min) })} placeholder="≥ min" className="h-[30px] w-[84px] px-m text-xs" invalid={invalid} ariaLabel="Minimum (inclus)" />
      <OptNumberInput value={show(v.max)} onChange={(max) => set({ ...v, max: back(max) })} placeholder="< max" className="h-[30px] w-[84px] px-m text-xs" invalid={invalid} ariaLabel="Maximum (exclu)" />
    </span>
  );
}


