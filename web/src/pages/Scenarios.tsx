import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { qk, useCrud, useScenarios } from '../api/hooks';
import type { PromiseRequest, Scenario } from '../api/types';
import { IconPlay, IconPlus } from '../components/Icons';
import { Alert, Badge, Card, ConfirmButton, cx, Drawer, EmptyState, ErrorAlert, Field, ListInput, Loading, PageHeader, SearchInput, Spinner, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { loadSimForm, toRequest } from '../lib/simState';

export default function Scenarios() {
  const nav = useNavigate();
  const scenarios = useScenarios();
  const crud = useCrud<Scenario>('scenarios', [qk.scenarios]);
  const toast = useToast();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const items = (scenarios.data?.items ?? []).filter((s) => !q || `${s.id} ${s.name} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Scénarios"
        subtitle="Paniers de test enregistrés, rejouables dans le simulateur"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus /> Créer un scénario
          </button>
        }
      />
      <Card title={`${items.length} scénarios`} bodyClassName="overflow-x-auto" actions={<SearchInput className="w-[240px]" value={q} onChange={setQ} placeholder="Rechercher" />}>
        {scenarios.isLoading ? (
          <Loading />
        ) : scenarios.error ? (
          <div className="p-xl">
            <ErrorAlert error={scenarios.error} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="Aucun scénario" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Scénario</th>
                <th>Description</th>
                <th>Panier</th>
                <th>Destination</th>
                <th>Date de commande</th>
                <th>Modes</th>
                <th>Créé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="font-medium">{s.name}</div>
                    <div className="flex flex-wrap items-center gap-s text-xs text-neutral-500">
                      {s.id}
                      {(s.tags ?? []).map((t) => (
                        <Badge key={t} color="grey">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-[280px] text-xs text-neutral-700">{s.description}</td>
                  <td className="text-xs">
                    {s.request.items.length} lignes · {s.request.items.reduce((n, i) => n + i.quantity, 0)} unités
                  </td>
                  <td>
                    {s.request.destination.country} {s.request.destination.postalCode}
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(s.request.orderDate)}</td>
                  <td className="text-xs">{(s.request.deliveryModes ?? []).join(', ') || 'Tous'}</td>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(s.createdAt)}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-s">
                      <button className="btn btn-secondary btn-sm" onClick={() => nav(`/simulator?scenario=${encodeURIComponent(s.id)}`)}>
                        <IconPlay /> Exécuter
                      </button>
                      <ConfirmButton iconOnly confirmLabel="Supprimer" onConfirm={() => crud.remove.mutate(s.id, { onSuccess: () => toast('Scénario supprimé'), onError: (e) => toast(errorMessage(e), 'error') })} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <CreateDrawer open={creating} onClose={() => setCreating(false)} crud={crud} />
    </div>
  );
}

function CreateDrawer({ open, onClose, crud }: { open: boolean; onClose: () => void; crud: ReturnType<typeof useCrud<Scenario>> }) {
  const toast = useToast();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [json, setJson] = useState('');
  const [parseError, setParseError] = useState('');
  useEffect(() => {
    if (open) {
      setId(`SCN-${Date.now().toString().slice(-6)}`);
      setName('');
      setDescription('');
      setTags([]);
      setJson(JSON.stringify(toRequest(loadSimForm()), null, 2));
      setParseError('');
      crud.create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fe = crud.create.error instanceof ApiError ? crud.create.error.byField : {};
  const submit = () => {
    let request: PromiseRequest;
    try {
      request = JSON.parse(json);
    } catch (e) {
      setParseError('JSON invalide : ' + (e as Error).message);
      return;
    }
    setParseError('');
    crud.create.mutate(
      { id, name, description, tags, request, createdAt: new Date().toISOString() },
      {
        onSuccess: () => {
          toast('Scénario enregistré');
          onClose();
        },
      },
    );
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Nouveau scénario"
      width={620}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={crud.create.isPending}>
            {crud.create.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        <Alert kind="info">La requête est pré-remplie avec le panier courant du simulateur.</Alert>
        {crud.create.error ? <ErrorAlert error={crud.create.error} title="Enregistrement impossible" /> : null}
        <div className="grid gap-l sm:grid-cols-2">
          <Field label="Identifiant" error={fe.id}>
            <input className={cx('input', fe.id && 'invalid')} value={id} onChange={(e) => setId(e.target.value)} />
          </Field>
          <Field label="Nom" error={fe.name}>
            <input className={cx('input', fe.name && 'invalid')} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Étiquettes" className="sm:col-span-2" hint="Séparées par des virgules">
            <ListInput value={tags} onChange={setTags} placeholder="multi-sources, lyon" />
          </Field>
        </div>
        <Field label="Requête de promesse (JSON)" error={parseError || fe['request.items']}>
          <textarea className={cx('textarea font-code text-xs', (parseError || fe['request.items']) && 'invalid')} rows={16} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
        </Field>
      </div>
    </Drawer>
  );
}
