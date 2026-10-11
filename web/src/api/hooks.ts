import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api, tokenStore } from './client';
import type {
  AdditionalService,
  BenchRun,
  DatabaseStatus,
  PricingFields,
  QuoteRequest,
  QuoteResponse,
  RateCard,
  SchedulePreview,
  SchedulePreviewRequest,
  StockView,
  StockViewPreview,
  Carrier,
  CarrierService,
  CarrierRoute,
  Zone,
  CompiledRoutes,
  Connections,
  Dashboard,
  DeliveryMode,
  EngineSettings,
  Health,
  Holiday,
  Hub,
  Leg,
  NetworkGraph,
  Page,
  PointSummary,
  PromiseRequest,
  Route,
  RunConfig,
  Scenario,
  SimulationResponse,
  SKU,
  StockLine,
  StockPoint,
} from './types';

export function useAdminToken(): [string, (v: string) => void] {
  const token = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, tokenStore.get);
  return [token, tokenStore.set];
}

export const qk = {
  health: ['health'] as const,
  auth: (t: string) => ['auth', t] as const,
  dashboard: ['dashboard'] as const,
  stockPoints: (p: object) => ['stock-points', p] as const,
  stockPoint: (id: string) => ['stock-points', 'one', id] as const,
  summary: (id: string) => ['stock-points', 'summary', id] as const,
  stock: (id: string, p: object) => ['stock-points', 'stock', id, p] as const,
  connections: (id: string) => ['stock-points', 'connections', id] as const,
  carriers: ['carriers'] as const,
  services: (carrierId?: string) => ['services', carrierId ?? ''] as const,
  hubs: ['hubs'] as const,
  modes: ['delivery-modes'] as const,
  graph: ['network', 'graph'] as const,
  compiled: (p: object) => ['network', 'routes', p] as const,
  skus: (q: string) => ['skus', q] as const,
  scenarios: ['scenarios'] as const,
  settings: ['settings'] as const,
  holidays: (y: number) => ['holidays', y] as const,
  benchmarks: ['benchmarks'] as const,
  benchmark: (id: string) => ['benchmarks', id] as const,
  presets: ['benchmarks', 'presets'] as const,
  openapi: ['openapi'] as const,
  rateCards: (p: object) => ['rate-cards', p] as const,
  additionalServices: ['additional-services'] as const,
  stockViews: ['stock-views'] as const,
  stockViewPreview: (id: string) => ['stock-views', 'preview', id] as const,
  pricingFields: ['pricing', 'fields'] as const,
  skuPage: (p: object) => ['skus', 'page', p] as const,
  database: (t: string) => ['admin', 'database', t] as const,
  zones: ['zones'] as const,
  carrierRoutes: (p: object) => ['carrier-routes', p] as const,
  carrierRoute: (id: string) => ['carrier-routes', 'one', id] as const,
};

// ---------------------------------------------------------------------------
// Queries

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: () => api.get<Health>('/health'), refetchInterval: 30000 });

export function useAuthCheck(token: string) {
  return useQuery({
    queryKey: qk.auth(token),
    queryFn: async () => {
      const res = await fetch('/api/v1/auth/check', { headers: { Authorization: `Bearer ${token}` } });
      return res.ok;
    },
    staleTime: 60000,
    retry: false,
  });
}

export const useDashboard = () =>
  useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 5000 });

export interface StockPointQuery {
  type?: string;
  q?: string;
  page: number;
  pageSize: number;
}
export const useStockPoints = (p: StockPointQuery) =>
  useQuery({
    queryKey: qk.stockPoints(p),
    queryFn: () => api.get<Page<StockPoint>>('/stock-points', { ...p }),
    placeholderData: keepPreviousData,
  });

export const useAllStockPoints = () =>
  useQuery({ queryKey: qk.stockPoints({ all: true }), queryFn: () => api.get<Page<StockPoint>>('/stock-points', { pageSize: 1000 }) });

export const useStockPoint = (id: string) =>
  useQuery({ queryKey: qk.stockPoint(id), queryFn: () => api.get<StockPoint>(`/stock-points/${encodeURIComponent(id)}`), enabled: !!id });

export const usePointSummary = (id: string) =>
  useQuery({ queryKey: qk.summary(id), queryFn: () => api.get<PointSummary>(`/stock-points/${encodeURIComponent(id)}/summary`), enabled: !!id });

export const usePointStock = (id: string, p: { sku?: string; onlyAvailable?: boolean; page: number; pageSize: number }) =>
  useQuery({
    queryKey: qk.stock(id, p),
    queryFn: () => api.get<Page<StockLine>>(`/stock-points/${encodeURIComponent(id)}/stock`, { ...p, onlyAvailable: p.onlyAvailable ? 'true' : undefined }),
    placeholderData: keepPreviousData,
    enabled: !!id,
  });

export const useConnections = (id: string) =>
  useQuery({ queryKey: qk.connections(id), queryFn: () => api.get<Connections>(`/stock-points/${encodeURIComponent(id)}/connections`), enabled: !!id });

export const useCarriers = () => useQuery({ queryKey: qk.carriers, queryFn: () => api.get<Page<Carrier>>('/carriers', { pageSize: 1000 }) });

export const useServices = (carrierId?: string) =>
  useQuery({ queryKey: qk.services(carrierId), queryFn: () => api.get<Page<CarrierService>>('/services', { pageSize: 1000, carrierId }) });

export const useZones = () => useQuery({ queryKey: qk.zones, queryFn: () => api.get<Page<Zone>>('/zones', { pageSize: 1000 }) });

export interface CarrierRouteQuery {
  carrierId?: string;
  serviceId?: string;
  originZoneId?: string;
  destinationZoneId?: string;
  q?: string;
}
export const useCarrierRoutes = (p: CarrierRouteQuery = {}) =>
  useQuery({
    queryKey: qk.carrierRoutes(p),
    queryFn: () => api.get<Page<CarrierRoute>>('/carrier-routes', { pageSize: 1000, ...p }),
    placeholderData: keepPreviousData,
  });

export const useCarrierRoute = (id: string | null) =>
  useQuery({ queryKey: qk.carrierRoute(id ?? ''), queryFn: () => api.get<CarrierRoute>(`/carrier-routes/${encodeURIComponent(id!)}`), enabled: !!id });

export const useHubs = () => useQuery({ queryKey: qk.hubs, queryFn: () => api.get<Page<Hub>>('/hubs', { pageSize: 1000 }) });

export const useModes = () => useQuery({ queryKey: qk.modes, queryFn: () => api.get<Page<DeliveryMode>>('/delivery-modes', { pageSize: 1000 }) });

export const useGraph = () => useQuery({ queryKey: qk.graph, queryFn: () => api.get<NetworkGraph>('/network/graph') });

export const useCompiledRoutes = (p: { postalCode: string; mode: string; origin?: string } | null) =>
  useQuery({
    queryKey: qk.compiled(p ?? {}),
    queryFn: () => api.get<CompiledRoutes>('/network/routes', { ...p! }),
    enabled: !!p,
    retry: false,
  });

export const useSkuSearch = (q: string) =>
  useQuery({
    queryKey: qk.skus(q),
    queryFn: ({ signal }) => api.get<Page<SKU>>('/skus', { q, pageSize: 8 }, signal),
    enabled: q.length >= 2,
    staleTime: 60000,
  });

export const useScenarios = () => useQuery({ queryKey: qk.scenarios, queryFn: () => api.get<Page<Scenario>>('/scenarios', { pageSize: 1000 }) });

export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api.get<EngineSettings>('/settings') });

export const useHolidays = (year: number) =>
  useQuery({ queryKey: qk.holidays(year), queryFn: () => api.get<{ year: number; holidays: Holiday[] }>('/calendar/holidays', { year }) });

export const useBenchmarks = (poll = false) =>
  useQuery({
    queryKey: qk.benchmarks,
    queryFn: () => api.get<{ items: BenchRun[]; total: number }>('/benchmarks'),
    refetchInterval: poll ? 2000 : false,
  });

/** Polls every second while the run is in progress. */
export const useBenchmark = (id: string | null) =>
  useQuery({
    queryKey: qk.benchmark(id ?? ''),
    queryFn: () => api.get<BenchRun>(`/benchmarks/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'running' || s === 'stopping' ? 1000 : false;
    },
  });

export const usePresets = () => useQuery({ queryKey: qk.presets, queryFn: () => api.get<RunConfig[]>('/benchmarks/presets'), staleTime: Infinity });

// ---------------------------------------------------------------------------
// Pricing

export const usePricingFields = () =>
  useQuery({ queryKey: qk.pricingFields, queryFn: () => api.get<PricingFields>('/pricing/fields'), staleTime: 60000 });

export const useRateCards = (p: { scope?: string; carrierId?: string; q?: string } = {}) =>
  useQuery({
    queryKey: qk.rateCards(p),
    queryFn: () => api.get<Page<RateCard>>('/rate-cards', { pageSize: 1000, ...p }),
    placeholderData: keepPreviousData,
  });

export const useAdditionalServices = () =>
  useQuery({ queryKey: qk.additionalServices, queryFn: () => api.get<Page<AdditionalService>>('/additional-services', { pageSize: 1000 }) });

export const useStockViews = () => useQuery({ queryKey: qk.stockViews, queryFn: () => api.get<Page<StockView>>('/stock-views', { pageSize: 1000 }) });

export const useStockViewPreview = (id: string | null) =>
  useQuery({
    queryKey: qk.stockViewPreview(id ?? ''),
    queryFn: () => api.get<StockViewPreview>(`/stock-views/${encodeURIComponent(id!)}/preview`),
    enabled: !!id,
    retry: false,
  });

export const useSkuPage = (p: { q?: string; page: number; pageSize: number }) =>
  useQuery({ queryKey: qk.skuPage(p), queryFn: () => api.get<Page<SKU>>('/skus', { ...p }), placeholderData: keepPreviousData });

/** Quote a saved card (id) or an inline card (body.card). */
export const useQuote = () =>
  useMutation({
    mutationFn: ({ id, body }: { id?: string; body: QuoteRequest }) =>
      api.post<QuoteResponse>(id ? `/rate-cards/${encodeURIComponent(id)}/quote` : '/rate-cards/quote', body, false),
  });

/** Preview the schedule layers applied to a service / postal code / ready time. */
export const useSchedulePreview = () =>
  useMutation({
    mutationFn: ({ carrierId, body }: { carrierId: string; body: SchedulePreviewRequest }) =>
      api.post<SchedulePreview>(`/carriers/${encodeURIComponent(carrierId)}/schedule-preview`, body, false),
  });

export const useDatabaseStatus = (token: string) =>
  useQuery({ queryKey: qk.database(token), queryFn: () => api.get<DatabaseStatus>('/admin/database', undefined, undefined, true), retry: false });

export function useSkuUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SKU) => api.put<SKU>(`/skus/${encodeURIComponent(v.sku)}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skus'] });
      qc.invalidateQueries({ queryKey: qk.pricingFields });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations

/** Generic CRUD mutations for a collection under /api/v1/{path}. */
export function useCrud<T extends { id: string }>(path: string, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  const onSuccess = () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] }));
  const create = useMutation({ mutationFn: (v: T) => api.post<T>(`/${path}`, v), onSuccess });
  const update = useMutation({ mutationFn: (v: T) => api.put<T>(`/${path}/${encodeURIComponent(v.id)}`, v), onSuccess });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/${path}/${encodeURIComponent(id)}`), onSuccess });
  return { create, update, remove };
}

export const useSimulate = () => useMutation({ mutationFn: (req: PromiseRequest) => timed(() => api.post<SimulationResponse>('/simulations', req, false)) });

export const useRunScenario = () =>
  useMutation({ mutationFn: (id: string) => timed(() => api.post<SimulationResponse>(`/scenarios/${encodeURIComponent(id)}/run`, undefined, false)) });

export interface Timed<T> {
  data: T;
  roundTripMs: number;
}
async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const t0 = performance.now();
  const data = await fn();
  return { data, roundTripMs: performance.now() - t0 };
}

export const useRoutesCrud = () => useCrud<Route>('routes', [qk.graph, ['routes']]);
export const useLegsCrud = () => useCrud<Leg>('legs', [qk.graph]);
export const useZonesCrud = () => useCrud<Zone>('zones', [qk.zones, ['carrier-routes']]);
export const useCarrierRoutesCrud = () => useCrud<CarrierRoute>('carrier-routes', [['carrier-routes']]);
