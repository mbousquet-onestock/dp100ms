import type { AlternativesSort, Criterion, PromiseRequest, ScoringWeights, Selection } from '../api/types';
import { fromLocalInput, toLocalInput } from './format';

export interface SimForm {
  items: { sku: string; quantity: number }[];
  postalCode: string;
  orderDate: string; // datetime-local, Paris time
  modes: string[];
  maxOptions: number;
  useConstraints: boolean;
  maxPackages: number;
  maxWeightKg: number;
  forbidConsolidation: boolean;
  maxSources: number;
  useWeights: boolean;
  weights: ScoringWeights;
  stockViewId: string;
  additionalServices: string[];
  useOrderAmount: boolean;
  orderAmount: number;
  useAlternatives: boolean;
  altLimit: number;
  altSort: AlternativesSort;
  useCriteria: boolean;
  criteria: Criterion[];
  selection: Selection;
}

export const DEFAULT_CRITERIA: Criterion[] = [
  { metric: 'deliveryHours', weight: 0.5, priority: 1 },
  { metric: 'price', weight: 0.3, priority: 2 },
  { metric: 'carbonKg', weight: 0.2, priority: 3 },
];

export const DEFAULT_WEIGHTS: ScoringWeights = { deliveryTime: 0.45, packages: 0.2, cost: 0.2, legs: 0.05, sources: 0.1 };

export const defaultSimForm = (): SimForm => ({
  items: [
    { sku: 'SKU-00002', quantity: 2 },
    { sku: 'SKU-00007', quantity: 1 },
  ],
  postalCode: '69003',
  orderDate: '2026-10-12T10:00',
  modes: [],
  maxOptions: 6,
  useConstraints: false,
  maxPackages: 0,
  maxWeightKg: 0,
  forbidConsolidation: false,
  maxSources: 0,
  useWeights: false,
  weights: { ...DEFAULT_WEIGHTS },
  stockViewId: '',
  additionalServices: [],
  useOrderAmount: false,
  orderAmount: 0,
  useAlternatives: false,
  altLimit: 5,
  altSort: 'deliveryHours',
  useCriteria: false,
  criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
  selection: 'WEIGHTED',
});

export function toRequest(f: SimForm): PromiseRequest {
  const req: PromiseRequest = {
    destination: { country: 'FR', postalCode: f.postalCode.trim() },
    orderDate: fromLocalInput(f.orderDate),
    items: f.items.map((i) => ({ sku: i.sku.trim(), quantity: i.quantity })),
  };
  if (f.modes.length) req.deliveryModes = f.modes;
  if (f.maxOptions > 0) req.maxOptions = f.maxOptions;
  if (f.useConstraints) {
    const c: NonNullable<PromiseRequest['constraints']> = {};
    if (f.maxPackages > 0) c.maxPackages = f.maxPackages;
    if (f.maxWeightKg > 0) c.maxWeightKg = f.maxWeightKg;
    if (f.forbidConsolidation) c.forbidConsolidation = true;
    if (f.maxSources > 0) c.maxSources = f.maxSources;
    if (Object.keys(c).length) req.constraints = c;
  }
  if (f.useWeights) req.weights = f.weights;
  if (f.stockViewId) req.stockViewId = f.stockViewId;
  if (f.additionalServices.length) req.additionalServices = f.additionalServices;
  if (f.useOrderAmount) req.orderAmount = f.orderAmount;
  if (f.useAlternatives) req.alternatives = { limit: f.altLimit || 5, sortBy: f.altSort };
  if (f.useCriteria && f.criteria.length) {
    req.criteria = f.criteria.map((c) => {
      const out: Criterion = { metric: c.metric, weight: c.weight, priority: c.priority };
      if (c.direction && c.direction !== 'MIN') out.direction = c.direction;
      if (c.max !== undefined) out.max = c.max;
      if (c.tolerance) out.tolerance = c.tolerance;
      return out;
    });
    req.selection = f.selection;
  }
  return req;
}

export function fromRequest(r: PromiseRequest, base: SimForm = defaultSimForm()): SimForm {
  return {
    ...base,
    items: r.items.map((i) => ({ ...i })),
    postalCode: r.destination?.postalCode ?? '',
    orderDate: toLocalInput(r.orderDate) || base.orderDate,
    modes: r.deliveryModes ?? [],
    maxOptions: r.maxOptions ?? 6,
    useConstraints: !!r.constraints,
    maxPackages: r.constraints?.maxPackages ?? 0,
    maxWeightKg: r.constraints?.maxWeightKg ?? 0,
    forbidConsolidation: r.constraints?.forbidConsolidation ?? false,
    maxSources: r.constraints?.maxSources ?? 0,
    useWeights: !!r.weights,
    weights: r.weights ?? { ...DEFAULT_WEIGHTS },
    stockViewId: r.stockViewId ?? '',
    additionalServices: r.additionalServices ?? [],
    useOrderAmount: r.orderAmount !== undefined,
    orderAmount: r.orderAmount ?? base.orderAmount,
    useAlternatives: !!r.alternatives,
    altLimit: r.alternatives?.limit ?? base.altLimit,
    altSort: r.alternatives?.sortBy ?? base.altSort,
    useCriteria: !!r.criteria?.length,
    criteria: r.criteria?.length ? r.criteria : base.criteria,
    selection: r.selection ?? base.selection,
  };
}

const KEY = 'dp.simulator.form';
export function loadSimForm(): SimForm {
  try {
    const s = sessionStorage.getItem(KEY);
    if (s) return { ...defaultSimForm(), ...JSON.parse(s) };
  } catch {
    /* ignore */
  }
  return defaultSimForm();
}
export function saveSimForm(f: SimForm) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}
