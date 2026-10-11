import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { qk, useCrud, useModes, useRateCards, useStockViews } from '../api/hooks';
import { cleanCriteria, CriteriaEditor } from '../components/pricing/CriteriaEditor';
import type { DeliveryMode, Selection } from '../api/types';
import { IconPlus } from '../components/Icons';
import { Badge, Card, ChipSelect, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, Loading, NumberInput, PageHeader, Spinner, Switch, useToast } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { metricLabel, modeBadge, SELECTION_LABEL } from '../lib/labels';

const empty = (): DeliveryMode => ({ id: '', name: '', description: '', maxLegs: 3, maxSources: 2, allowConsolidation: true, allowSplit: true, maxDeliveryDays: 5, price: 4.9, criteria: [{ metric: 'deliveryHours', weight: 0.6, priority: 1 }, { metric: 'cost', weight: 0.4, priority: 2 }], selection: 'WEIGHTED', stockViewId: '', priceRateCardIds: [], active: true });

export default function DeliveryModes() {
  const modes = useModes();
  const crud = useCrud<DeliveryMode>('delivery-modes', [qk.modes]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ v: DeliveryMode; isNew: boolean } | null>(null);
  return (
    <div>
      <PageHeader
        title="Modes de livraison"
        subtitle="Promesses commerciales proposées aux clients et leurs contraintes de routage"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: empty(), isNew: true })}>
            <IconPlus /> Créer un mode
          </button>
        }
      />
      <Card bodyClassName="overflow-x-auto">
        {modes.isLoading ? (
          <Loading />
        ) : modes.error ? (
          <div className="p-xl">
            <ErrorAlert error={modes.error} />
          </div>
        ) : modes.data?.items.length === 0 ? (
          <EmptyState title="Aucun mode de livraison" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Description</th>
                <th className="num">Legs max</th>
                <th className="num">Sources max</th>
                <th>Consolidation</th>
                <th>Fractionnement</th>
                <th className="num">Délai max (j)</th>
                <th>Classement</th>
                <th>Vue de stock</th>
                <th className="num">Prix</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {modes.data?.items.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => setEdit({ v: m, isNew: false })}>
                  <td>
                    <div className="flex items-center gap-m">
                      <Badge color={modeBadge(m.id)}>{m.id}</Badge>
                      <span className="font-medium">{m.name}</span>
                    </div>
                  </td>
                  <td className="text-xs text-neutral-700">{m.description}</td>
                  <td className="num">{m.maxLegs}</td>
                  <td className="num">{m.maxSources}</td>
                  <td>{m.allowConsolidation ? <Badge color="green">Autorisée</Badge> : <Badge color="grey">Non</Badge>}</td>
                  <td>{m.allowSplit ? <Badge color="green">Autorisé</Badge> : <Badge color="grey">Non</Badge>}</td>
                  <td className="num">{m.maxDeliveryDays}</td>
                  <td className="text-xs">
                    {m.selection ? <div className="font-medium">{SELECTION_LABEL[m.selection] ?? m.selection}</div> : null}
                    <div className="text-neutral-500">
                      {[...(m.criteria ?? [])]
                        .sort((a, b) => a.priority - b.priority)
                        .map((c) => (m.selection === 'LEXICOGRAPHIC' ? metricLabel(c.metric) : `${metricLabel(c.metric)} ${c.weight}`))
                        .join(' › ') || 'Pondération du moteur'}
                    </div>
                  </td>
                  <td className="text-xs">{m.stockViewId || <span className="text-neutral-500">Tous les stocks</span>}</td>
                  <td className="num whitespace-nowrap">
                    {(m.priceRateCardIds ?? []).length ? <span className="text-xs" title="Grilles de prix client">{m.priceRateCardIds!.join(', ')}</span> : fmtMoney(m.price)}
                  </td>
                  <td>{m.active ? <Badge color="green">Actif</Badge> : <Badge color="grey">Inactif</Badge>}</td>
                  <td className="text-right">
                    <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(m.id, { onSuccess: () => toast('Mode supprimé'), onError: (e) => toast(errorMessage(e), 'error') })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ModeDrawer state={edit} onClose={() => setEdit(null)} crud={crud} />
    </div>
  );
}

function ModeDrawer({ state, onClose, crud }: { state: { v: DeliveryMode; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<DeliveryMode>> }) {
  const [v, setV] = useState<DeliveryMode>(empty());
  const toast = useToast();
  const views = useStockViews();
  const cards = useRateCards({ scope: 'ORDER' });
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV({ ...state.v, criteria: state.v.criteria ?? [], selection: state.v.selection || 'WEIGHTED' });
      crud.create.reset();
      crud.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const fe = m.error instanceof ApiError ? m.error.byField : {};
  const set = <K extends keyof DeliveryMode>(k: K, val: DeliveryMode[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouveau mode de livraison' : `Mode ${v.id}`}
      width={720}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={m.isPending}
            data-testid="save-mode"
            onClick={() =>
              m.mutate(
                {
                  ...v,
                  criteria: v.criteria?.length ? cleanCriteria(v.criteria) : undefined,
                  selection: v.criteria?.length ? v.selection || 'WEIGHTED' : undefined,
                  stockViewId: v.stockViewId || undefined,
                  priceRateCardIds: v.priceRateCardIds?.length ? v.priceRateCardIds : undefined,
                },
                { onSuccess: () => { toast('Enregistré'); onClose(); } },
              )
            }
          >
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe.id}>
            <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => set('id', e.target.value)} placeholder="CLICK_COLLECT" />
          </Field>
          <Field label="Nom" error={fe.name}>
            <input className={cx('input', fe.name && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Nombre de legs max" error={fe.maxLegs}>
            <NumberInput value={v.maxLegs} min={1} max={5} onChange={(n) => set('maxLegs', n)} invalid={!!fe.maxLegs} />
          </Field>
          <Field label="Nombre de sources max" error={fe.maxSources}>
            <NumberInput value={v.maxSources} min={1} max={6} onChange={(n) => set('maxSources', n)} invalid={!!fe.maxSources} />
          </Field>
          <Field label="Délai de livraison max (jours)" error={fe.maxDeliveryDays}>
            <NumberInput value={v.maxDeliveryDays} min={0} onChange={(n) => set('maxDeliveryDays', n)} invalid={!!fe.maxDeliveryDays} />
          </Field>
          <Field label="Prix client (€)" hint="Facturé quand aucune grille de prix client n'est associée">
            <NumberInput value={v.price} step={0.01} onChange={(n) => set('price', n)} />
          </Field>
          <Field label="Vue de stock" error={fe.stockViewId} className="sm:col-span-2" hint="Points de stock et articles utilisables par ce mode">
            <select className={cx('select', fe.stockViewId && 'invalid')} value={v.stockViewId ?? ''} onChange={(e) => set('stockViewId', e.target.value)} data-testid="mode-stock-view">
              <option value="">Tous les stocks</option>
              {(views.data?.items ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.id})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <div className="os-title-s mb-s">Grilles de prix client</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Grilles de portée commande calculant le montant facturé (franco de port, prix par tranche de montant).</p>
          <ChipSelect
            options={(cards.data?.items ?? []).map((c) => c.id)}
            value={v.priceRateCardIds ?? []}
            onChange={(x) => set('priceRateCardIds', x)}
            renderLabel={(id) => <span title={cards.data?.items.find((c) => c.id === id)?.name}>{cards.data?.items.find((c) => c.id === id)?.name ?? id}</span>}
          />
          {Object.entries(fe).filter(([k]) => k.startsWith('priceRateCardIds')).map(([k, msg]) => (
            <div key={k} className="field-error">{msg}</div>
          ))}
        </div>
        <div>
          <div className="os-title-s mb-s">Critères de sélection</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Classent les options proposées au client et choisissent le chemin de chaque expédition.</p>
          <CriteriaEditor criteria={v.criteria ?? []} selection={(v.selection || 'WEIGHTED') as Selection} onChange={(c, sel) => setV((x) => ({ ...x, criteria: c, selection: sel }))} errors={fe} />
        </div>
        <Switch checked={v.allowConsolidation} onChange={(b) => set('allowConsolidation', b)} label="Consolidation en hub autorisée" />
        <Switch checked={v.allowSplit} onChange={(b) => set('allowSplit', b)} label="Livraison en plusieurs colis autorisée" />
        <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Actif' : 'Inactif'} />
      </div>
    </Drawer>
  );
}
