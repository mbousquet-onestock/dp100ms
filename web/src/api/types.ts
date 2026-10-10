// TypeScript mirror of the Go JSON contract (pkg/model, pkg/api, pkg/bench).
// TimeOfDay values are "HH:MM" strings. Dates are RFC 3339 strings.

export type TimeOfDay = string;
export type ISODate = string;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
}

/** 1 = Monday … 7 = Sunday */
export interface Calendar {
  workingDays: number[];
  honorHolidays: boolean;
  closedDates?: string[];
}

export type StockPointType = 'STORE' | 'WAREHOUSE' | 'LAST_MILE_HUB';
export const STOCK_POINT_TYPES: StockPointType[] = ['STORE', 'WAREHOUSE', 'LAST_MILE_HUB'];

export interface Address {
  line1: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface StockPoint {
  id: string;
  name: string;
  type: StockPointType;
  address: Address;
  lat: number;
  lon: number;
  timezone: string;
  openingTime: TimeOfDay;
  closingTime: TimeOfDay;
  prepCalendar: Calendar;
  prepTimeMinutes: number;
  cutoff: TimeOfDay;
  dailyCapacity: number;
  safetyStock: number;
  allowedModes: string[];
  prepCostPerParcel: number;
  active: boolean;
}

export interface Carrier {
  id: string;
  name: string;
  active: boolean;
}

export type ServiceKind =
  | 'STANDARD'
  | 'EXPRESS'
  | 'SAME_DAY'
  | 'HOME'
  | 'RELAY'
  | 'STORE_DELIVERY'
  | 'LAST_MILE'
  | 'LINEHAUL'
  | 'SHUTTLE';
export const SERVICE_KINDS: ServiceKind[] = ['STANDARD', 'EXPRESS', 'SAME_DAY', 'HOME', 'RELAY', 'STORE_DELIVERY', 'LAST_MILE', 'LINEHAUL', 'SHUTTLE'];

export interface CarrierService {
  id: string;
  carrierId: string;
  name: string;
  kind: ServiceKind;
  modes: string[];
  coverage: string[];
  excludedCoverage?: string[];
  servedPostalCodes?: string[];
  transitDays: number;
  transitMinutes: number;
  pickupCalendar: Calendar;
  deliveryCalendar: Calendar;
  cutoff: TimeOfDay;
  windowStart: TimeOfDay;
  windowEnd: TimeOfDay;
  maxWeightKg: number;
  maxVolumeL: number;
  maxItems: number;
  dailyCapacity: number;
  baseCost: number;
  costPerKg: number;
  active: boolean;
}

export type HubKind = 'CONSOLIDATION' | 'LAST_MILE';

export interface Unavailability {
  from: ISODate;
  to: ISODate;
  reason?: string;
}

export interface Hub {
  id: string;
  name: string;
  kind: HubKind;
  stockPointId?: string;
  postalCode: string;
  city: string;
  lat: number;
  lon: number;
  calendar: Calendar;
  openingTime: TimeOfDay;
  closingTime: TimeOfDay;
  sortingMinutes: number;
  consolidationEnabled: boolean;
  consolidationMinutes: number;
  maxConsolidationWaitHours: number;
  consolidationCost: number;
  unavailability?: Unavailability[];
  active: boolean;
}

export const CUSTOMER_NODE = 'CUSTOMER';

export interface Leg {
  id: string;
  from: string;
  to: string;
  carrierId: string;
  serviceId: string;
  destinationZones?: string[];
  departures: TimeOfDay[];
  cutoffMinutesBefore: number;
  calendar?: Calendar;
  transitMinutes?: number;
  extraCost: number;
  maxWeightKg?: number;
  modes?: string[];
  active: boolean;
}

export interface Route {
  id: string;
  name: string;
  legIds: string[];
  modes?: string[];
  description?: string;
  active: boolean;
}

export interface DeliveryMode {
  id: string;
  name: string;
  description?: string;
  maxLegs: number;
  maxSources: number;
  allowConsolidation: boolean;
  allowSplit: boolean;
  maxDeliveryDays: number;
  price: number;
  active: boolean;
}

export interface SKU {
  sku: string;
  name: string;
  category: string;
  weightKg: number;
  volumeL: number;
}

export interface StockLine {
  stockPointId: string;
  sku: string;
  physical: number;
  reserved: number;
  available: number;
  promisable: number;
  listed: boolean;
}

export interface PointSummary {
  lines: number;
  listed: number;
  availableSkus: number;
  outOfStockSkus: number;
  totalUnits: number;
  reservedUnits: number;
}

export interface Connections {
  outgoing: Leg[];
  incoming: Leg[];
}

export interface ScoringWeights {
  deliveryTime: number;
  packages: number;
  cost: number;
  legs: number;
  sources: number;
}

export interface EngineSettings {
  weights: ScoringWeights;
  beamWidth: number;
  maxAllocations: number;
  maxLegs: number;
  maxHubsPerPlan: number;
  timezone: string;
}

// ---------------------------------------------------------------------------
// Promise

export interface Destination {
  country: string;
  postalCode: string;
}

export interface BasketItem {
  sku: string;
  quantity: number;
}

export interface PackageConstraints {
  maxPackages?: number;
  maxWeightKg?: number;
  maxItems?: number;
  forbidConsolidation?: boolean;
  maxSources?: number;
}

export interface PromiseRequest {
  destination: Destination;
  orderDate: ISODate;
  items: BasketItem[];
  deliveryModes?: string[];
  maxOptions?: number;
  constraints?: PackageConstraints;
  weights?: ScoringWeights;
  debug?: boolean;
}

export interface TimeWindow {
  from: ISODate;
  to: ISODate;
}

export interface LegResult {
  legId: string;
  from: string;
  to: string;
  carrier: string;
  carrierName: string;
  service: string;
  serviceKind: ServiceKind;
  estimatedDeparture: ISODate;
  estimatedArrival: ISODate;
  cost: number;
}

export interface PackageResult {
  packageId: string;
  items: BasketItem[];
  sourceStockPoints: string[];
  weightKg: number;
  volumeL: number;
  route: LegResult[];
  hubs: string[];
  consolidationId?: string;
  estimatedDelivery: TimeWindow;
}

export interface Allocation {
  stockPointId: string;
  sku: string;
  quantity: number;
}

export interface PreparationGroup {
  id: string;
  stockPointId: string;
  items: BasketItem[];
  readyAt: ISODate;
  parcels: number;
}

export interface Shipment {
  id: string;
  packageId: string;
  kind: 'DIRECT' | 'INBOUND' | 'OUTBOUND' | string;
  origin: string;
  destination: string;
  items: BasketItem[];
  legs: LegResult[];
}

export interface ConsolidationResult {
  id: string;
  hubId: string;
  hubName: string;
  inboundShipments: string[];
  lastArrival: ISODate;
  readyAt: ISODate;
  outboundPackages: string[];
  cost: number;
}

export interface TimelineEvent {
  at: ISODate;
  type: 'ORDER' | 'PREPARATION_READY' | 'DEPARTURE' | 'ARRIVAL' | 'CONSOLIDATION_READY' | 'DELIVERY' | string;
  node: string;
  packageId?: string;
  description: string;
}

export interface ScoreBreakdown {
  deliveryHours: number;
  packages: number;
  cost: number;
  legs: number;
  sources: number;
}

export type Strategy = 'SINGLE_SOURCE' | 'MULTI_SOURCE_DIRECT' | 'CONSOLIDATED';

export interface PromiseOption {
  id: string;
  deliveryMode: string;
  strategy: Strategy | string;
  estimatedDelivery: TimeWindow;
  totalPackages: number;
  packagesBeforeConsolidation: number;
  totalCost: number;
  currency: string;
  packages: PackageResult[];
  allocations: Allocation[];
  preparationGroups: PreparationGroup[];
  shipments: Shipment[];
  consolidations: ConsolidationResult[];
  timeline: TimelineEvent[];
  criteria: ScoreBreakdown;
  score: number;
}

export interface EngineStats {
  candidateStockPoints: number;
  allocations: number;
  plansEvaluated: number;
  pathsConsidered: number;
  routeCacheHit: boolean;
  stockVersion: number;
  configVersion: number;
  computeMicros: number;
}

export interface Unfulfillable {
  deliveryMode: string;
  reason: string;
  code: string;
}

export interface PromiseResponse {
  requestId: string;
  options: PromiseOption[];
  unavailable: Unfulfillable[];
  calculationTimeMs: number;
  stats: EngineStats;
}

export interface NodeSummary {
  id: string;
  name: string;
  kind: string;
  city: string;
  lat: number;
  lon: number;
}

export interface SkuStock {
  sku: string;
  requested: number;
  totalPromisable: number;
  pointsWithStock: number;
}

export interface SimulationResponse extends PromiseResponse {
  request: PromiseRequest;
  nodes: Record<string, NodeSummary>;
  stock: SkuStock[] | null;
  serverTimeMs: number;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  request: PromiseRequest;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------
// Network

export interface GraphNode {
  id: string;
  name: string;
  kind: StockPointType | 'HUB';
  city: string;
  lat: number;
  lon: number;
  active: boolean;
  isHub: boolean;
  consolidation: boolean;
}

export interface NetworkGraph {
  nodes: GraphNode[];
  legs: Leg[];
  routes: Route[];
}

export interface CompiledPath {
  origin: string;
  legs: string[];
  nodes: string[];
  carriers: string[];
  hubs: string[];
  routeId?: string;
}

export interface CompiledRoutes {
  department: string;
  mode: string;
  count: number;
  paths: CompiledPath[];
}

export interface Holiday {
  date: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Metrics & dashboard

export interface Counts {
  stockPoints: number;
  stockPointsByType: Record<string, number>;
  skus: number;
  stockLines: number;
  carriers: number;
  services: number;
  hubs: number;
  legs: number;
  routes: number;
  deliveryModes: number;
  scenarios: number;
  configVersion: number;
  stockVersion: number;
}

export interface Snapshot {
  requests: number;
  errors: number;
  errorRate: number;
  window: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  rps1m: number;
  rpsPeak: number;
  uptimeSec: number;
}

export interface SystemInfo {
  goVersion: string;
  numCpu: number;
  gomaxprocs: number;
  goroutines: number;
  heapAllocMb: number;
  sysMb: number;
  numGc: number;
  cpuSeconds: number;
  os: string;
  arch: string;
}

export interface Dashboard {
  counts: Counts;
  promiseLatency: Snapshot;
  apiLatency: Snapshot;
  routeCacheHitRate: number;
  system: SystemInfo;
  lastBenchmark: BenchRun | null;
  seed: number;
  platform: string;
}

export interface Health {
  status: string;
  seed: number;
  uptimeSec: number;
  platform: string;
  persistence: boolean;
  persistError: string;
  stockLines: number;
}

// ---------------------------------------------------------------------------
// Benchmarks

export interface BasketProfile {
  count: number;
  seed: number;
  skusMin: number;
  skusMax: number;
  qtyMin: number;
  qtyMax: number;
  postalCodes: string[] | null;
  modes: string[] | null;
  pctMono: number;
  pctMulti: number;
  pctMultiSource: number;
  pctConsolidation: number;
  orderDate?: ISODate;
  spreadOrderDates: boolean;
}

export interface RunConfig {
  name: string;
  profile?: string;
  vus: number;
  durationSec: number;
  rateRps: number;
  target: 'inprocess' | 'http' | '';
  baseUrl?: string;
  baskets: BasketProfile;
}

export interface LatencyStats {
  requests: number;
  errors: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
}

export interface BenchSummary extends LatencyStats {
  errorRate: number;
  rps: number;
  durationSec: number;
  cpuAvgPct: number;
  cpuPeakPct: number;
  memPeakMb: number;
  cacheHitRate: number;
  distinctBaskets: number;
  avgComputeMs: number;
  byCategory: Record<string, LatencyStats>;
  droppedIterations: number;
  statusCodes: Record<string, number>;
}

export interface BenchPoint {
  t: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errors: number;
  cpuPct: number;
  heapMb: number;
}

export interface BenchEnvironment extends SystemInfo {
  hostname: string;
  platform: string;
}

export type RunStatus = 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';

export interface BenchRun {
  id: string;
  source: string;
  status: RunStatus;
  config: RunConfig;
  startedAt: ISODate;
  finishedAt?: ISODate;
  summary?: BenchSummary;
  series?: BenchPoint[];
  environment: BenchEnvironment;
  error?: string;
}
