import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAllStockPoints, useHubs, useZones } from '../../api/hooks';
import { zoneShippingSites, type ShippingSite } from '../../lib/routes';
import { HUB_KIND_LABEL, STOCK_POINT_TYPE_LABEL } from '../../lib/labels';

/** Shipping sites of each zone (the origins of the routes leaving it); undefined while loading. */
export function useZoneShippingPoints(): (zoneId: string) => ShippingSite[] | undefined {
  const zones = useZones();
  const points = useAllStockPoints();
  const hubs = useHubs();
  const ready = !!(zones.data && points.data && hubs.data);
  const byZone = useMemo(() => {
    const m = new Map<string, ShippingSite[]>();
    if (!zones.data || !points.data || !hubs.data) return m;
    for (const z of zones.data.items) m.set(z.id, zoneShippingSites(z, points.data.items, hubs.data.items));
    return m;
  }, [zones.data, points.data, hubs.data]);
  return (zoneId: string) => (ready ? (byZone.get(zoneId) ?? []) : undefined);
}

export const shippingPointsLabel = (n: number) => `Points d'expédition : ${n} site${n > 1 ? 's' : ''} de la zone d'origine`;

/** "Points d'expédition : N sites de la zone d'origine". */
export function ShippingPointsLine({ zoneId, className }: { zoneId: string; className?: string }) {
  const of = useZoneShippingPoints();
  const list = of(zoneId);
  if (!list) return null;
  return (
    <div className={className ?? 'text-xs text-neutral-500'} data-testid="route-shipping-points">
      {shippingPointsLabel(list.length)}
    </div>
  );
}

/** List of the shipping sites of an origin zone (route Attributs tab). */
export function ShippingPointsList({ zoneId }: { zoneId: string }) {
  const of = useZoneShippingPoints();
  const list = of(zoneId);
  if (!list) return null;
  const chip = 'rounded-s border border-border bg-neutral-20 px-s py-xs text-xs text-neutral-700';
  return (
    <div data-testid="route-shipping-points-list">
      <p className="m-0 mb-m text-xs text-neutral-500">
        La route est la source de vérité des livraisons directes : chaque point de stock actif de la zone d'origine (et chaque plateforme nommée dans la zone) peut expédier avec ce service vers la zone de destination.{' '}
        {shippingPointsLabel(list.length)}.
      </p>
      {list.length === 0 ? (
        <div className="text-xs text-neutral-500">Aucun site actif dans la zone d'origine.</div>
      ) : (
        <div className="flex max-h-[240px] flex-wrap gap-s overflow-y-auto">
          {list.map((x) => {
            const title = `${x.kind === 'HUB' ? `Hub ${HUB_KIND_LABEL[x.type] ?? x.type}` : (STOCK_POINT_TYPE_LABEL[x.type] ?? x.type)} · ${x.postalCode} ${x.city}`;
            const body = (
              <>
                {x.name} <span className="text-neutral-500">{x.postalCode}</span>
              </>
            );
            return x.kind === 'STOCK_POINT' ? (
              <Link key={x.id} to={`/stock-points/${encodeURIComponent(x.id)}`} className={`${chip} hover:bg-neutral-30`} title={title}>
                {body}
              </Link>
            ) : (
              <span key={x.id} className={chip} title={title}>
                {body}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
