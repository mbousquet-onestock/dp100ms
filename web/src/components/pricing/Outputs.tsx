import { useState } from 'react';
import { usePricingFields } from '../../api/hooks';
import type { Components, Outputs, Range } from '../../api/types';
import { COMPONENT_FIELDS, outputLabel, varLabel } from '../../lib/labels';
import { IconChevronDown, IconClose, IconPlus, IconTrash } from '../Icons';
import { cx, OptNumberInput, PopoverButton } from '../ui';

export const STANDARD_OUTPUTS = ['cost', 'price', 'carbonKg'];

/** Removes undefined / zero rates so that the JSON stays compact (min / max kept when set). */
export function cleanComponents(c: Components): Components {
  const out: Components = {};
  for (const f of COMPONENT_FIELDS) {
    const v = c[f.key];
    if (v === undefined || Number.isNaN(v)) continue;
    if ((f.key === 'min' || f.key === 'max') || v !== 0) out[f.key] = v;
  }
  if (c.perUnit) {
    const pu = Object.fromEntries(Object.entries(c.perUnit).filter(([k, v]) => k && v));
    if (Object.keys(pu).length) out.perUnit = pu;
  }
  return out;
}

/** Short text summary of components: "€4.60 + 0.25/kg·km". */
export function summarizeComponents(c: Components | undefined, unit = ''): string {
  if (!c) return '–';
  const parts: string[] = [];
  const n = (v: number) => (Math.round(v * 10000) / 10000).toString();
  if (c.fixed) parts.push(`${n(c.fixed)}${unit}`);
  if (c.perKg) parts.push(`${n(c.perKg)}/kg`);
  if (c.perItem) parts.push(`${n(c.perItem)}/article`);
  if (c.perParcel) parts.push(`${n(c.perParcel)}/colis`);
  if (c.perKm) parts.push(`${n(c.perKm)}/km`);
  if (c.perKgKm) parts.push(`${n(c.perKgKm)}/kg·km`);
  if (c.percentOfValue) parts.push(`${n(c.percentOfValue)} %`);
  for (const [k, v] of Object.entries(c.perUnit ?? {})) parts.push(`${n(v)}×${k}`);
  let s = parts.join(' + ') || '0';
  if (c.min !== undefined) s += ` (min ${n(c.min)})`;
  if (c.max !== undefined) s += ` (max ${n(c.max)})`;
  return s;
}

const extraCount = (c: Components) => COMPONENT_FIELDS.filter((f) => f.key !== 'fixed' && c[f.key] !== undefined && c[f.key] !== 0).length + Object.keys(c.perUnit ?? {}).length;

/** Detailed components form (used inside the popover). */
export function ComponentsForm({ value, onChange, variables }: { value: Components; onChange: (c: Components) => void; variables: string[] }) {
  const pu = Object.entries(value.perUnit ?? {});
  const setPU = (entries: [string, number][]) => onChange({ ...value, perUnit: Object.fromEntries(entries) });
  return (
    <div className="flex flex-col gap-m">
      <div className="grid grid-cols-2 gap-m">
        {COMPONENT_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-xs" title={f.hint}>
            <span className="text-xs text-neutral-700">{f.label}</span>
            <OptNumberInput value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} placeholder={f.key === 'min' || f.key === 'max' ? 'aucun' : '0'} ariaLabel={f.label} />
          </label>
        ))}
      </div>
      <div className="border-t border-border pt-m">
        <div className="mb-s text-xs font-medium text-neutral-700">Taux sur une variable</div>
        {pu.map(([k, v], i) => (
          <div key={i} className="mb-s grid grid-cols-[minmax(0,1fr)_90px_32px] gap-s">
            <select className="select" value={k} onChange={(e) => setPU(pu.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} aria-label="Variable">
              {[k, ...variables.filter((x) => x !== k)].map((x) => (
                <option key={x} value={x}>
                  {varLabel(x)}
                </option>
              ))}
            </select>
            <OptNumberInput value={v} onChange={(n) => setPU(pu.map((x, j) => (j === i ? [x[0], n ?? 0] : x)))} ariaLabel="Taux" />
            <button type="button" className="btn btn-tertiary-red btn-sm btn-icon" onClick={() => setPU(pu.filter((_, j) => j !== i))} aria-label="Retirer">
              <IconClose />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setPU([...pu, [variables.find((x) => !(value.perUnit ?? {})[x]) ?? 'girthCm', 0]])}>
          <IconPlus /> Ajouter un taux
        </button>
      </div>
    </div>
  );
}

/**
 * Grid cell editing one output: absent (button "Définir") or defined
 * (fixed inline, the other components in a popover).
 */
export function ComponentsCell({ value, onChange, variables, outputKey }: { value: Components | undefined; onChange: (c: Components | undefined) => void; variables: string[]; outputKey: string }) {
  if (!value)
    return (
      <button type="button" className="btn btn-tertiary btn-sm w-full justify-start text-neutral-500" onClick={() => onChange({})} title={`Définir ${outputLabel(outputKey)}`}>
        <IconPlus size={16} /> Définir
      </button>
    );
  const extra = extraCount(value);
  return (
    <div className="flex items-center gap-xs">
      <OptNumberInput value={value.fixed} onChange={(v) => onChange({ ...value, fixed: v })} placeholder="0" className="h-[30px] min-w-[64px] px-m text-xs" ariaLabel={`${outputLabel(outputKey)} fixe`} />
      <PopoverButton
        className={cx('btn btn-sm h-[30px] px-s', extra ? 'btn-secondary' : 'btn-tertiary')}
        title="Autres composantes"
        width={320}
        label={
          <>
            {extra > 0 && <span className="text-2xs">+{extra}</span>}
            <IconChevronDown size={14} />
          </>
        }
      >
        <div className="mb-m flex items-center justify-between">
          <span className="os-title-s">{outputLabel(outputKey)}</span>
          <span className="text-2xs text-neutral-500">fixe + Σ taux × variable, puis min / max</span>
        </div>
        <ComponentsForm value={value} onChange={onChange} variables={variables} />
      </PopoverButton>
      <button type="button" className="btn btn-tertiary btn-sm btn-icon h-[30px] w-[24px] text-neutral-500" onClick={() => onChange(undefined)} title="Retirer cette sortie" aria-label="Retirer cette sortie">
        <IconClose size={14} />
      </button>
    </div>
  );
}

/** Min / max inputs of a condition cell ([min, max), empty = open). */
export function RangeCell({ value, onChange, invalid }: { value: Range | undefined; onChange: (r: Range | undefined) => void; invalid?: boolean }) {
  const v = value ?? {};
  const set = (r: Range) => onChange(r.min === undefined && r.max === undefined ? undefined : r);
  return (
    <div className="grid grid-cols-2 gap-xs">
      <OptNumberInput value={v.min} onChange={(min) => set({ ...v, min })} placeholder="min" className="h-[30px] px-m text-xs" invalid={invalid} ariaLabel="Minimum" />
      <OptNumberInput value={v.max} onChange={(max) => set({ ...v, max })} placeholder="max" className="h-[30px] px-m text-xs" invalid={invalid} ariaLabel="Maximum (exclu)" />
    </div>
  );
}

/** List editor of outputs (surcharges, additional services): output key + components. */
export function OutputsEditor({ value, onChange, variables, error }: { value: Outputs | undefined; onChange: (o: Outputs) => void; variables?: string[]; error?: string }) {
  const fields = usePricingFields();
  const vars = variables ?? fields.data?.rateVariables ?? [];
  const entries = Object.entries(value ?? {});
  const [custom, setCustom] = useState('');
  const known = Array.from(new Set([...STANDARD_OUTPUTS, ...(fields.data?.outputs ?? []).filter((o) => o !== 'deliveryHours' && o !== 'packages')]));
  const free = known.filter((k) => !(k in (value ?? {})));
  const setKey = (k: string, c: Components | undefined) => {
    const next = { ...(value ?? {}) };
    if (c) next[k] = c;
    else delete next[k];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-s">
      {entries.length === 0 && <div className="text-xs text-neutral-500">Aucune sortie définie</div>}
      {entries.map(([k, c]) => (
        <div key={k} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_36px] items-center gap-m rounded-m border border-border bg-white px-m py-s">
          <span className="truncate text-s font-medium" title={k}>
            {outputLabel(k)}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-m">
            <div className="w-[180px] max-w-full flex-none">
              <ComponentsCell value={c} onChange={(x) => setKey(k, x ?? {})} variables={vars} outputKey={k} />
            </div>
            <span className="truncate text-xs text-neutral-500">{summarizeComponents(c)}</span>
          </div>
          <button type="button" className="btn btn-tertiary-red btn-sm btn-icon" onClick={() => setKey(k, undefined)} aria-label="Retirer la sortie" title="Retirer la sortie">
            <IconTrash />
          </button>
        </div>
      ))}
      {error && <div className="field-error">{error}</div>}
      <div className="flex flex-wrap items-center gap-s">
        {free.map((k) => (
          <button key={k} type="button" className="btn btn-tertiary btn-sm" onClick={() => setKey(k, {})}>
            <IconPlus /> {outputLabel(k)}
          </button>
        ))}
        <input className="input h-[30px] w-[160px] text-xs" value={custom} placeholder="Sortie personnalisée" onChange={(e) => setCustom(e.target.value.replace(/\s/g, ''))} aria-label="Sortie personnalisée" />
        <button
          type="button"
          className="btn btn-tertiary btn-sm"
          disabled={!custom || custom in (value ?? {})}
          onClick={() => {
            setKey(custom, {});
            setCustom('');
          }}
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

export function cleanOutputs(o: Outputs | undefined): Outputs {
  return Object.fromEntries(Object.entries(o ?? {}).map(([k, c]) => [k, cleanComponents(c)]));
}
