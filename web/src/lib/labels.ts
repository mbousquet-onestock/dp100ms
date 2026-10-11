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
  ECO: 'green',
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

// ---------------------------------------------------------------------------
// Pricing

export const RATE_SCOPE_LABEL: Record<string, string> = {
  PARCEL: 'Colis',
  SHIPMENT: 'Expédition',
  ORDER: 'Commande',
};
export const RATE_SCOPE_HINT: Record<string, string> = {
  PARCEL: 'Évaluée pour chaque colis sur chaque leg utilisant la grille (coût transporteur, carbone)',
  SHIPMENT: 'Évaluée une fois par expédition, pour les colis partageant le même chemin (navettes, tournées)',
  ORDER: 'Évaluée une fois par option de livraison : prix client, franco de port',
};
export const RATE_SCOPE_BADGE: Record<string, BadgeColor> = { PARCEL: 'blue', SHIPMENT: 'purple', ORDER: 'orange' };

export const RATE_VAR_LABEL: Record<string, string> = {
  weightKg: 'Poids réel (kg)',
  volumeL: 'Volume (L)',
  volumetricWeightKg: 'Poids volumétrique (kg)',
  chargeableWeightKg: 'Poids taxable (kg)',
  lengthCm: 'Longueur (cm)',
  widthCm: 'Largeur (cm)',
  heightCm: 'Hauteur (cm)',
  girthCm: 'Longueur + pourtour (cm)',
  sumDimensionsCm: 'Somme des dimensions (cm)',
  itemCount: "Nombre d'articles",
  parcelCount: 'Nombre de colis',
  orderAmount: 'Montant de la commande (€)',
  goodsValue: 'Valeur des marchandises (€)',
  distanceKm: 'Distance (km)',
  legs: 'Nombre de legs',
  transitDays: 'Transit (jours)',
};
export const varLabel = (k: string) => RATE_VAR_LABEL[k] ?? k;

export const ARTICLE_FIELD_LABEL: Record<string, string> = {
  sku: 'SKU',
  name: 'Libellé',
  category: 'Catégorie',
  weightKg: 'Poids (kg)',
  volumeL: 'Volume (L)',
  lengthCm: 'Longueur (cm)',
  widthCm: 'Largeur (cm)',
  heightCm: 'Hauteur (cm)',
  longestSideCm: 'Plus grand côté (cm)',
  girthCm: 'Longueur + pourtour (cm)',
  sumDimensionsCm: 'Somme des dimensions (cm)',
  priceEur: 'Prix (€)',
};
export const fieldLabel = (f: string) => ARTICLE_FIELD_LABEL[f] ?? (f.startsWith('attributes.') ? `Attribut ${f.slice(11)}` : f);

export const RULE_OP_LABEL: Record<string, string> = {
  eq: 'est égal à',
  neq: 'est différent de',
  in: 'fait partie de',
  nin: 'ne fait pas partie de',
  lt: 'inférieur à',
  lte: 'inférieur ou égal à',
  gt: 'supérieur à',
  gte: 'supérieur ou égal à',
  between: 'compris entre',
  exists: 'est renseigné',
  missing: "n'est pas renseigné",
  contains: 'contient',
};

export const RESTRICTION_MODE_LABEL: Record<string, string> = {
  EXCLUDE_IF_ANY: 'Exclure si une règle correspond',
  REQUIRE_ALL: 'Accepter seulement si toutes les règles correspondent',
};

export const OUTPUT_LABEL: Record<string, string> = {
  cost: 'Coût transporteur',
  price: 'Prix client',
  carbonKg: 'Carbone (kg CO2e)',
};
export const outputLabel = (k: string) => OUTPUT_LABEL[k] ?? k;

export const COMPONENT_FIELDS: { key: 'fixed' | 'perKg' | 'perItem' | 'perParcel' | 'perKm' | 'perKgKm' | 'percentOfValue' | 'min' | 'max'; label: string; hint: string }[] = [
  { key: 'fixed', label: 'Fixe', hint: 'Montant fixe' },
  { key: 'perKg', label: 'Par kg', hint: '× poids taxable' },
  { key: 'perItem', label: 'Par article', hint: "× nombre d'articles" },
  { key: 'perParcel', label: 'Par colis', hint: '× nombre de colis' },
  { key: 'perKm', label: 'Par km', hint: '× distance' },
  { key: 'perKgKm', label: 'Par kg·km', hint: '× poids réel × distance' },
  { key: 'percentOfValue', label: '% de la valeur', hint: 'Montant de commande (ORDER) ou valeur des marchandises' },
  { key: 'min', label: 'Minimum', hint: 'Plancher appliqué au résultat' },
  { key: 'max', label: 'Maximum', hint: 'Plafond appliqué au résultat' },
];

export const METRIC_LABEL: Record<string, string> = {
  deliveryHours: 'Délai de livraison (h)',
  deliveryTime: 'Délai de livraison (h)',
  packages: 'Nombre de colis',
  legs: 'Nombre de legs',
  sources: 'Nombre de sources',
  cost: 'Coût transporteur',
  price: 'Prix client',
  carbonKg: 'Carbone (kg CO2e)',
  distanceKm: 'Distance (km)',
};
export const metricLabel = (k: string) => METRIC_LABEL[k] ?? k;

export const SELECTION_LABEL: Record<string, string> = {
  WEIGHTED: 'Somme pondérée',
  LEXICOGRAPHIC: 'Par priorité',
};

export const ADDITIONAL_KIND_LABEL: Record<string, string> = {
  DELIVERY: 'Livraison',
  INSTALLATION: 'Installation',
  ASSEMBLY: 'Montage',
  TAKE_BACK: 'Reprise',
  APPOINTMENT: 'Rendez-vous',
  OTHER: 'Autre',
};

export const OPERATION_KIND_LABEL: Record<string, string> = {
  PAYMENT: 'Paiement',
  VALIDATION: 'Validation de commande',
  PREPARATION: 'Préparation',
  PACKING: 'Emballage',
  RECEPTION: 'Réception',
};

/** Default name shown when an operation has no name. */
export const OPERATION_DEFAULT_NAME: Record<string, string> = {
  PAYMENT: 'Autorisation de paiement',
  VALIDATION: 'Validation de commande',
  PREPARATION: 'Préparation',
  PACKING: 'Emballage',
  RECEPTION: 'Réception',
};

export const OPERATION_KIND_HINT: Record<string, string> = {
  PAYMENT: 'Avant la préparation, en temps écoulé (24 h/24) : autorisation du paiement.',
  VALIDATION: 'Avant la préparation, en temps écoulé : contrôle de fraude, libération de la commande.',
  PREPARATION: 'Remplace le temps de préparation des points de stock, en heures ouvrées.',
  PACKING: "S'ajoute au temps de préparation, en heures ouvrées.",
  RECEPTION: 'Après la livraison, en temps écoulé : décale le créneau (ex. réception en point relais ou en magasin).',
};

/** "15 min", "1 h", "1 h 30". */
export function fmtMinutes(m: number): string {
  if (!m) return '0 min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

const CRITERION_MIN: Record<string, string> = {
  deliveryHours: 'Le plus rapide',
  deliveryTime: 'Le plus rapide',
  cost: 'Le moins cher',
  price: 'Le prix client le plus bas',
  carbonKg: 'Le moins émetteur',
  packages: 'Le moins de colis',
  legs: "Le moins d'étapes",
  sources: 'Le moins de sources',
  distanceKm: 'Le plus proche',
};

/** Short wording of a criterion: "Le plus rapide", "Le moins cher"… */
export function criterionLabel(c: { metric: string; direction?: string }): string {
  if (c.direction === 'MAX') return `${metricLabel(c.metric)} max`;
  return CRITERION_MIN[c.metric] ?? metricLabel(c.metric);
}
