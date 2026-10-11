import { useEffect, useState } from 'react';
import { usePricingFields, useSkuPage, useSkuUpdate } from '../api/hooks';
import type { AttributeValue, SKU } from '../api/types';
import { IconBox, IconPlus, IconTrash } from '../components/Icons';
import { Badge, Card, cx, Drawer, EmptyState, ErrorAlert, errorsUnder, Field, Loading, NumberInput, PageHeader, Pagination, SearchInput, Spinner, useDebounced, useToast } from '../components/ui';
import { fmtMoney, fmtNum } from '../lib/format';

type AttrType = 'boolean' | 'number' | 'string';
interface AttrRow {
  key: string;
  type: AttrType;
  value: string;
}

const typeOf = (v: AttributeValue): AttrType => (typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string');
const toRows = (a?: Record<string, AttributeValue>): AttrRow[] => Object.entries(a ?? {}).map(([key, v]) => ({ key, type: typeOf(v), value: String(v) }));
function fromRows(rows: AttrRow[]): Record<string, AttributeValue> | undefined {
  const out: Record<string, AttributeValue> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    out[k] = r.type === 'boolean' ? r.value === 'true' : r.type === 'number' ? Number(r.value || 0) : r.value;
  }
  return Object.keys(out).length ? out : undefined;
}

export default function Skus() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq]);
  const skus = useSkuPage({ q: dq || undefined, page, pageSize });
  const [edit, setEdit] = useState<SKU | null>(null);
  return (
    <div>
      <PageHeader title="Articles" subtitle="Catalogue : dimensions, prix et attributs utilisés par les règles articles et les grilles tarifaires" />
      <Card bodyClassName="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-m border-b border-border px-xl py-l">
          <SearchInput value={q} onChange={setQ} placeholder="Rechercher un SKU ou un libellé" className="w-[320px]" />
          {skus.data && <Pagination page={page} pageSize={pageSize} total={skus.data.total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />}
        </div>
        {skus.isLoading ? (
          <Loading />
        ) : skus.error ? (
          <div className="p-xl">
            <ErrorAlert error={skus.error} />
          </div>
        ) : skus.data?.items.length === 0 ? (
          <EmptyState title="Aucun article" icon={<IconBox size={40} />} />
        ) : (
          <table className="table" data-testid="sku-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Libellé</th>
                <th>Catégorie</th>
                <th className="num">Poids (kg)</th>
                <th className="num">Volume (L)</th>
                <th className="num">Dimensions (cm)</th>
                <th className="num">Prix</th>
                <th>Attributs</th>
              </tr>
            </thead>
            <tbody>
              {skus.data?.items.map((s) => (
                <tr key={s.sku} className="clickable" onClick={() => setEdit(s)}>
                  <td className="font-medium">{s.sku}</td>
                  <td>{s.name}</td>
                  <td className="text-xs">{s.category}</td>
                  <td className="num">{fmtNum(s.weightKg, 2)}</td>
                  <td className="num">{fmtNum(s.volumeL, 1)}</td>
                  <td className="num whitespace-nowrap text-xs">
                    {fmtNum(s.lengthCm, 1)} × {fmtNum(s.widthCm, 1)} × {fmtNum(s.heightCm, 1)}
                  </td>
                  <td className="num">{fmtMoney(s.priceEur)}</td>
                  <td>
                    <div className="flex flex-wrap gap-s">
                      {Object.entries(s.attributes ?? {}).map(([k, v]) => (
                        <Badge key={k} color={v === true ? 'blue' : 'grey'}>
                          {v === true ? k : `${k} : ${String(v)}`}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <SkuDrawer sku={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function SkuDrawer({ sku, onClose }: { sku: SKU | null; onClose: () => void }) {
  const [v, setV] = useState<SKU | null>(null);
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const update = useSkuUpdate();
  const fields = usePricingFields();
  const toast = useToast();
  useEffect(() => {
    if (sku) {
      setV(sku);
      setAttrs(toRows(sku.attributes));
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku]);
  if (!v) return null;
  const fe = (n: string) => errorsUnder(update.error, n)[0]?.message;
  const set = <K extends keyof SKU>(k: K, val: SKU[K]) => setV((x) => (x ? { ...x, [k]: val } : x));
  const known = (fields.data?.articleAttributes ?? []).map((a) => a.slice(11)).filter((a) => !attrs.some((r) => r.key === a));
  return (
    <Drawer
      open={!!sku}
      onClose={onClose}
      title={`Article ${v.sku}`}
      width={600}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={update.isPending} onClick={() => update.mutate({ ...v, attributes: fromRows(attrs) }, { onSuccess: () => { toast('Article enregistré'); onClose(); } })} data-testid="save-sku">
            {update.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {update.error ? <ErrorAlert error={update.error} title="Enregistrement impossible" /> : null}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Libellé" error={fe('name')}>
            <input className={cx('input', fe('name') && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Catégorie">
            <input className="input" value={v.category} onChange={(e) => set('category', e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="os-title-s mb-m">Dimensions et prix</div>
          {fe('dimensions') && <div className="field-error mb-m">{fe('dimensions')}</div>}
          <div className="grid gap-l sm:grid-cols-3">
            <Field label="Poids (kg)">
              <NumberInput value={v.weightKg} step={0.01} min={0} onChange={(n) => set('weightKg', n)} />
            </Field>
            <Field label="Volume (L)">
              <NumberInput value={v.volumeL} step={0.1} min={0} onChange={(n) => set('volumeL', n)} />
            </Field>
            <Field label="Prix (€)">
              <NumberInput value={v.priceEur} step={0.01} min={0} onChange={(n) => set('priceEur', n)} />
            </Field>
            <Field label="Longueur (cm)">
              <NumberInput value={v.lengthCm} step={0.1} min={0} onChange={(n) => set('lengthCm', n)} />
            </Field>
            <Field label="Largeur (cm)">
              <NumberInput value={v.widthCm} step={0.1} min={0} onChange={(n) => set('widthCm', n)} />
            </Field>
            <Field label="Hauteur (cm)">
              <NumberInput value={v.heightCm} step={0.1} min={0} onChange={(n) => set('heightCm', n)} />
            </Field>
          </div>
        </div>
        <div>
          <div className="os-title-s mb-s">Attributs</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Utilisables dans les règles sous la forme attributes.clé (ex. attributes.fragile).</p>
          <div className="flex flex-col gap-s">
            {attrs.length === 0 && <div className="text-xs text-neutral-500">Aucun attribut</div>}
            {attrs.map((a, i) => {
              const setA = (x: Partial<AttrRow>) => setAttrs(attrs.map((y, j) => (j === i ? { ...y, ...x } : y)));
              return (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_36px] gap-s" data-testid="attr-row">
                  <input className="input" value={a.key} onChange={(e) => setA({ key: e.target.value.replace(/\s/g, '') })} placeholder="fragile" aria-label="Clé" />
                  <select className="select" value={a.type} onChange={(e) => setA({ type: e.target.value as AttrType, value: e.target.value === 'boolean' ? 'true' : e.target.value === 'number' ? '0' : '' })} aria-label="Type">
                    <option value="boolean">Booléen</option>
                    <option value="number">Nombre</option>
                    <option value="string">Texte</option>
                  </select>
                  {a.type === 'boolean' ? (
                    <select className="select" value={a.value} onChange={(e) => setA({ value: e.target.value })} aria-label="Valeur">
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  ) : (
                    <input className="input" type={a.type === 'number' ? 'number' : 'text'} value={a.value} onChange={(e) => setA({ value: e.target.value })} aria-label="Valeur" />
                  )}
                  <button className="btn btn-tertiary-red btn-icon" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))} aria-label="Retirer l'attribut" title="Retirer l'attribut">
                    <IconTrash />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-m flex flex-wrap items-center gap-s">
            <button className="btn btn-tertiary btn-sm" onClick={() => setAttrs([...attrs, { key: '', type: 'boolean', value: 'true' }])}>
              <IconPlus /> Ajouter un attribut
            </button>
            {known.map((k) => (
              <button key={k} className="chip" onClick={() => setAttrs([...attrs, { key: k, type: 'boolean', value: 'true' }])}>
                <IconPlus size={14} /> {k}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
