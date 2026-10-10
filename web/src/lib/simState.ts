import type { PromiseRequest, ScoringWeights } from '../api/types';
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
}

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
