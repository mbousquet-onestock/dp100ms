import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { qk, useCrud, useModes } from '../api/hooks';
import type { DeliveryMode } from '../api/types';
import { IconPlus } from '../components/Icons';
import { Badge, Card, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, Loading, NumberInput, PageHeader, Spinner, Switch, useToast } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { modeBadge } from '../lib/labels';

const empty = (): DeliveryMode => ({ id: '', name: '', description: '', maxLegs: 3, maxSources: 2, allowConsolidation: true, allowSplit: true, maxDeliveryDays: 5, price: 4.9, active: true });

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
                  <td className="num">{fmtMoney(m.price)}</td>
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
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV(state.v);
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
      width={560}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate(v, { onSuccess: () => { toast('Enregistré'); onClose(); } })}>
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
          <Field label="Prix client (€)">
            <NumberInput value={v.price} step={0.01} onChange={(n) => set('price', n)} />
          </Field>
        </div>
        <Switch checked={v.allowConsolidation} onChange={(b) => set('allowConsolidation', b)} label="Consolidation en hub autorisée" />
        <Switch checked={v.allowSplit} onChange={(b) => set('allowSplit', b)} label="Livraison en plusieurs colis autorisée" />
        <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Actif' : 'Inactif'} />
      </div>
    </Drawer>
  );
}
