import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { qk, useCrud, useServices } from '../../api/hooks';
import type { Carrier, CarrierRoute, Restriction } from '../../api/types';
import { RESTRICTION_MODE_LABEL } from '../../lib/labels';
import { describeRule, RestrictionsEditor } from '../pricing/RuleBuilder';
import { Badge, ErrorAlert, Spinner, useToast } from '../ui';
import { cleanCarrier, Hint } from './shared';

/** Carrier-level restrictions (editable) and overview of those of its services and routes. */
export function CarrierRestrictions({ carrier, routes }: { carrier: Carrier; routes: CarrierRoute[] }) {
  const services = useServices(carrier.id);
  const crud = useCrud<Carrier>('carriers', [qk.carriers]);
  const toast = useToast();
  const [draft, setDraft] = useState<Restriction[]>(carrier.restrictions ?? []);
  useEffect(() => setDraft(carrier.restrictions ?? []), [carrier.restrictions]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(carrier.restrictions ?? []);
  const fe = crud.update.error instanceof ApiError ? crud.update.error.byField : {};
  const save = () => crud.update.mutate(cleanCarrier({ ...carrier, restrictions: draft }), { onSuccess: () => toast('Restrictions enregistrées') });
  const others: { kind: 'Service' | 'Route'; name: string; to?: string; list: Restriction[] }[] = [
    ...(services.data?.items ?? []).filter((s) => s.restrictions?.length).map((s) => ({ kind: 'Service' as const, name: s.name, list: s.restrictions! })),
    ...routes
      .filter((r) => r.restrictions?.length)
      .map((r) => ({ kind: 'Route' as const, name: r.name || r.id, to: `/carriers/${encodeURIComponent(carrier.id)}/routes/${encodeURIComponent(r.id)}?tab=attributes`, list: r.restrictions! })),
  ];
  return (
    <div className="flex flex-col gap-2xl" data-testid="carrier-restrictions">
      <section className="flex flex-col gap-m">
        <div className="flex flex-wrap items-center justify-between gap-m">
          <div>
            <div className="os-title-s">Restrictions du transporteur</div>
            <Hint>Appliquées à tous les services et à toutes les routes du transporteur ; elles s'ajoutent à celles des services, des routes et des legs.</Hint>
          </div>
          <div className="flex gap-m">
            <button className="btn btn-secondary btn-sm" disabled={!dirty} onClick={() => setDraft(carrier.restrictions ?? [])}>
              Annuler
            </button>
            <button className="btn btn-primary btn-sm" disabled={!dirty || crud.update.isPending} onClick={save} data-testid="save-carrier-restrictions">
              {crud.update.isPending && <Spinner size={14} className="text-white" />}
              Enregistrer
            </button>
          </div>
        </div>
        {crud.update.error ? <ErrorAlert error={crud.update.error} title="Enregistrement impossible" /> : null}
        <RestrictionsEditor value={draft} onChange={setDraft} errors={fe} />
      </section>
      <section className="flex flex-col gap-m">
        <div>
          <div className="os-title-s">Restrictions des services et des routes</div>
          <Hint>Lecture seule : elles se modifient dans l'onglet Services ou dans l'onglet Attributs d'une route.</Hint>
        </div>
        {others.length === 0 ? (
          <div className="text-xs text-neutral-500">Aucune restriction sur les services ni sur les routes.</div>
        ) : (
          <div className="flex flex-col gap-m">
            {others.map((o, i) => (
              <div key={i} className="rounded-m border border-border p-l">
                <div className="mb-s flex items-center gap-m">
                  <Badge color={o.kind === 'Service' ? 'blue' : 'purple'}>{o.kind}</Badge>
                  {o.to ? (
                    <Link to={o.to} className="text-s font-medium text-primary hover:underline">
                      {o.name}
                    </Link>
                  ) : (
                    <span className="text-s font-medium">{o.name}</span>
                  )}
                </div>
                <ul className="m-0 flex list-none flex-col gap-xs p-0 text-xs text-neutral-700">
                  {o.list.map((r, j) => (
                    <li key={j}>
                      <span className="font-medium">{r.name || `Restriction ${j + 1}`}</span> <span className="text-neutral-500">({RESTRICTION_MODE_LABEL[r.mode] ?? r.mode})</span> : {r.rules.map(describeRule).join(r.mode === 'REQUIRE_ALL' ? ' et ' : ' ou ')}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
