import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { qk, useCarriers, useCrud, useHubs, useModes, useRateCards, useServices, useStockViews } from '../api/hooks';
import { emptyCard, RateCardDrawer } from '../components/pricing/RateCardEditor';
import { cleanCriteria, CriteriaEditor } from '../components/pricing/CriteriaEditor';
import type { DeliveryMode, RateCard, Selection } from '../api/types';
import { IconCheck, IconChevronDown, IconChevronUp, IconEdit, IconPlus, IconTruck } from '../components/Icons';
import { Badge, Checkbox, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, Loading, NumberInput, PageHeader, SearchInput, Spinner, Switch, useToast } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { metricLabel, modeBadge, SELECTION_LABEL } from '../lib/labels';

const empty = (): DeliveryMode => ({ id: '', name: '', description: '', maxLegs: 3, maxSources: 2, allowConsolidation: true, allowSplit: true, maxDeliveryDays: 5, price: 4.9, criteria: [{ metric: 'deliveryHours', weight: 0.6, priority: 1 }, { metric: 'cost', weight: 0.4, priority: 2 }], selection: 'WEIGHTED', stockViewId: '', priceRateCardIds: [], active: true });

export default function DeliveryModes() {
  const modes = useModes();
  const crud = useCrud<DeliveryMode>('delivery-modes', [qk.modes]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ v: DeliveryMode; isNew: boolean } | null>(null);
  const [q, setQ] = useState('');
  const list = (modes.data?.items ?? []).filter((m) => !q || `${m.id} ${m.name} ${m.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Configuration de la livraison"
        subtitle="Modes de livraison : vue de stock, transporteurs, opérations et priorités"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: empty(), isNew: true })}>
            <IconPlus /> Créer un mode
          </button>
        }
      />
      <section className="card mb-xl p-xl">
        <SearchInput value={q} onChange={setQ} placeholder="Rechercher" />
      </section>
      {modes.isLoading ? (
        <Loading />
      ) : modes.error ? (
        <ErrorAlert error={modes.error} />
      ) : list.length === 0 ? (
        <EmptyState title="Aucun mode de livraison" />
      ) : (
        <div className="flex flex-col gap-l" data-testid="mode-cards">
          {list.map((m) => (
            <ModeCard
              key={m.id}
              mode={m}
              onEdit={() => setEdit({ v: m, isNew: false })}
              onDelete={() => crud.remove.mutate(m.id, { onSuccess: () => toast('Mode supprimé'), onError: (e) => toast(errorMessage(e), 'error') })}
            />
          ))}
        </div>
      )}
      <ModeDrawer state={edit} onClose={() => setEdit(null)} crud={crud} />
    </div>
  );
}

function Step({ done, title, children, onClick }: { done: boolean; title: string; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center gap-l rounded-m border border-border bg-white px-xl py-l text-left hover:bg-neutral-20" onClick={onClick}>
      {done ? (
        <span className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-round text-white" style={{ background: 'var(--primary-1000)' }}>
          <IconCheck size={18} />
        </span>
      ) : (
        <span className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-round bg-neutral-30 text-neutral-500">•••</span>
      )}
      <span className="min-w-0">
        <span className="block text-s font-medium text-neutral-800">{title}</span>
        <span className="block truncate text-xs text-neutral-500">{children}</span>
      </span>
    </button>
  );
}

function ModeCard({ mode: m, onEdit, onDelete }: { mode: DeliveryMode; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(true);
  const views = useStockViews();
  const services = useServices();
  const carriers = useCarriers();
  const hubs = useHubs();
  const cards = useRateCards({ scope: 'ORDER' });
  const view = views.data?.items.find((x) => x.id === m.stockViewId);
  const svc = (services.data?.items ?? []).filter((s) => s.active && (s.modes ?? []).includes(m.id));
  const carrierName = (id: string) => (carriers.data?.items.find((c) => c.id === id)?.name ?? id).toLowerCase();
  const consolidation = m.allowConsolidation ? (hubs.data?.items ?? []).filter((h) => h.active && h.consolidationEnabled) : [];
  const criteria = [...(m.criteria ?? [])].sort((a, b) => a.priority - b.priority);
  const steps = [!!m.stockViewId, svc.length > 0, consolidation.length > 0, criteria.length > 0];
  const done = steps.filter(Boolean).length;
  const priceCards = (m.priceRateCardIds ?? []).map((id) => cards.data?.items.find((c) => c.id === id)?.name ?? id);
  return (
    <section className="card p-xl" data-testid="mode-card">
      <div className="flex flex-wrap items-center gap-l">
        <span className="flex h-[48px] w-[48px] flex-none items-center justify-center rounded-round bg-neutral-30 text-neutral-500">
          <IconTruck size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-m">
            <span className="text-s font-medium text-neutral-800">{m.name}</span>
            <Badge color={modeBadge(m.id)}>{m.id}</Badge>
            {!m.active && <Badge color="grey">Inactif</Badge>}
          </div>
          <div className="text-s text-neutral-700">
            {m.maxLegs} leg{m.maxLegs > 1 ? 's' : ''} max | {m.maxSources} source{m.maxSources > 1 ? 's' : ''} max | {m.maxDeliveryDays} j max | {priceCards.length ? `Prix : ${priceCards.join(', ')}` : `Prix : ${fmtMoney(m.price)}`}
          </div>
          {m.description && <div className="text-xs text-neutral-500">{m.description}</div>}
        </div>
        <div className="flex items-center gap-s">
          <button className="btn btn-secondary btn-sm" onClick={onEdit} aria-label={`Modifier ${m.name}`}>
            <IconEdit /> Modifier
          </button>
          <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={onDelete} />
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Replier' : 'Déplier'} aria-expanded={open}>
            {open ? <IconChevronUp /> : <IconChevronDown />}
          </button>
        </div>
      </div>
      <div className="mt-l flex items-center gap-m">
        <div className="h-[8px] flex-1 overflow-hidden rounded-round bg-neutral-50">
          <div className="h-full rounded-round" style={{ width: `${(done / 4) * 100}%`, background: 'var(--primary-1000)' }} />
        </div>
        <span className="text-s font-medium text-neutral-800" data-testid="mode-progress">
          {done}/4
        </span>
      </div>
      {open && (
        <div className="mt-l flex flex-col gap-m">
          <Step done={steps[0]} title="Requêtes de stock" onClick={onEdit}>
            {view ? view.name : 'Tous les stocks (aucune vue de stock)'}
          </Step>
          <Step done={steps[1]} title="Transporteurs" onClick={onEdit}>
            {svc.length ? svc.map((s) => `${carrierName(s.carrierId)} - ${s.name}`).join(' | ') : 'Aucun service de transport pour ce mode'}
          </Step>
          <Step done={steps[2]} title="Opérations" onClick={onEdit}>
            {consolidation.length ? `Consolidation : ${consolidation.map((h) => h.name).join(' | ')}` : m.allowConsolidation ? 'Aucun hub de consolidation actif' : 'Aucune opération'}
          </Step>
          <Step done={steps[3]} title="Priorités" onClick={onEdit}>
            {criteria.length ? criteria.map((c) => metricLabel(c.metric)).join(' | ') : 'Pondération du moteur'}
            {criteria.length && m.selection ? ` (${SELECTION_LABEL[m.selection] ?? m.selection})` : ''}
          </Step>
        </div>
      )}
    </section>
  );
}

function ModeDrawer({ state, onClose, crud }: { state: { v: DeliveryMode; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<DeliveryMode>> }) {
  const [v, setV] = useState<DeliveryMode>(empty());
  const toast = useToast();
  const views = useStockViews();
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
        <PriceCards value={v.priceRateCardIds ?? []} onChange={(x) => set('priceRateCardIds', x)} errors={Object.entries(fe).filter(([k]) => k.startsWith('priceRateCardIds')).map(([, msg]) => msg)} />
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

/** Customer price grids (ORDER scope) of a mode: selection and inline editing. */
function PriceCards({ value, onChange, errors }: { value: string[]; onChange: (v: string[]) => void; errors: string[] }) {
  const cards = useRateCards({ scope: 'ORDER' });
  const [edit, setEdit] = useState<{ card: RateCard; isNew: boolean } | null>(null);
  const list = cards.data?.items ?? [];
  const missing = value.filter((id) => !list.some((c) => c.id === id));
  return (
    <div data-testid="price-cards">
      <div className="mb-s flex flex-wrap items-center justify-between gap-m">
        <div className="os-title-s">Grilles de prix client</div>
        <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ card: emptyCard('ORDER'), isNew: true })} data-testid="new-price-card">
          <IconPlus /> Nouvelle grille client
        </button>
      </div>
      <p className="m-0 mb-m text-xs text-neutral-500">Grilles de portée commande calculant le montant facturé (franco de port, prix par tranche de montant). Cocher les grilles appliquées à ce mode.</p>
      {cards.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="text-xs text-neutral-500">Aucune grille client.</div>
      ) : (
        <div className="flex flex-col gap-s">
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-m rounded-m border border-border px-l py-m">
              <Checkbox checked={value.includes(c.id)} onChange={(b) => onChange(b ? [...value, c.id] : value.filter((x) => x !== c.id))} label={<span className="font-medium">{c.name}</span>} />
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" title={c.rows.map((r) => r.label).filter(Boolean).join(' · ')}>
                {c.id} · {c.rows.length} ligne{c.rows.length > 1 ? 's' : ''}
                {c.rows.some((r) => r.label) ? ` · ${c.rows.map((r) => r.label).filter(Boolean).join(' · ')}` : ''}
              </span>
              {!c.active && <Badge color="grey">Inactive</Badge>}
              <button className="btn btn-tertiary btn-sm" onClick={() => setEdit({ card: c, isNew: false })} aria-label={`Modifier la grille ${c.name}`}>
                <IconEdit /> Modifier
              </button>
            </div>
          ))}
        </div>
      )}
      {missing.map((id) => (
        <div key={id} className="field-error">
          Grille introuvable : {id}{' '}
          <button className="underline" onClick={() => onChange(value.filter((x) => x !== id))}>
            retirer
          </button>
        </div>
      ))}
      {errors.map((msg) => (
        <div key={msg} className="field-error">
          {msg}
        </div>
      ))}
      <RateCardDrawer
        state={edit}
        onClose={() => setEdit(null)}
        scopes={['ORDER']}
        onSaved={(c) => edit?.isNew && !value.includes(c.id) && onChange([...value, c.id])}
        onDeleted={(id) => onChange(value.filter((x) => x !== id))}
      />
    </div>
  );
}
