import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../api/client';
import { qk, useAllStockPoints, useCrud, useStockViewPreview, useStockViews } from '../api/hooks';
import type { StockView } from '../api/types';
import { STOCK_POINT_TYPES } from '../api/types';
import { IconClose, IconLayers, IconPlus } from '../components/Icons';
import { describeRule, RuleBuilder } from '../components/pricing/RuleBuilder';
import { Alert, Badge, Card, Checkbox, ChipSelect, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, errorsUnder, Field, ListInput, Loading, NumberInput, PageHeader, SearchInput, Spinner, Switch, useToast } from '../components/ui';
import { fmtInt } from '../lib/format';
import { NODE_BADGE, STOCK_POINT_TYPE_LABEL } from '../lib/labels';

const empty = (): StockView => ({ id: '', name: '', description: '', pointIds: [], pointTypes: [], departments: [], excludePointIds: [], articleRules: [], reserve: 0, active: true });

export default function StockViews() {
  const list = useStockViews();
  const crud = useCrud<StockView>('stock-views', [qk.stockViews]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ v: StockView; isNew: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && list.data?.items.length) setSelected(list.data.items[0].id);
  }, [list.data, selected]);
  return (
    <div>
      <PageHeader
        title="Vues de stock"
        subtitle="Sélection des points de stock et des articles qu'un mode de livraison peut utiliser, avec une réserve supplémentaire"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: empty(), isNew: true })}>
            <IconPlus /> Créer une vue
          </button>
        }
      />
      <div className="grid gap-l xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card bodyClassName="overflow-x-auto">
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <div className="p-xl">
              <ErrorAlert error={list.error} />
            </div>
          ) : list.data?.items.length === 0 ? (
            <EmptyState title="Aucune vue de stock" icon={<IconLayers size={40} />} />
          ) : (
            <table className="table" data-testid="stock-views">
              <thead>
                <tr>
                  <th>Vue</th>
                  <th>Points de stock</th>
                  <th>Articles</th>
                  <th className="num">Réserve</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((s) => (
                  <tr key={s.id} className={cx('clickable', selected === s.id && 'selected')} onClick={() => setSelected(s.id)} onDoubleClick={() => setEdit({ v: s, isNew: false })}>
                    <td>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-neutral-500">{s.id}</div>
                    </td>
                    <td className="max-w-[300px] text-xs">{pointsSummary(s)}</td>
                    <td className="max-w-[240px] text-xs">{(s.articleRules ?? []).length ? s.articleRules!.map(describeRule).join(' et ') : <span className="text-neutral-500">Tous les articles</span>}</td>
                    <td className="num">{s.reserve}</td>
                    <td>{s.active ? <Badge color="green">Active</Badge> : <Badge color="grey">Inactive</Badge>}</td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        className="btn btn-tertiary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEdit({ v: s, isNew: false });
                        }}
                      >
                        Modifier
                      </button>
                      <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(s.id, { onSuccess: () => toast('Vue supprimée'), onError: (e) => toast(errorMessage(e), 'error') })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <PreviewCard id={selected} view={list.data?.items.find((x) => x.id === selected)} />
      </div>
      <ViewDrawer
        state={edit}
        onClose={() => setEdit(null)}
        crud={crud}
        onSaved={(id) => {
          setSelected(id);
        }}
      />
    </div>
  );
}

function pointsSummary(s: StockView) {
  const parts: string[] = [];
  if (s.pointIds?.length) parts.push(`${s.pointIds.length} points choisis`);
  if (s.pointTypes?.length) parts.push(s.pointTypes.map((t) => STOCK_POINT_TYPE_LABEL[t] ?? t).join(', '));
  if (s.departments?.length) parts.push(`dép. ${s.departments.join(', ')}`);
  if (s.excludePointIds?.length) parts.push(`sauf ${s.excludePointIds.length} points`);
  return parts.length ? parts.join(' · ') : <span className="text-neutral-500">Tous les points</span>;
}

function PreviewCard({ id, view }: { id: string | null; view?: StockView }) {
  const p = useStockViewPreview(view?.active ? id : null);
  return (
    <Card title={view ? `Aperçu · ${view.name}` : 'Aperçu'} icon={<IconLayers size={20} />}>
      {!view ? (
        <EmptyState title="Sélectionner une vue" />
      ) : !view.active ? (
        <Alert kind="info">Vue inactive : l'aperçu n'est calculé que pour les vues actives.</Alert>
      ) : p.isLoading ? (
        <Loading />
      ) : p.error ? (
        <ErrorAlert error={p.error} />
      ) : p.data ? (
        <div className="flex flex-col gap-l" data-testid="stock-view-preview">
          <div className="grid grid-cols-3 gap-m">
            <div>
              <div className="kpi-value">{fmtInt(p.data.stockPoints)}</div>
              <div className="kpi-label">Points de stock</div>
            </div>
            <div>
              <div className="kpi-value">{fmtInt(p.data.skus)}</div>
              <div className="kpi-label">Articles</div>
            </div>
            <div>
              <div className="kpi-value">{p.data.reserve}</div>
              <div className="kpi-label">Réserve par ligne</div>
            </div>
          </div>
          <div>
            <div className="os-label mb-s">Points retenus</div>
            <div className="flex max-h-[260px] flex-wrap gap-s overflow-y-auto">
              {p.data.pointIds.map((x) => (
                <Badge key={x} color="grey">
                  {x}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** Searchable checklist of stock points bound to a list of ids. */
function PointPicker({ value, onChange, testId }: { value: string[]; onChange: (v: string[]) => void; testId?: string }) {
  const points = useAllStockPoints();
  const [q, setQ] = useState('');
  const items = points.data?.items ?? [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((p) => !s || p.id.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || p.address.city.toLowerCase().includes(s) || p.address.postalCode.startsWith(s));
  }, [items, q]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-m" data-testid={testId}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-s">
          {value.map((id) => (
            <span key={id} className="chip" aria-pressed="true">
              {id}
              <button type="button" onClick={() => toggle(id)} aria-label={`Retirer ${id}`} className="text-neutral-500 hover:text-neutral-800">
                <IconClose size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <SearchInput value={q} onChange={setQ} placeholder="Rechercher un point (nom, ville, code postal)" />
      <div className="max-h-[200px] overflow-y-auto rounded-m border border-border">
        {points.isLoading ? (
          <Loading />
        ) : (
          filtered.slice(0, 200).map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-m border-b border-border px-m py-s text-s last:border-b-0 hover:bg-neutral-20">
              <input type="checkbox" className="h-[16px] w-[16px] accent-[#24bdb0]" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{p.name}</span> <span className="text-xs text-neutral-500">{p.id}</span>
              </span>
              <Badge color={NODE_BADGE[p.type] ?? 'grey'}>{STOCK_POINT_TYPE_LABEL[p.type] ?? p.type}</Badge>
              <span className="w-[90px] truncate text-xs text-neutral-500">{p.address.city}</span>
            </label>
          ))
        )}
        {!points.isLoading && filtered.length === 0 && <div className="px-m py-l text-xs text-neutral-500">Aucun point</div>}
      </div>
    </div>
  );
}

function ViewDrawer({ state, onClose, crud, onSaved }: { state: { v: StockView; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<StockView>>; onSaved: (id: string) => void }) {
  const [v, setV] = useState<StockView>(empty());
  const [explicit, setExplicit] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV({ ...empty(), ...state.v });
      setExplicit((state.v.pointIds ?? []).length > 0);
      crud.create.reset();
      crud.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const preview = useStockViewPreview(state && !state.isNew && v.active ? state.v.id : null);
  const fe = (n: string) => errorsUnder(m.error, n)[0]?.message;
  const set = <K extends keyof StockView>(k: K, val: StockView[K]) => setV((x) => ({ ...x, [k]: val }));
  const opt = <T,>(a: T[] | undefined) => (a && a.length ? a : undefined);
  const submit = () =>
    m.mutate(
      {
        ...v,
        description: v.description || undefined,
        pointIds: explicit ? opt(v.pointIds) : undefined,
        pointTypes: opt(v.pointTypes),
        departments: opt(v.departments),
        excludePointIds: opt(v.excludePointIds),
        articleRules: opt(v.articleRules),
      },
      {
        onSuccess: (saved) => {
          toast('Vue enregistrée');
          qc.invalidateQueries({ queryKey: qk.stockViewPreview(saved.id) });
          onSaved(saved.id);
          onClose();
        },
      },
    );
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouvelle vue de stock' : `Vue ${v.id}`}
      width={720}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={submit} data-testid="save-stock-view">
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        {preview.data && (
          <Alert kind="info" title="Sélection actuelle (enregistrée)">
            {fmtInt(preview.data.stockPoints)} points de stock · {fmtInt(preview.data.skus)} articles · réserve {preview.data.reserve}
          </Alert>
        )}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe('id')}>
            <input className={cx('input', fe('id') && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => set('id', e.target.value)} placeholder="STORES-IDF" />
          </Field>
          <Field label="Nom" error={fe('name')}>
            <input className={cx('input', fe('name') && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="os-title-s mb-m">Points de stock</div>
          <div className="flex flex-col gap-l">
            <Checkbox checked={explicit} onChange={setExplicit} label="Limiter à une liste explicite de points" />
            {explicit && <PointPicker value={v.pointIds ?? []} onChange={(x) => set('pointIds', x)} testId="point-picker" />}
            {fe('pointIds') && <div className="field-error">{fe('pointIds')}</div>}
            <Field label="Types de points" hint="Aucun = tous les types" error={fe('pointTypes')}>
              <ChipSelect options={STOCK_POINT_TYPES} value={v.pointTypes ?? []} onChange={(x) => set('pointTypes', x)} renderLabel={(t) => STOCK_POINT_TYPE_LABEL[t] ?? t} />
            </Field>
            <Field label="Départements des points" hint="Préfixes de code postal, séparés par des virgules ; vide = tous">
              <ListInput value={v.departments} onChange={(x) => set('departments', x)} placeholder="75, 92, 93" />
            </Field>
            <Field label="Points exclus" error={fe('excludePointIds')}>
              <PointPicker value={v.excludePointIds ?? []} onChange={(x) => set('excludePointIds', x)} />
            </Field>
          </div>
        </div>
        <div>
          <div className="os-title-s mb-s">Articles</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Les articles doivent respecter toutes les règles. Sans règle, tout le catalogue est disponible.</p>
          <RuleBuilder rules={v.articleRules} onChange={(r) => set('articleRules', r)} error={fe('articleRules')} emptyText="Tous les articles" />
        </div>
        <Field label="Réserve (unités gardées sur chaque ligne, en plus du stock de sécurité)" error={fe('reserve')}>
          <NumberInput value={v.reserve} min={0} onChange={(n) => set('reserve', n)} invalid={!!fe('reserve')} />
        </Field>
        <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Active' : 'Inactive'} />
      </div>
    </Drawer>
  );
}
