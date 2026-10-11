import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useCarriers, useCrud, usePricingFields, useQuote } from '../../api/hooks';
import type { Components, DerivedMetric, Range, RateCard, RateRow, RateScope, Surcharge } from '../../api/types';
import { RATE_SCOPES } from '../../api/types';
import { IconChevronDown, IconChevronUp, IconCopy, IconPlay, IconPlus, IconTrash } from '../Icons';
import { cleanComponents, cleanOutputs, ComponentsCell, OutputsEditor, RangeCell, STANDARD_OUTPUTS, summarizeComponents } from './Outputs';
import { RuleBuilder } from './RuleBuilder';
import { SkuInput } from '../sim/SkuInput';
import { Alert, Badge, Card, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, errorsUnder, Field, ListInput, NumberInput, OptNumberInput, Segmented, Spinner, Switch, useToast } from '../ui';
import { fmtNum } from '../../lib/format';
import { outputLabel, RATE_SCOPE_HINT, RATE_SCOPE_LABEL, varLabel } from '../../lib/labels';

/**
 * Reusable rate card editing blocks: card parameters, derived metrics, rows
 * table, surcharges and a quote panel. Used by the delivery mode customer
 * price grids and by the carrier route cost grid.
 */

export const RATE_CARD_ROOTS = ['rateCard', 'card', 'costs'];

export const emptyCard = (scope: RateScope = 'PARCEL', carrierId = ''): RateCard => ({
  id: '',
  name: '',
  carrierId,
  scope,
  currency: 'EUR',
  volumetricDivisor: scope === 'ORDER' ? undefined : 5000,
  derived: [],
  rows: scope === 'ORDER' ? [{ label: 'Moins de 50 €', conditions: { orderAmount: { max: 50 } }, outputs: { price: { fixed: 4.9 } } }, { label: 'Franco', conditions: { orderAmount: { min: 50 } }, outputs: { price: { fixed: 0 } } }] : [{ label: 'Toutes tailles', conditions: {}, outputs: { cost: { fixed: 5 } } }],
  surcharges: [],
  noMatch: scope === 'ORDER' ? 'ZERO' : 'REJECT',
  active: true,
});

/** Card ready for the API: empty optional values removed. */
export function normalizeCard(c: RateCard): RateCard {
  const conds = (m?: Record<string, Range>) => Object.fromEntries(Object.entries(m ?? {}).filter(([, r]) => r && (r.min !== undefined || r.max !== undefined)));
  const opt = <T,>(arr: T[] | undefined) => (arr && arr.length ? arr : undefined);
  return {
    ...c,
    carrierId: c.carrierId || undefined,
    description: c.description || undefined,
    volumetricDivisor: c.volumetricDivisor || undefined,
    noMatch: c.noMatch || undefined,
    derived: opt((c.derived ?? []).map((d) => ({ ...d, label: d.label || undefined, terms: d.terms.filter((t) => t.var) }))),
    rows: c.rows.map((r) => ({
      label: r.label || undefined,
      conditions: Object.keys(conds(r.conditions)).length ? conds(r.conditions) : undefined,
      zones: opt(r.zones),
      outputs: cleanOutputs(r.outputs),
    })),
    surcharges: opt(
      (c.surcharges ?? []).map((s) => ({
        label: s.label,
        conditions: Object.keys(conds(s.conditions)).length ? conds(s.conditions) : undefined,
        zones: opt(s.zones),
        rules: opt(s.rules),
        outputs: cleanOutputs(s.outputs),
      })),
    ),
  };
}

/** Local editing state of a card (lists always defined). */
export const editable = (c: RateCard): RateCard => ({ ...c, rows: c.rows ?? [], derived: c.derived ?? [], surcharges: c.surcharges ?? [], noMatch: c.noMatch ?? '' });

/** Full card editor: parameters, derived metrics, rows, surcharges. */
export function RateCardForm({ value: v, onChange, error, isNew, showCarrier = true, scopes = RATE_SCOPES }: { value: RateCard; onChange: (c: RateCard) => void; error?: unknown; isNew: boolean; showCarrier?: boolean; scopes?: RateScope[] }) {
  const carriers = useCarriers();
  const fields = usePricingFields();
  const set = <K extends keyof RateCard>(k: K, val: RateCard[K]) => onChange({ ...v, [k]: val });
  const fe = (name: string) => errorsUnder(error, name, RATE_CARD_ROOTS)[0]?.message;
  const derivedKeys = (v.derived ?? []).map((d) => d.key).filter(Boolean);
  const variables = [...(fields.data?.rateVariables ?? []), ...derivedKeys];
  return (
    <div className="flex min-w-0 flex-col gap-l">
      <Card title="Paramètres de la grille">
        <div className="grid gap-l md:grid-cols-2">
          <Field label="Identifiant" error={fe('id')}>
            <input className={cx('input', fe('id') && 'invalid')} value={v.id} disabled={!isNew} onChange={(e) => set('id', e.target.value)} placeholder="RC-FRANCO-50" />
          </Field>
          <Field label="Nom" error={fe('name')}>
            <input className={cx('input', fe('name') && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          {showCarrier && (
            <Field label="Transporteur" error={fe('carrierId')}>
              <select className="select" value={v.carrierId ?? ''} onChange={(e) => set('carrierId', e.target.value)}>
                <option value="">Aucun (grille client)</option>
                {(carriers.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scopes.length > 1 && (
            <Field label="Portée" className="md:col-span-2" hint={RATE_SCOPE_HINT[v.scope]} error={fe('scope')}>
              <Segmented<RateScope> value={v.scope} onChange={(s) => set('scope', s)} options={scopes.map((s) => ({ value: s, label: RATE_SCOPE_LABEL[s] }))} />
            </Field>
          )}
          <Field label="Devise">
            <input className="input" value={v.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} />
          </Field>
          {v.scope !== 'ORDER' && (
            <Field label="Diviseur volumétrique (cm³/kg)" hint="Ex. 5000 ; vide = pas de poids volumétrique" error={fe('volumetricDivisor')}>
              <OptNumberInput value={v.volumetricDivisor} onChange={(n) => set('volumetricDivisor', n)} placeholder="5000" />
            </Field>
          )}
          <Field label="Si aucune ligne ne correspond" className="md:col-span-2" error={fe('noMatch')}>
            <NoMatchToggle value={v.noMatch} onChange={(x) => set('noMatch', x)} />
          </Field>
          <Field label="Description" className="md:col-span-2">
            <input className="input" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <div className="mt-l">
          <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Grille active' : 'Grille inactive'} />
        </div>
      </Card>
      <DerivedEditor value={v.derived ?? []} onChange={(d) => set('derived', d)} variables={fields.data?.rateVariables ?? []} error={errorsUnder(error, 'derived', RATE_CARD_ROOTS)[0]?.message} />
      <RowsEditor card={v} onChange={onChange} variables={variables} error={error} />
      <SurchargesEditor value={v.surcharges ?? []} onChange={(s) => set('surcharges', s)} variables={variables} error={error} />
    </div>
  );
}

export function NoMatchToggle({ value, onChange }: { value: RateCard['noMatch']; onChange: (v: 'REJECT' | 'ZERO') => void }) {
  return (
    <Segmented<'REJECT' | 'ZERO'>
      value={value === 'REJECT' ? 'REJECT' : 'ZERO'}
      onChange={onChange}
      options={[
        { value: 'REJECT', label: 'Refuser la route' },
        { value: 'ZERO', label: 'Ne rien ajouter' },
      ]}
    />
  );
}

/** Generic rows table (all conditions, zones and outputs with their components). */
export function RowsEditor({ card: v, onChange, variables, error }: { card: RateCard; onChange: (c: RateCard) => void; variables: string[]; error?: unknown }) {
  const [extraConds, setExtraConds] = useState<string[]>([]);
  const [extraOutputs, setExtraOutputs] = useState<string[]>([]);
  const [customOut, setCustomOut] = useState('');
  const setRows = (rows: RateRow[]) => onChange({ ...v, rows });
  const condCols = useMemo(() => {
    const seen: string[] = [];
    for (const r of v.rows) for (const k of Object.keys(r.conditions ?? {})) if (!seen.includes(k)) seen.push(k);
    for (const k of extraConds) if (!seen.includes(k)) seen.push(k);
    return seen;
  }, [v.rows, extraConds]);
  const outCols = useMemo(() => {
    const seen = v.scope === 'ORDER' ? ['price'] : [...STANDARD_OUTPUTS];
    for (const r of v.rows) for (const k of Object.keys(r.outputs ?? {})) if (!seen.includes(k)) seen.push(k);
    for (const k of extraOutputs) if (!seen.includes(k)) seen.push(k);
    return seen;
  }, [v.rows, v.scope, extraOutputs]);
  const moveRow = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= v.rows.length) return;
    const rows = [...v.rows];
    [rows[i], rows[j]] = [rows[j], rows[i]];
    setRows(rows);
  };
  const removeCond = (k: string) => {
    setExtraConds((x) => x.filter((y) => y !== k));
    setRows(
      v.rows.map((r) => {
        const c = { ...(r.conditions ?? {}) };
        delete c[k];
        return { ...r, conditions: c };
      }),
    );
  };
  const removeOutput = (k: string) => {
    setExtraOutputs((x) => x.filter((y) => y !== k));
    setRows(
      v.rows.map((r) => {
        const o = { ...r.outputs };
        delete o[k];
        return { ...r, outputs: o };
      }),
    );
  };
  return (
    <Card
      title={`Lignes de la grille (${v.rows.length})`}
      bodyClassName=""
      actions={
        <button className="btn btn-secondary btn-sm" onClick={() => setRows([...v.rows, { label: '', conditions: {}, outputs: v.rows.length ? JSON.parse(JSON.stringify(v.rows[v.rows.length - 1].outputs)) : { cost: {} } }])} data-testid="add-row">
          <IconPlus /> Ajouter une ligne
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-m border-b border-border px-xl py-m">
        <Alert kind="info" className="min-w-[240px] flex-1 py-s">
          L'ordre compte : la première ligne dont toutes les conditions correspondent est retenue. Condition [min, max) : minimum inclus, maximum exclu, case vide = ouverte.
        </Alert>
        <select className="select h-[30px] w-[220px] text-xs" value="" aria-label="Ajouter une condition" data-testid="add-condition" onChange={(e) => e.target.value && setExtraConds((x) => [...x, e.target.value])}>
          <option value="">Ajouter une condition</option>
          {variables
            .filter((x) => !condCols.includes(x))
            .map((x) => (
              <option key={x} value={x}>
                {varLabel(x)}
              </option>
            ))}
        </select>
        <div className="flex items-center gap-s">
          <input className="input h-[30px] w-[150px] text-xs" value={customOut} onChange={(e) => setCustomOut(e.target.value.replace(/\s/g, ''))} placeholder="Sortie personnalisée" aria-label="Sortie personnalisée" />
          <button
            className="btn btn-tertiary btn-sm"
            disabled={!customOut || outCols.includes(customOut)}
            onClick={() => {
              setExtraOutputs((x) => [...x, customOut]);
              setCustomOut('');
            }}
          >
            <IconPlus /> Sortie
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table table-compact" data-testid="rate-rows">
          <thead>
            <tr>
              <th className="w-[32px]">#</th>
              <th className="min-w-[140px]">Libellé</th>
              {condCols.map((k) => (
                <th key={k} className="min-w-[150px]" style={{ background: 'var(--blue-t-100)' }}>
                  <span className="flex items-center justify-between gap-s">
                    <span className="truncate" title={k}>
                      {varLabel(k)}
                    </span>
                    <button className="btn btn-tertiary btn-sm btn-icon h-[22px] w-[22px]" onClick={() => removeCond(k)} title="Retirer la condition" aria-label={`Retirer la condition ${k}`}>
                      <IconTrash size={14} />
                    </button>
                  </span>
                </th>
              ))}
              <th className="min-w-[130px]" style={{ background: 'var(--blue-t-100)' }}>
                Zones (départements)
              </th>
              {outCols.map((k) => (
                <th key={k} className="min-w-[150px]" style={{ background: 'var(--primary-t-100)' }}>
                  <span className="flex items-center justify-between gap-s">
                    <span className="truncate" title={k}>
                      {outputLabel(k)}
                    </span>
                    {!STANDARD_OUTPUTS.includes(k) && (
                      <button className="btn btn-tertiary btn-sm btn-icon h-[22px] w-[22px]" onClick={() => removeOutput(k)} title="Retirer la sortie" aria-label={`Retirer la sortie ${k}`}>
                        <IconTrash size={14} />
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th className="w-[120px]"></th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r, i) => {
              const errs = errorsUnder(error, `rows[${i}]`, RATE_CARD_ROOTS);
              return (
                <RowEditor
                  key={i}
                  index={i}
                  row={r}
                  condCols={condCols}
                  outCols={outCols}
                  variables={variables}
                  errors={errs.map((e) => `${e.field.replace(`rows[${i}]`, '').replace(/^\./, '') || 'ligne'} : ${e.message}`)}
                  onChange={(x) => setRows(v.rows.map((y, j) => (j === i ? x : y)))}
                  onMove={(d) => moveRow(i, d)}
                  onDuplicate={() => setRows([...v.rows.slice(0, i + 1), JSON.parse(JSON.stringify(r)), ...v.rows.slice(i + 1)])}
                  onRemove={() => setRows(v.rows.filter((_, j) => j !== i))}
                  last={i === v.rows.length - 1}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {v.rows.length === 0 && <EmptyState title="Aucune ligne">Ajouter au moins une ligne.</EmptyState>}
    </Card>
  );
}

function RowEditor({
  index,
  row,
  condCols,
  outCols,
  variables,
  errors,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  last,
}: {
  index: number;
  row: RateRow;
  condCols: string[];
  outCols: string[];
  variables: string[];
  errors: string[];
  onChange: (r: RateRow) => void;
  onMove: (d: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  last: boolean;
}) {
  const setCond = (k: string, r: Range | undefined) => {
    const c = { ...(row.conditions ?? {}) };
    if (r) c[k] = r;
    else delete c[k];
    onChange({ ...row, conditions: c });
  };
  const setOut = (k: string, c: Components | undefined) => {
    const o = { ...row.outputs };
    if (c) o[k] = c;
    else delete o[k];
    onChange({ ...row, outputs: o });
  };
  const invalid = errors.length > 0;
  return (
    <>
      <tr className={cx(invalid && 'bg-red-tint')} data-testid="rate-row">
        <td className="text-xs text-neutral-500">{index + 1}</td>
        <td>
          <input className="input h-[30px] px-m text-xs" value={row.label ?? ''} onChange={(e) => onChange({ ...row, label: e.target.value })} placeholder="Libellé" aria-label="Libellé de la ligne" />
        </td>
        {condCols.map((k) => (
          <td key={k}>
            <RangeCell value={row.conditions?.[k]} onChange={(r) => setCond(k, r)} invalid={invalid && errors.some((e) => e.includes('conditions'))} />
          </td>
        ))}
        <td>
          <ListInput value={row.zones} onChange={(z) => onChange({ ...row, zones: z })} placeholder="Toutes" />
        </td>
        {outCols.map((k) => (
          <td key={k}>
            <ComponentsCell value={row.outputs?.[k]} onChange={(c) => setOut(k, c)} variables={variables} outputKey={k} />
          </td>
        ))}
        <td className="whitespace-nowrap text-right">
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Monter la ligne" title="Monter la ligne">
            <IconChevronUp />
          </button>
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => onMove(1)} disabled={last} aria-label="Descendre la ligne" title="Descendre la ligne">
            <IconChevronDown />
          </button>
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={onDuplicate} aria-label="Dupliquer la ligne" title="Dupliquer la ligne">
            <IconCopy />
          </button>
          <button className="btn btn-tertiary-red btn-sm btn-icon" onClick={onRemove} aria-label="Supprimer la ligne" title="Supprimer la ligne">
            <IconTrash />
          </button>
        </td>
      </tr>
      {invalid && (
        <tr className="bg-red-tint">
          <td></td>
          <td colSpan={condCols.length + outCols.length + 3} className="pt-0 text-xs" style={{ color: 'var(--red-1000)' }}>
            {errors.join(' · ')}
          </td>
        </tr>
      )}
    </>
  );
}

export function DerivedEditor({ value, onChange, variables, error }: { value: DerivedMetric[]; onChange: (d: DerivedMetric[]) => void; variables: string[]; error?: string }) {
  const set = (i: number, d: DerivedMetric) => onChange(value.map((x, j) => (j === i ? d : x)));
  return (
    <Card
      title="Métriques dérivées"
      actions={
        <button className="btn btn-secondary btn-sm" onClick={() => onChange([...value, { key: '', label: '', terms: [{ var: 'lengthCm', coef: 1 }] }])}>
          <IconPlus /> Ajouter une métrique
        </button>
      }
    >
      <p className="m-0 mb-l text-xs text-neutral-500">Combinaisons linéaires de variables utilisables comme conditions ou taux, par exemple longueur + 2 × largeur + 2 × hauteur.</p>
      {value.length === 0 && <div className="text-xs text-neutral-500">Aucune métrique dérivée</div>}
      <div className="flex flex-col gap-m">
        {value.map((d, i) => (
          <div key={i} className="rounded-m border border-border p-m">
            <div className="grid gap-m sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_36px]">
              <Field label="Clé">
                <input className="input" value={d.key} onChange={(e) => set(i, { ...d, key: e.target.value.replace(/\s/g, '') })} placeholder="longueurPlusPourtour" />
              </Field>
              <Field label="Libellé">
                <input className="input" value={d.label ?? ''} onChange={(e) => set(i, { ...d, label: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button className="btn btn-tertiary-red btn-icon" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Supprimer la métrique" title="Supprimer la métrique">
                  <IconTrash />
                </button>
              </div>
            </div>
            <div className="mt-m flex flex-wrap items-center gap-s">
              <span className="text-xs text-neutral-700">{d.key || 'métrique'} =</span>
              {d.terms.map((t, k) => (
                <span key={k} className="inline-flex items-center gap-xs rounded-m border border-border bg-neutral-20 px-s py-xs">
                  {k > 0 && <span className="px-xs text-neutral-500">+</span>}
                  <input type="number" step="any" className="input h-[28px] w-[64px] px-s text-xs" value={t.coef} onChange={(e) => set(i, { ...d, terms: d.terms.map((x, j) => (j === k ? { ...x, coef: Number(e.target.value) } : x)) })} aria-label="Coefficient" />
                  <span className="text-neutral-500">×</span>
                  <select className="select h-[28px] w-[170px] text-xs" value={t.var} onChange={(e) => set(i, { ...d, terms: d.terms.map((x, j) => (j === k ? { ...x, var: e.target.value } : x)) })} aria-label="Variable">
                    {variables.map((x) => (
                      <option key={x} value={x}>
                        {varLabel(x)}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-tertiary btn-sm btn-icon h-[24px] w-[24px]" onClick={() => set(i, { ...d, terms: d.terms.filter((_, j) => j !== k) })} aria-label="Retirer le terme">
                    <IconTrash size={14} />
                  </button>
                </span>
              ))}
              <button className="btn btn-tertiary btn-sm" onClick={() => set(i, { ...d, terms: [...d.terms, { var: 'widthCm', coef: 1 }] })}>
                <IconPlus /> Terme
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="field-error mt-m">{error}</div>}
    </Card>
  );
}

export function ConditionsList({ value, onChange, variables }: { value: Record<string, Range> | undefined; onChange: (c: Record<string, Range>) => void; variables: string[] }) {
  const entries = Object.entries(value ?? {});
  const rename = (from: string, to: string) => onChange(Object.fromEntries(entries.map(([k, r]) => [k === from ? to : k, r])));
  return (
    <div className="flex flex-col gap-s">
      {entries.length === 0 && <div className="text-xs text-neutral-500">Aucune condition</div>}
      {entries.map(([k, r]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-s">
          <select className="select h-[30px] text-xs" value={k} onChange={(e) => rename(k, e.target.value)} aria-label="Variable">
            {[k, ...variables.filter((x) => x !== k && !(x in (value ?? {})))].map((x) => (
              <option key={x} value={x}>
                {varLabel(x)}
              </option>
            ))}
          </select>
          <RangeCell value={r} onChange={(x) => onChange({ ...(value ?? {}), [k]: x ?? {} })} />
          <button
            className="btn btn-tertiary-red btn-sm btn-icon"
            onClick={() => {
              const c = { ...(value ?? {}) };
              delete c[k];
              onChange(c);
            }}
            aria-label="Retirer la condition"
          >
            <IconTrash />
          </button>
        </div>
      ))}
      <div>
        <button
          className="btn btn-tertiary btn-sm"
          onClick={() => {
            const k = variables.find((x) => !(x in (value ?? {})));
            if (k) onChange({ ...(value ?? {}), [k]: { min: 0 } });
          }}
        >
          <IconPlus /> Condition
        </button>
      </div>
    </div>
  );
}

export function SurchargesEditor({ value, onChange, variables, error }: { value: Surcharge[]; onChange: (s: Surcharge[]) => void; variables: string[]; error: unknown }) {
  const set = (i: number, s: Surcharge) => onChange(value.map((x, j) => (j === i ? s : x)));
  return (
    <Card
      title={`Suppléments (${value.length})`}
      actions={
        <button className="btn btn-secondary btn-sm" onClick={() => onChange([...value, { label: '', outputs: { cost: { fixed: 1 } } }])}>
          <IconPlus /> Ajouter un supplément
        </button>
      }
    >
      <p className="m-0 mb-l text-xs text-neutral-500">Les suppléments s'ajoutent à la ligne retenue quand toutes leurs conditions correspondent (cumulatifs). Les règles articles s'appliquent si au moins un article du colis correspond.</p>
      {value.length === 0 && <div className="text-xs text-neutral-500">Aucun supplément</div>}
      <div className="flex flex-col gap-l">
        {value.map((s, i) => {
          const errs = errorsUnder(error, `surcharges[${i}]`, RATE_CARD_ROOTS);
          return (
            <div key={i} className={cx('rounded-m border p-l', errs.length ? 'border-error' : 'border-border')} data-testid="surcharge">
              <div className="grid gap-m sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_36px]">
                <Field label="Libellé">
                  <input className="input" value={s.label} onChange={(e) => set(i, { ...s, label: e.target.value })} placeholder="Hors gabarit" />
                </Field>
                <Field label="Zones (départements)" hint="Vide = toutes">
                  <ListInput value={s.zones} onChange={(z) => set(i, { ...s, zones: z })} placeholder="20, 2A, 2B" />
                </Field>
                <div className="flex items-end">
                  <button className="btn btn-tertiary-red btn-icon" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Supprimer le supplément" title="Supprimer le supplément">
                    <IconTrash />
                  </button>
                </div>
              </div>
              <div className="mt-l grid gap-l xl:grid-cols-2">
                <div>
                  <div className="os-label mb-s">Conditions</div>
                  <ConditionsList value={s.conditions} onChange={(c) => set(i, { ...s, conditions: c })} variables={variables} />
                </div>
                <div>
                  <div className="os-label mb-s">Sorties ajoutées</div>
                  <OutputsEditor value={s.outputs} onChange={(o) => set(i, { ...s, outputs: o })} variables={variables} />
                </div>
              </div>
              <div className="mt-l">
                <div className="os-label mb-s">Règles articles</div>
                <RuleBuilder rules={s.rules} onChange={(r) => set(i, { ...s, rules: r })} emptyText="Aucune règle : le supplément ne dépend pas des articles" />
              </div>
              {errs.length > 0 && <div className="field-error mt-m">{errs.map((e) => `${e.field} : ${e.message}`).join(' · ')}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quote simulation

export function QuotePanel({ card, normalized, dirty }: { card: RateCard; normalized: RateCard; dirty: boolean }) {
  const [lines, setLines] = useState<{ sku: string; quantity: number }[]>([{ sku: 'SKU-00001', quantity: 2 }]);
  const [vars, setVars] = useState<{ name: string; value: number }[]>([]);
  const [zone, setZone] = useState('75');
  const [orderAmount, setOrderAmount] = useState<number | undefined>(undefined);
  const fields = usePricingFields();
  const quote = useQuote();
  const variables = [...(fields.data?.rateVariables ?? []), ...(card.derived ?? []).map((d) => d.key).filter(Boolean)];
  const run = () =>
    quote.mutate({
      id: dirty ? undefined : card.id,
      body: {
        card: dirty ? { ...normalized, id: normalized.id || 'APERCU', name: normalized.name || 'Aperçu' } : undefined,
        items: lines.filter((l) => l.sku.trim()).map((l) => ({ sku: l.sku.trim(), quantity: l.quantity })),
        vars: vars.length ? Object.fromEntries(vars.map((x) => [x.name, x.value])) : undefined,
        zone: zone.trim() || undefined,
        orderAmount,
      },
    });
  // re-run when the result is visible and the card changes
  const key = JSON.stringify(normalized);
  useEffect(() => {
    if (quote.data && !quote.isPending) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const r = quote.data;
  const fe = (name: string) => errorsUnder(quote.error, name)[0]?.message;
  return (
    <Card title="Simuler" icon={<IconPlay size={20} />} className="min-w-0" bodyClassName="card-pad" actions={<span className="text-2xs text-neutral-500">{dirty ? 'Grille en cours d’édition' : 'Grille enregistrée'}</span>}>
      <div className="flex flex-col gap-l" data-testid="quote-panel">
        <div>
          <div className="mb-s flex items-center justify-between">
            <span className="field-label m-0">Panier</span>
            <button className="btn btn-tertiary btn-sm" onClick={() => setLines([...lines, { sku: '', quantity: 1 }])}>
              <IconPlus /> Ligne
            </button>
          </div>
          <div className="flex flex-col gap-s">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_32px] gap-s">
                <SkuInput value={l.sku} onChange={(s) => setLines(lines.map((x, j) => (j === i ? { ...x, sku: s } : x)))} />
                <input type="number" min={1} className="input" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="Quantité" />
                <button className="btn btn-tertiary-red btn-icon" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Retirer la ligne">
                  <IconTrash />
                </button>
              </div>
            ))}
            {lines.length === 0 && <div className="text-xs text-neutral-500">Panier vide : seules les variables saisies sont utilisées.</div>}
            {fe('items') && <div className="field-error">{fe('items')}</div>}
          </div>
        </div>
        <div>
          <div className="mb-s flex items-center justify-between">
            <span className="field-label m-0">Variables saisies</span>
            <button className="btn btn-tertiary btn-sm" onClick={() => setVars([...vars, { name: variables.find((x) => !vars.some((y) => y.name === x) && x === 'distanceKm') ?? variables.find((x) => !vars.some((y) => y.name === x)) ?? 'weightKg', value: 0 }])}>
              <IconPlus /> Variable
            </button>
          </div>
          <div className="flex flex-col gap-s">
            {vars.map((x, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_90px_32px] gap-s">
                <select className="select" value={x.name} onChange={(e) => setVars(vars.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} aria-label="Variable">
                  {variables.map((n) => (
                    <option key={n} value={n}>
                      {varLabel(n)}
                    </option>
                  ))}
                </select>
                <NumberInput value={x.value} step={0.1} onChange={(n) => setVars(vars.map((y, j) => (j === i ? { ...y, value: n } : y)))} />
                <button className="btn btn-tertiary-red btn-icon" onClick={() => setVars(vars.filter((_, j) => j !== i))} aria-label="Retirer la variable">
                  <IconTrash />
                </button>
              </div>
            ))}
            {vars.length === 0 && <div className="text-xs text-neutral-500">Remplacent les valeurs mesurées sur le panier (ex. distance).</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-m">
          <Field label="Zone (département)">
            <input className="input" value={zone} onChange={(e) => setZone(e.target.value)} maxLength={3} />
          </Field>
          <Field label="Montant commande (€)" hint="Vide = prix des articles">
            <OptNumberInput value={orderAmount} onChange={setOrderAmount} placeholder="auto" />
          </Field>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={quote.isPending} data-testid="run-quote">
          {quote.isPending ? <Spinner size={16} className="text-white" /> : <IconPlay />}
          Simuler
        </button>
        {quote.error ? <ErrorAlert error={quote.error} title="Simulation impossible" /> : null}
        {r && (
          <div className="flex flex-col gap-m border-t border-border pt-l" data-testid="quote-result">
            <div className="flex items-center gap-m">
              {r.matched ? <Badge color="green">Ligne trouvée</Badge> : <Badge color="red">Aucune ligne ne correspond</Badge>}
              {!r.matched && <span className="text-xs text-neutral-500">{card.noMatch === 'REJECT' ? 'La route serait refusée' : 'Rien n’est ajouté'}</span>}
            </div>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Sortie</th>
                  <th className="num">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(r.outputs).map(([k, val]) => (
                  <tr key={k}>
                    <td>{outputLabel(k)}</td>
                    <td className="num font-medium">{k === 'cost' || k === 'price' ? `${fmtNum(val, 2)} ${card.currency === 'EUR' ? '€' : card.currency}` : fmtNum(val, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(r.warnings ?? []).map((w) => (
              <Alert key={w} kind="warning">
                {w}
              </Alert>
            ))}
            <details>
              <summary className="cursor-pointer text-xs font-medium text-neutral-700">Variables mesurées ({Object.keys(r.vars).length})</summary>
              <dl className="m-0 mt-m grid grid-cols-2 gap-x-l gap-y-s">
                {Object.entries(r.vars).map(([k, val]) => (
                  <div key={k} className="flex justify-between gap-s border-b border-border py-xs text-xs">
                    <dt className="truncate text-neutral-500" title={k}>
                      {varLabel(k)}
                    </dt>
                    <dd className="m-0 tabular-nums text-neutral-800">{fmtNum(val, 2)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        )}
        <RowsSummary card={card} />
      </div>
    </Card>
  );
}

export function RowsSummary({ card }: { card: RateCard }) {
  if (!card.rows.length) return null;
  return (
    <details className="border-t border-border pt-m">
      <summary className="cursor-pointer text-xs font-medium text-neutral-700">Lecture de la grille</summary>
      <ol className="m-0 mt-m flex list-decimal flex-col gap-s pl-xl text-xs text-neutral-700">
        {card.rows.map((r, i) => (
          <li key={i}>
            <span className="font-medium">{r.label || `Ligne ${i + 1}`}</span>
            {' : '}
            {Object.entries(r.outputs ?? {})
              .map(([k, c]) => `${outputLabel(k)} ${summarizeComponents(cleanComponents(c))}`)
              .join(' ; ') || 'aucune sortie'}
          </li>
        ))}
      </ol>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Drawer editing one saved card (create / update / delete)

export function RateCardDrawer({
  state,
  onClose,
  onSaved,
  onDeleted,
  scopes = RATE_SCOPES,
}: {
  state: { card: RateCard; isNew: boolean } | null;
  onClose: () => void;
  onSaved?: (c: RateCard) => void;
  onDeleted?: (id: string) => void;
  scopes?: RateScope[];
}) {
  const crud = useCrud<RateCard>('rate-cards', [['rate-cards']]);
  const toast = useToast();
  const [v, setV] = useState<RateCard | null>(null);
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV(editable(state.card));
      crud.create.reset();
      crud.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (!state || !v) return null;
  const normalized = normalizeCard(v);
  return (
    <Drawer
      open
      onClose={onClose}
      title={state.isNew ? 'Nouvelle grille' : `Grille ${state.card.name || state.card.id}`}
      width={1100}
      footer={
        <>
          {!state.isNew && (
            <span className="mr-auto">
              <ConfirmButton
                small={false}
                pending={crud.remove.isPending}
                onConfirm={() =>
                  crud.remove.mutate(v.id, {
                    onSuccess: () => {
                      toast('Grille supprimée');
                      onDeleted?.(v.id);
                      onClose();
                    },
                    onError: (e) => toast(errorMessage(e), 'error'),
                  })
                }
              />
            </span>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={m.isPending}
            data-testid="save-rate-card"
            onClick={() =>
              m.mutate(normalized, {
                onSuccess: (saved) => {
                  toast('Grille enregistrée');
                  onSaved?.(saved);
                  onClose();
                },
              })
            }
          >
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l" data-testid="rate-card-editor">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        <RateCardForm value={v} onChange={setV} error={m.error} isNew={state.isNew} showCarrier={!scopes.every((s) => s === 'ORDER')} scopes={scopes} />
        <QuotePanel card={v} normalized={normalized} dirty />
      </div>
    </Drawer>
  );
}
