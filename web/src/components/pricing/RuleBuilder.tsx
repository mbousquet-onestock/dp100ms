import { useEffect, useRef, useState } from 'react';
import { usePricingFields } from '../../api/hooks';
import type { Restriction, RestrictionMode, Rule, RuleOp, RuleValue } from '../../api/types';
import { fieldLabel, RESTRICTION_MODE_LABEL, RULE_OP_LABEL } from '../../lib/labels';
import { IconPlus, IconTrash } from '../Icons';
import { cx, Field } from '../ui';

const NUMERIC_FIELDS = new Set(['weightKg', 'volumeL', 'lengthCm', 'widthCm', 'heightCm', 'longestSideCm', 'girthCm', 'sumDimensionsCm', 'priceEur']);
const FALLBACK_OPS: RuleOp[] = ['eq', 'neq', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between', 'exists', 'missing', 'contains'];
const CUSTOM = '__custom__';
const FALLBACK_FIELDS = ['sku', 'name', 'category', ...NUMERIC_FIELDS];

/** Parses a typed text into the JSON value expected by the API. */
export function parseRuleValue(field: string, text: string): RuleValue {
  const t = text.trim();
  if (NUMERIC_FIELDS.has(field)) return t === '' ? 0 : Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (field.startsWith('attributes.') && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return text;
}

const show = (v: RuleValue | undefined) => (v === undefined || v === null ? '' : String(v));

export function describeRule(r: Rule): string {
  const op = RULE_OP_LABEL[r.op] ?? r.op;
  if (r.op === 'exists' || r.op === 'missing') return `${fieldLabel(r.field)} ${op}`;
  if (r.op === 'between') return `${fieldLabel(r.field)} ${op} ${show(r.values?.[0])} et ${show(r.values?.[1])}`;
  if (r.op === 'in' || r.op === 'nin') return `${fieldLabel(r.field)} ${op} ${(r.values ?? []).map(show).join(', ')}`;
  return `${fieldLabel(r.field)} ${op} ${show(r.value)}`;
}

/** Comma separated values input keeping the raw text while typing. */
function ValuesInput({ field, values, onChange }: { field: string; values: RuleValue[] | undefined; onChange: (v: RuleValue[]) => void }) {
  const joined = (values ?? []).map(show).join(', ');
  const [text, setText] = useState(joined);
  const last = useRef(joined);
  useEffect(() => {
    if (joined !== last.current) {
      last.current = joined;
      setText(joined);
    }
  }, [joined]);
  return (
    <input
      className="input"
      value={text}
      placeholder="valeur 1, valeur 2"
      aria-label="Valeurs"
      onChange={(e) => {
        setText(e.target.value);
        const arr = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => parseRuleValue(field, s));
        last.current = arr.map(show).join(', ');
        onChange(arr);
      }}
    />
  );
}

function normalize(r: Rule, op: RuleOp): Rule {
  const out: Rule = { field: r.field, op };
  if (op === 'exists' || op === 'missing') return out;
  if (op === 'in' || op === 'nin') out.values = r.values?.length ? r.values : r.value !== undefined ? [r.value] : [];
  else if (op === 'between') out.values = [r.values?.[0] ?? 0, r.values?.[1] ?? 0];
  else out.value = r.value ?? r.values?.[0] ?? '';
  return out;
}

/** One rule: field select (built-in fields, known attributes or a free "attributes.xxx"), operator, value(s). */
export function RuleRow({ rule, onChange, onRemove, invalid }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; invalid?: boolean }) {
  const fields = usePricingFields();
  const articleFields = fields.data?.articleFields ?? FALLBACK_FIELDS;
  const attrs = fields.data?.articleAttributes ?? [];
  const ops = fields.data?.ruleOperators ?? FALLBACK_OPS;
  const known = articleFields.includes(rule.field) || attrs.includes(rule.field);
  const [custom, setCustom] = useState(!known && rule.field !== '');
  const selectValue = custom ? CUSTOM : rule.field;
  const numeric = NUMERIC_FIELDS.has(rule.field);
  return (
    <div className={cx('grid gap-m rounded-m border bg-white p-m sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_36px]', invalid ? 'border-error' : 'border-border')} data-testid="rule-row">
      <div className="flex min-w-0 flex-col gap-s">
        <select
          className="select"
          value={selectValue}
          aria-label="Champ"
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustom(true);
              onChange({ ...rule, field: 'attributes.' });
            } else {
              setCustom(false);
              onChange({ ...rule, field: e.target.value });
            }
          }}
        >
          <option value="">Choisir un champ</option>
          <optgroup label="Article">
            {articleFields.map((f) => (
              <option key={f} value={f}>
                {fieldLabel(f)}
              </option>
            ))}
          </optgroup>
          {attrs.length > 0 && (
            <optgroup label="Attributs connus">
              {attrs.map((f) => (
                <option key={f} value={f}>
                  {f.slice(11)}
                </option>
              ))}
            </optgroup>
          )}
          <option value={CUSTOM}>Autre attribut</option>
        </select>
        {custom && <input className="input" value={rule.field} onChange={(e) => onChange({ ...rule, field: e.target.value })} placeholder="attributes.fragile" aria-label="Attribut" />}
      </div>
      <select className="select" value={rule.op} onChange={(e) => onChange(normalize(rule, e.target.value as RuleOp))} aria-label="Opérateur">
        {ops.map((o) => (
          <option key={o} value={o}>
            {RULE_OP_LABEL[o] ?? o}
          </option>
        ))}
      </select>
      <div className="min-w-0">
        {rule.op === 'exists' || rule.op === 'missing' ? (
          <div className="flex h-control items-center text-xs text-neutral-500">Aucune valeur</div>
        ) : rule.op === 'in' || rule.op === 'nin' ? (
          <ValuesInput field={rule.field} values={rule.values} onChange={(values) => onChange({ ...rule, values })} />
        ) : rule.op === 'between' ? (
          <div className="grid grid-cols-2 gap-s">
            {[0, 1].map((i) => (
              <input
                key={i}
                className="input"
                type={numeric ? 'number' : 'text'}
                value={show(rule.values?.[i])}
                placeholder={i === 0 ? 'de' : 'à'}
                aria-label={i === 0 ? 'Borne basse' : 'Borne haute'}
                onChange={(e) => {
                  const values = [...(rule.values ?? [0, 0])];
                  values[i] = parseRuleValue(numeric ? rule.field : 'attributes.x', e.target.value);
                  onChange({ ...rule, values });
                }}
              />
            ))}
          </div>
        ) : (
          <input
            className="input"
            type={numeric ? 'number' : 'text'}
            value={show(rule.value)}
            placeholder={numeric ? '0' : 'true, 12, texte'}
            aria-label="Valeur"
            onChange={(e) => onChange({ ...rule, value: parseRuleValue(rule.field, e.target.value) })}
          />
        )}
      </div>
      <button type="button" className="btn btn-tertiary-red btn-icon" onClick={onRemove} aria-label="Retirer la règle" title="Retirer la règle">
        <IconTrash />
      </button>
    </div>
  );
}

/** Editable list of article rules. */
export function RuleBuilder({ rules, onChange, emptyText = 'Aucune règle', addLabel = 'Ajouter une règle', error }: { rules: Rule[] | undefined; onChange: (r: Rule[]) => void; emptyText?: string; addLabel?: string; error?: string }) {
  const list = rules ?? [];
  return (
    <div className="flex flex-col gap-m">
      {list.length === 0 && <div className="text-xs text-neutral-500">{emptyText}</div>}
      {list.map((r, i) => (
        <RuleRow key={i} rule={r} invalid={!!error} onChange={(x) => onChange(list.map((y, j) => (j === i ? x : y)))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
      ))}
      {error && <div className="field-error">{error}</div>}
      <div>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => onChange([...list, { field: 'weightKg', op: 'gt', value: 0 }])}>
          <IconPlus /> {addLabel}
        </button>
      </div>
    </div>
  );
}

/** Named article restrictions of a carrier service or a leg. */
export function RestrictionsEditor({ value, onChange, errors = {}, prefix = 'restrictions' }: { value: Restriction[] | undefined; onChange: (v: Restriction[]) => void; errors?: Record<string, string>; prefix?: string }) {
  const list = value ?? [];
  const fields = usePricingFields();
  const modes = fields.data?.restrictionModes ?? (['EXCLUDE_IF_ANY', 'REQUIRE_ALL'] as RestrictionMode[]);
  const set = (i: number, r: Restriction) => onChange(list.map((x, j) => (j === i ? r : x)));
  return (
    <div className="flex flex-col gap-l" data-testid="restrictions-editor">
      {list.length === 0 && <div className="text-xs text-neutral-500">Aucune restriction : tous les articles sont acceptés dans les limites de poids et de volume.</div>}
      {list.map((r, i) => {
        const p = `${prefix}[${i}]`;
        const err = errors[p] ?? errors[`${p}.rules`] ?? errors[`${p}.mode`];
        return (
          <div key={i} className="rounded-m border border-border bg-neutral-20 p-l">
            <div className="mb-m grid gap-m sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_36px]">
              <Field label="Nom">
                <input className="input" value={r.name} onChange={(e) => set(i, { ...r, name: e.target.value })} placeholder="Matières dangereuses interdites" />
              </Field>
              <Field label="Mode">
                <select className="select" value={r.mode} onChange={(e) => set(i, { ...r, mode: e.target.value as RestrictionMode })}>
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {RESTRICTION_MODE_LABEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end">
                <button type="button" className="btn btn-tertiary-red btn-icon" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Supprimer la restriction" title="Supprimer la restriction">
                  <IconTrash />
                </button>
              </div>
            </div>
            <RuleBuilder rules={r.rules} onChange={(rules) => set(i, { ...r, rules })} error={err} emptyText="Ajouter au moins une règle" />
          </div>
        );
      })}
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...list, { name: '', mode: 'EXCLUDE_IF_ANY', rules: [{ field: 'attributes.hazmat', op: 'exists' }] }])}>
          <IconPlus /> Ajouter une restriction
        </button>
      </div>
    </div>
  );
}
