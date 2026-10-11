import { usePricingFields } from '../../api/hooks';
import type { Criterion, Selection } from '../../api/types';
import { metricLabel, SELECTION_LABEL } from '../../lib/labels';
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from '../Icons';
import { cx, OptNumberInput, Segmented } from '../ui';

const FALLBACK_METRICS = ['deliveryHours', 'cost', 'price', 'carbonKg', 'packages', 'legs', 'sources'];

/** Unique metric list from /pricing/fields (the API may repeat entries). */
export function useCriteriaMetrics(): string[] {
  const f = usePricingFields();
  return Array.from(new Set(f.data?.criteriaMetrics ?? FALLBACK_METRICS));
}

/**
 * Criteria of a delivery mode (or a simulation override): metric, direction,
 * weight (WEIGHTED), priority order and tolerance (LEXICOGRAPHIC), hard max.
 */
export function CriteriaEditor({
  criteria,
  selection,
  onChange,
  errors = {},
  prefix = 'criteria',
}: {
  criteria: Criterion[];
  selection: Selection;
  onChange: (c: Criterion[], s: Selection) => void;
  errors?: Record<string, string>;
  prefix?: string;
}) {
  const metrics = useCriteriaMetrics();
  const sorted = [...criteria].sort((a, b) => (a.priority || 99) - (b.priority || 99));
  const emit = (list: Criterion[], s: Selection = selection) => onChange(list.map((c, i) => ({ ...c, priority: i + 1 })), s);
  const set = (i: number, c: Criterion) => emit(sorted.map((x, j) => (j === i ? c : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= sorted.length) return;
    const next = [...sorted];
    [next[i], next[j]] = [next[j], next[i]];
    emit(next);
  };
  const lexico = selection === 'LEXICOGRAPHIC';
  return (
    <div className="flex flex-col gap-m" data-testid="criteria-editor">
      <div className="flex flex-wrap items-center gap-m">
        <Segmented<Selection>
          value={selection}
          onChange={(s) => emit(sorted, s)}
          options={[
            { value: 'WEIGHTED', label: SELECTION_LABEL.WEIGHTED },
            { value: 'LEXICOGRAPHIC', label: SELECTION_LABEL.LEXICOGRAPHIC },
          ]}
        />
        <span className="text-xs text-neutral-500">
          {lexico ? 'Compare les options critère par critère, dans l’ordre de priorité ; la tolérance rend deux valeurs proches équivalentes.' : 'Score normalisé : chaque critère compte selon son poids.'}
        </span>
      </div>
      {errors.selection && <div className="field-error">{errors.selection}</div>}
      {sorted.length === 0 && <div className="text-xs text-neutral-500">Aucun critère : la pondération globale du moteur s’applique.</div>}
      {sorted.map((c, i) => {
        const p = `${prefix}[${criteria.indexOf(c)}]`;
        const err = errors[p] ?? errors[`${p}.metric`] ?? errors[`${p}.direction`];
        return (
          <div key={i} className={cx('rounded-m border bg-white p-m', err ? 'border-error' : 'border-border')} data-testid="criterion-row">
            <div className="grid items-end gap-m sm:grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto]">
              <div className="flex h-control items-center justify-center text-s font-medium text-neutral-500" title="Priorité">
                {i + 1}
              </div>
              <label className="flex min-w-0 flex-col gap-xs">
                <span className="text-xs text-neutral-700">Critère</span>
                <select className="select" value={c.metric} onChange={(e) => set(i, { ...c, metric: e.target.value })}>
                  {[c.metric, ...metrics.filter((m) => m !== c.metric)].filter(Boolean).map((m) => (
                    <option key={m} value={m}>
                      {metricLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="text-xs text-neutral-700">Sens</span>
                <select className="select" value={c.direction || 'MIN'} onChange={(e) => set(i, { ...c, direction: e.target.value as 'MIN' | 'MAX' })}>
                  <option value="MIN">Minimiser</option>
                  <option value="MAX">Maximiser</option>
                </select>
              </label>
              <label className="flex flex-col gap-xs">
                <span className="text-xs text-neutral-700">Poids {lexico && <span className="text-neutral-500">(non utilisé par priorité)</span>}</span>
                <div className="flex h-control items-center gap-m">
                  <input type="range" min={0} max={1} step={0.05} value={c.weight} onChange={(e) => set(i, { ...c, weight: Number(e.target.value) })} className="min-w-0 flex-1 accent-[#24bdb0]" aria-label="Poids" disabled={lexico} />
                  <span className="w-[36px] text-right text-xs tabular-nums">{c.weight.toFixed(2)}</span>
                </div>
              </label>
              <div className="flex items-center">
                <button type="button" className="btn btn-tertiary btn-sm btn-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter" title="Monter">
                  <IconChevronUp />
                </button>
                <button type="button" className="btn btn-tertiary btn-sm btn-icon" onClick={() => move(i, 1)} disabled={i === sorted.length - 1} aria-label="Descendre" title="Descendre">
                  <IconChevronDown />
                </button>
                <button type="button" className="btn btn-tertiary-red btn-sm btn-icon" onClick={() => emit(sorted.filter((_, j) => j !== i))} aria-label="Retirer le critère" title="Retirer le critère">
                  <IconTrash />
                </button>
              </div>
            </div>
            <div className="mt-m grid gap-m pl-[36px] sm:grid-cols-2">
              <label className="flex flex-col gap-xs">
                <span className="text-xs text-neutral-700">Limite max (option rejetée au-delà)</span>
                <OptNumberInput value={c.max} onChange={(max) => set(i, { ...c, max })} placeholder="Aucune" />
              </label>
              <label className="flex flex-col gap-xs">
                <span className="text-xs text-neutral-700">Tolérance (même unité que le critère)</span>
                <OptNumberInput value={c.tolerance} onChange={(tolerance) => set(i, { ...c, tolerance })} placeholder="0" />
              </label>
            </div>
            {err && <div className="field-error pl-[36px]">{err}</div>}
          </div>
        );
      })}
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => emit([...sorted, { metric: metrics.find((m) => !criteria.some((c) => c.metric === m)) ?? 'deliveryHours', weight: 0.5, priority: sorted.length + 1 }])}>
          <IconPlus /> Ajouter un critère
        </button>
      </div>
    </div>
  );
}

/** Drops empty optional fields before sending. */
export function cleanCriteria(list: Criterion[]): Criterion[] {
  return list.map((c) => {
    const out: Criterion = { metric: c.metric, weight: c.weight, priority: c.priority };
    if (c.direction && c.direction !== 'MIN') out.direction = c.direction;
    if (c.max !== undefined) out.max = c.max;
    if (c.tolerance) out.tolerance = c.tolerance;
    return out;
  });
}
