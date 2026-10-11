import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { qk, useAdditionalServices, useCrud, usePricingFields } from '../api/hooks';
import type { AdditionalService } from '../api/types';
import { IconPlus, IconTag } from '../components/Icons';
import { cleanOutputs, OutputsEditor, summarizeComponents } from '../components/pricing/Outputs';
import { describeRule, RuleBuilder } from '../components/pricing/RuleBuilder';
import { Badge, Card, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, errorsUnder, Field, Loading, NumberInput, PageHeader, Spinner, Switch, useToast } from '../components/ui';
import { ADDITIONAL_KIND_LABEL, outputLabel } from '../lib/labels';

const empty = (): AdditionalService => ({ id: '', name: '', kind: 'DELIVERY', description: '', appliesTo: [], outputs: { price: { fixed: 10 }, cost: { fixed: 6 } }, extraDays: 0, active: true });

export default function AdditionalServices() {
  const list = useAdditionalServices();
  const crud = useCrud<AdditionalService>('additional-services', [qk.additionalServices]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ v: AdditionalService; isNew: boolean } | null>(null);
  return (
    <div>
      <PageHeader
        title="Services associés"
        subtitle="Prestations optionnelles proposées avec la livraison : installation, livraison dans la pièce, reprise, rendez-vous"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ v: empty(), isNew: true })}>
            <IconPlus /> Créer un service
          </button>
        }
      />
      <Card bodyClassName="overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <div className="p-xl">
            <ErrorAlert error={list.error} />
          </div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState title="Aucun service associé" icon={<IconTag size={40} />} />
        ) : (
          <table className="table" data-testid="additional-services">
            <thead>
              <tr>
                <th>Service</th>
                <th>Type</th>
                <th>Articles concernés</th>
                <th>Sorties</th>
                <th className="num">Jours en plus</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setEdit({ v: s, isNew: false })}>
                  <td>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-neutral-500">{s.id}</div>
                  </td>
                  <td>
                    <Badge color="blue">{ADDITIONAL_KIND_LABEL[s.kind] ?? s.kind}</Badge>
                  </td>
                  <td className="max-w-[260px] text-xs">{(s.appliesTo ?? []).length ? s.appliesTo!.map(describeRule).join(' et ') : <span className="text-neutral-500">Tous les articles</span>}</td>
                  <td className="text-xs">
                    {Object.entries(s.outputs ?? {}).map(([k, c]) => (
                      <div key={k}>
                        <span className="text-neutral-500">{outputLabel(k)}</span> {summarizeComponents(c)}
                      </div>
                    ))}
                  </td>
                  <td className="num">{s.extraDays}</td>
                  <td>{s.active ? <Badge color="green">Actif</Badge> : <Badge color="grey">Inactif</Badge>}</td>
                  <td className="text-right">
                    <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(s.id, { onSuccess: () => toast('Service supprimé'), onError: (e) => toast(errorMessage(e), 'error') })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ServiceDrawer state={edit} onClose={() => setEdit(null)} crud={crud} />
    </div>
  );
}

function ServiceDrawer({ state, onClose, crud }: { state: { v: AdditionalService; isNew: boolean } | null; onClose: () => void; crud: ReturnType<typeof useCrud<AdditionalService>> }) {
  const [v, setV] = useState<AdditionalService>(empty());
  const fields = usePricingFields();
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
  const fe = (n: string) => errorsUnder(m.error, n)[0]?.message;
  const set = <K extends keyof AdditionalService>(k: K, val: AdditionalService[K]) => setV((x) => ({ ...x, [k]: val }));
  const kinds = fields.data?.additionalServiceKinds ?? Object.keys(ADDITIONAL_KIND_LABEL);
  const submit = () => m.mutate({ ...v, description: v.description || undefined, appliesTo: v.appliesTo?.length ? v.appliesTo : undefined, outputs: cleanOutputs(v.outputs) }, { onSuccess: () => { toast('Enregistré'); onClose(); } });
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouveau service associé' : `Service ${v.id}`}
      width={720}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={submit}>
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe('id')}>
            <input className={cx('input', fe('id') && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => set('id', e.target.value)} placeholder="INSTALLATION" />
          </Field>
          <Field label="Nom" error={fe('name')}>
            <input className={cx('input', fe('name') && 'invalid')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type">
            <select className="select" value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {ADDITIONAL_KIND_LABEL[k] ?? k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jours de livraison en plus" error={fe('extraDays')} hint="Jours ouvrés de livraison, 0 à 30">
            <NumberInput value={v.extraDays} min={0} max={30} onChange={(n) => set('extraDays', n)} invalid={!!fe('extraDays')} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="os-title-s mb-s">Articles concernés</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Le service s'applique aux articles qui respectent toutes les règles. Sans règle, il s'applique à tout le panier.</p>
          <RuleBuilder rules={v.appliesTo} onChange={(r) => set('appliesTo', r)} error={fe('appliesTo')} emptyText="Tous les articles" />
        </div>
        <div>
          <div className="os-title-s mb-s">Sorties</div>
          <p className="m-0 mb-m text-xs text-neutral-500">Le fixe est compté une fois par commande, le taux par article sur les articles concernés.</p>
          <OutputsEditor value={v.outputs} onChange={(o) => set('outputs', o)} error={fe('outputs')} />
        </div>
        <Switch checked={v.active} onChange={(b) => set('active', b)} label={v.active ? 'Actif' : 'Inactif'} />
      </div>
    </Drawer>
  );
}
