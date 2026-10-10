// French labels and badge colors for enum values.

export type BadgeColor = 'primary' | 'red' | 'orange' | 'blue' | 'green' | 'purple' | 'grey';

export const STOCK_POINT_TYPE_LABEL: Record<string, string> = {
  STORE: 'Magasin',
  WAREHOUSE: 'Entrepôt',
  LAST_MILE_HUB: 'Hub dernier kilomètre',
  HUB: 'Plateforme régionale',
  CUSTOMER: 'Client',
};

export const NODE_COLORS: Record<string, string> = {
  STORE: '#2695f3',
  WAREHOUSE: '#673ab7',
  LAST_MILE_HUB: '#fd7e14',
  HUB: '#43a047',
  CUSTOMER: '#24bdb0',
};

export const NODE_BADGE: Record<string, BadgeColor> = {
  STORE: 'blue',
  WAREHOUSE: 'purple',
  LAST_MILE_HUB: 'orange',
  HUB: 'green',
  CUSTOMER: 'primary',
};

export const STRATEGY_LABEL: Record<string, string> = {
  SINGLE_SOURCE: 'Source unique',
  MULTI_SOURCE_DIRECT: 'Multi-source direct',
  CONSOLIDATED: 'Consolidé en hub',
};
export const STRATEGY_BADGE: Record<string, BadgeColor> = {
  SINGLE_SOURCE: 'green',
  MULTI_SOURCE_DIRECT: 'orange',
  CONSOLIDATED: 'purple',
};

export const MODE_BADGE: Record<string, BadgeColor> = {
  STANDARD: 'blue',
  EXPRESS: 'orange',
  SAME_DAY: 'red',
  RELAY: 'purple',
};
export const modeBadge = (m: string): BadgeColor => MODE_BADGE[m] ?? 'grey';

export const SERVICE_KIND_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  EXPRESS: 'Express',
  SAME_DAY: 'Jour même',
  HOME: 'Domicile',
  RELAY: 'Point relais',
  STORE_DELIVERY: 'Livraison magasin',
  LAST_MILE: 'Dernier kilomètre',
  LINEHAUL: 'Transport amont',
  SHUTTLE: 'Navette',
};

export const HUB_KIND_LABEL: Record<string, string> = {
  CONSOLIDATION: 'Consolidation',
  LAST_MILE: 'Dernier kilomètre',
};

export const UNAVAILABLE_LABEL: Record<string, string> = {
  DESTINATION_NOT_SERVED: 'Destination non desservie',
  NO_STOCK: 'Aucun stock',
  INSUFFICIENT_STOCK: 'Stock insuffisant',
  NO_FEASIBLE_PLAN: 'Aucun plan réalisable',
};

export const TIMELINE_LABEL: Record<string, string> = {
  ORDER: 'Commande',
  PREPARATION_READY: 'Préparation terminée',
  DEPARTURE: 'Départ',
  ARRIVAL: 'Arrivée',
  CONSOLIDATION_READY: 'Consolidation terminée',
  DELIVERY: 'Livraison',
};

export const SHIPMENT_KIND_LABEL: Record<string, string> = {
  DIRECT: 'Direct',
  INBOUND: 'Entrant (vers hub)',
  OUTBOUND: 'Sortant (depuis hub)',
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: 'En cours',
  stopping: 'Arrêt en cours',
  completed: 'Terminé',
  stopped: 'Arrêté',
  failed: 'Échec',
};
export const RUN_STATUS_BADGE: Record<string, BadgeColor> = {
  running: 'blue',
  stopping: 'orange',
  completed: 'green',
  stopped: 'orange',
  failed: 'red',
};

export const CATEGORY_LABEL: Record<string, string> = {
  mono: 'Mono-article',
  multi: 'Multi-articles',
  'multi-source': 'Multi-sources',
  consolidation: 'Consolidation',
};

export const WEEKDAYS: { n: number; short: string; long: string }[] = [
  { n: 1, short: 'L', long: 'Lundi' },
  { n: 2, short: 'M', long: 'Mardi' },
  { n: 3, short: 'M', long: 'Mercredi' },
  { n: 4, short: 'J', long: 'Jeudi' },
  { n: 5, short: 'V', long: 'Vendredi' },
  { n: 6, short: 'S', long: 'Samedi' },
  { n: 7, short: 'D', long: 'Dimanche' },
];

/** Palette used for packages on the journey map (status colors, then neutrals). */
export const PACKAGE_COLORS = ['#2695f3', '#fd7e14', '#673ab7', '#43a047', '#f44539', '#24bdb0', '#515b60', '#c35f0b'];

export const P95_TARGET_MS = 100;
