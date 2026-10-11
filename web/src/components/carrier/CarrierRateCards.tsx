import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { qk, useCrud, useRateCards, useServices } from '../../api/hooks';
import type { Carrier } from '../../api/types';
import { RATE_SCOPE_BADGE, RATE_SCOPE_LABEL } from '../../lib/labels';
import { IconEdit, IconPlus, IconTag } from '../Icons';
import { Badge, EmptyState, ErrorAlert, Loading, Spinner, useToast } from '../ui';
import { cleanCarrier, errorsStarting, FieldErrors, Hint, RateCardChips } from './shared';

export function CarrierRateCards({ carrier }: { carrier: Carrier }) {
  const cards = useRateCards();
  const services = useServices(carrier.id);
  const crud = useCrud<Carrier>('carriers', [qk.carriers]);
  const toast = useToast();
  const navigate = useNavigate();
  const [defaults, setDefaults] = useState<string[]>(carrier.rateCardIds ?? []);
  useEffect(() => setDefaults(carrier.rateCardIds ?? []), [carrier.rateCardIds]);
  const dirty = JSON.stringify(defaults) !== JSON.stringify(carrier.rateCardIds ?? []);

  const all = useMemo(() => cards.data?.items ?? [], [cards.data]);
  const svc = useMemo(() => services.data?.items ?? [], [services.data]);
  const schedules = carrier.schedules ?? [];
  const usedIds = new Set([...(carrier.rateCardIds ?? []), ...svc.flatMap((s) => s.rateCardIds ?? []), ...schedules.flatMap((s) => s.rateCardIds ?? [])]);
  const rows = all.filter((c) => c.carrierId === carrier.id || usedIds.has(c.id));

  const save = () =>
    crud.update.mutate(cleanCarrier({ ...carrier, rateCardIds: defaults }), {
      onSuccess: () => toast('Grilles par défaut enregistrées'),
    });

  const rootErrors = crud.update.error instanceof ApiError ? errorsStarting(crud.update.error.byField, 'rateCardIds') : [];

  return (
    <div className="flex flex-col gap-2xl p-xl">
      <section className="flex flex-col gap-m">
        <div className="flex flex-wrap items-center justify-between gap-m">
          <div>
            <div className="os-title-s">Grilles par défaut du transporteur</div>
            <Hint>Appliquées à tous les services du transporteur qui n'ont pas de grille propre. Priorité : leg, puis planning, puis service, puis transporteur.</Hint>
          </div>
          <button className="btn btn-primary btn-sm" disabled={!dirty || crud.update.isPending} onClick={save} data-testid="save-carrier-cards">
            {crud.update.isPending && <Spinner size={14} className="text-white" />}
            Enregistrer
          </button>
        </div>
        {cards.isLoading ? <Loading /> : <RateCardChips cards={all} carrierId={carrier.id} value={defaults} onChange={setDefaults} testId="carrier-default-cards" />}
        <FieldErrors messages={rootErrors} />
        {crud.update.error && !rootErrors.length ? <ErrorAlert error={crud.update.error} title="Enregistrement impossible" /> : null}
      </section>

      <section className="flex flex-col gap-m">
        <div className="flex flex-wrap items-center justify-between gap-m">
          <div>
            <div className="os-title-s">Grilles du transporteur</div>
            <Hint>Grilles rattachées à ce transporteur ou utilisées par lui, avec leur usage.</Hint>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/rate-cards?new=1&carrierId=${encodeURIComponent(carrier.id)}`)}>
            <IconPlus /> Nouvelle grille
          </button>
        </div>
        <div className="overflow-x-auto rounded-m border border-border">
          {cards.isLoading ? (
            <Loading />
          ) : cards.error ? (
            <div className="p-xl">
              <ErrorAlert error={cards.error} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title="Aucune grille pour ce transporteur" icon={<IconTag size={40} />} />
          ) : (
            <table className="table" data-testid="carrier-rate-cards">
              <thead>
                <tr>
                  <th>Grille</th>
                  <th>Portée</th>
                  <th className="num">Lignes</th>
                  <th>Usage</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const usedBySvc = svc.filter((s) => (s.rateCardIds ?? []).includes(c.id));
                  const usedBySch = schedules.filter((s) => (s.rateCardIds ?? []).includes(c.id));
                  const isDefault = (carrier.rateCardIds ?? []).includes(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-neutral-500">
                          {c.id}
                          {c.carrierId && c.carrierId !== carrier.id ? ` · rattachée à ${c.carrierId}` : ''}
                        </div>
                      </td>
                      <td>
                        <Badge color={RATE_SCOPE_BADGE[c.scope]}>{RATE_SCOPE_LABEL[c.scope] ?? c.scope}</Badge>
                      </td>
                      <td className="num">{c.rows.length}</td>
                      <td className="text-xs">
                        <div className="flex flex-wrap gap-s">
                          {isDefault && <Badge color="green">Défaut transporteur</Badge>}
                          {usedBySvc.map((s) => (
                            <Badge key={s.id} color="blue" title={`Service ${s.id}`}>
                              {s.name}
                            </Badge>
                          ))}
                          {usedBySch.map((s) => (
                            <Badge key={s.id} color="purple" title={`Planning ${s.id}`}>
                              {s.name || s.id}
                            </Badge>
                          ))}
                          {!isDefault && !usedBySvc.length && !usedBySch.length && <span className="text-neutral-500">Non utilisée</span>}
                        </div>
                      </td>
                      <td>{c.active ? <Badge color="green">Active</Badge> : <Badge color="grey">Inactive</Badge>}</td>
                      <td className="text-right">
                        <button className="btn btn-tertiary btn-sm" onClick={() => navigate(`/rate-cards?id=${encodeURIComponent(c.id)}`)}>
                          <IconEdit /> Modifier
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
