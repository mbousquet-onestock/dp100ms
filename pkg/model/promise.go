package model

import "time"

type Destination struct {
	Country    string `json:"country"`
	PostalCode string `json:"postalCode"`
}

type BasketItem struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

type PackageConstraints struct {
	MaxPackages         int     `json:"maxPackages,omitempty"`
	MaxWeightKg         float64 `json:"maxWeightKg,omitempty"`
	MaxItems            int     `json:"maxItems,omitempty"`
	ForbidConsolidation bool    `json:"forbidConsolidation,omitempty"`
	MaxSources          int     `json:"maxSources,omitempty"`
}

// PromiseRequest is the body of POST /api/v1/delivery-promises.
type PromiseRequest struct {
	Destination   Destination         `json:"destination"`
	OrderDate     time.Time           `json:"orderDate"`
	Items         []BasketItem        `json:"items"`
	DeliveryModes []string            `json:"deliveryModes,omitempty"`
	MaxOptions    int                 `json:"maxOptions,omitempty"`
	Constraints   *PackageConstraints `json:"constraints,omitempty"`
	Weights       *ScoringWeights     `json:"weights,omitempty"`
	// StockViewID overrides the stock view of the delivery modes.
	StockViewID string `json:"stockViewId,omitempty"`
	// AdditionalServices requested by the customer (ids), e.g. INSTALLATION.
	AdditionalServices []string `json:"additionalServices,omitempty"`
	// OrderAmount overrides the order amount (default: Σ article price ×
	// quantity), used by franco and percentage rules.
	OrderAmount *float64 `json:"orderAmount,omitempty"`
	// Alternatives asks, for every package, the other stock points able to
	// ship it, sorted (deliveryHours, cost, price, carbonKg, distanceKm).
	Alternatives *AlternativesRequest `json:"alternatives,omitempty"`
	// Criteria override the delivery mode criteria for this request.
	Criteria  []Criterion `json:"criteria,omitempty"`
	Selection string      `json:"selection,omitempty"`
	// Debug adds the rejected candidates and engine counters.
	Debug bool `json:"debug,omitempty"`
}

type AlternativesRequest struct {
	Limit  int    `json:"limit,omitempty"`  // default 5, max 20
	SortBy string `json:"sortBy,omitempty"` // default deliveryHours
}

type TimeWindow struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type LegResult struct {
	LegID              string             `json:"legId"`
	From               string             `json:"from"`
	To                 string             `json:"to"`
	Carrier            string             `json:"carrier"`
	CarrierName        string             `json:"carrierName"`
	Service            string             `json:"service"`
	ServiceKind        ServiceKind        `json:"serviceKind"`
	EstimatedDeparture time.Time          `json:"estimatedDeparture"`
	EstimatedArrival   time.Time          `json:"estimatedArrival"`
	DistanceKm         float64            `json:"distanceKm"`
	Metrics            map[string]float64 `json:"metrics,omitempty"`
	Cost               float64            `json:"cost"`
}

type PackageResult struct {
	PackageID         string       `json:"packageId"`
	Items             []BasketItem `json:"items"`
	SourceStockPoints []string     `json:"sourceStockPoints"`
	WeightKg          float64      `json:"weightKg"`
	VolumeL           float64      `json:"volumeL"`
	Route             []LegResult  `json:"route"`
	Hubs              []string     `json:"hubs"`
	ConsolidationID   string       `json:"consolidationId,omitempty"`
	EstimatedDelivery TimeWindow   `json:"estimatedDelivery"`
	// LeadTimeHours from the order to the end of the delivery window.
	LeadTimeHours float64 `json:"leadTimeHours"`
	DistanceKm    float64 `json:"distanceKm"`
	// Metrics of this parcel (cost, price share, carbonKg, custom outputs).
	Metrics map[string]float64 `json:"metrics"`
	// Alternatives: other stock points able to ship this package.
	Alternatives []PackageAlternative `json:"alternatives,omitempty"`
}

type PackageAlternative struct {
	StockPointID      string             `json:"stockPointId"`
	Name              string             `json:"name"`
	Type              string             `json:"type"`
	City              string             `json:"city"`
	DistanceKm        float64            `json:"distanceKm"`
	EstimatedDelivery TimeWindow         `json:"estimatedDelivery"`
	DeliveryHours     float64            `json:"deliveryHours"`
	Parcels           int                `json:"parcels"`
	Carriers          []string           `json:"carriers"`
	Route             []string           `json:"route"`
	Metrics           map[string]float64 `json:"metrics"`
	Current           bool               `json:"current"`
}

type AdditionalServiceResult struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Kind      string             `json:"kind"`
	Requested bool               `json:"requested"`
	Items     []BasketItem       `json:"items"`
	ExtraDays int                `json:"extraDays"`
	Metrics   map[string]float64 `json:"metrics"`
}

// Allocation is the quantity of one SKU taken from one stock point.
type Allocation struct {
	StockPointID string `json:"stockPointId"`
	SKU          string `json:"sku"`
	Quantity     int    `json:"quantity"`
}

// PreparationGroup is the set of items picked together at one stock point.
type PreparationGroup struct {
	ID           string       `json:"id"`
	StockPointID string       `json:"stockPointId"`
	Items        []BasketItem `json:"items"`
	ReadyAt      time.Time    `json:"readyAt"`
	Parcels      int          `json:"parcels"`
}

// Shipment is a physical parcel moving on one path (before consolidation for
// inbound shipments, or the final delivered parcel).
type Shipment struct {
	ID          string       `json:"id"`
	PackageID   string       `json:"packageId"`
	Kind        string       `json:"kind"` // DIRECT | INBOUND | OUTBOUND
	Origin      string       `json:"origin"`
	Destination string       `json:"destination"`
	Items       []BasketItem `json:"items"`
	Legs        []LegResult  `json:"legs"`
}

type ConsolidationResult struct {
	ID               string    `json:"id"`
	HubID            string    `json:"hubId"`
	HubName          string    `json:"hubName"`
	InboundShipments []string  `json:"inboundShipments"`
	LastArrival      time.Time `json:"lastArrival"`
	ReadyAt          time.Time `json:"readyAt"`
	OutboundPackages []string  `json:"outboundPackages"`
	Cost             float64   `json:"cost"`
}

type TimelineEvent struct {
	At          time.Time `json:"at"`
	Type        string    `json:"type"` // ORDER, PREPARATION_READY, DEPARTURE, ARRIVAL, CONSOLIDATION_READY, DELIVERY
	Node        string    `json:"node"`
	PackageID   string    `json:"packageId,omitempty"`
	Description string    `json:"description"`
}

type ScoreBreakdown struct {
	Price         float64 `json:"price"`
	CarbonKg      float64 `json:"carbonKg"`
	DeliveryHours float64 `json:"deliveryHours"`
	Packages      int     `json:"packages"`
	Cost          float64 `json:"cost"`
	Legs          int     `json:"legs"`
	Sources       int     `json:"sources"`
}

type PromiseOption struct {
	ID                          string                `json:"id"`
	DeliveryMode                string                `json:"deliveryMode"`
	Strategy                    string                `json:"strategy"` // SINGLE_SOURCE | MULTI_SOURCE_DIRECT | CONSOLIDATED
	EstimatedDelivery           TimeWindow            `json:"estimatedDelivery"`
	TotalPackages               int                   `json:"totalPackages"`
	PackagesBeforeConsolidation int                   `json:"packagesBeforeConsolidation"`
	TotalCost                   float64               `json:"totalCost"`
	Currency                    string                `json:"currency"`
	Packages                    []PackageResult       `json:"packages"`
	Allocations                 []Allocation          `json:"allocations"`
	PreparationGroups           []PreparationGroup    `json:"preparationGroups"`
	Shipments                   []Shipment            `json:"shipments"`
	Consolidations              []ConsolidationResult `json:"consolidations"`
	Timeline                    []TimelineEvent       `json:"timeline"`
	Criteria                    ScoreBreakdown        `json:"criteria"`
	// Metrics totals: cost, price (billed to the customer), carbonKg and
	// custom rate card outputs.
	Metrics map[string]float64 `json:"metrics"`
	// AdditionalServices requested (applied) or offered by the final carrier.
	AdditionalServices []AdditionalServiceResult `json:"additionalServices"`
	StockViewID        string                    `json:"stockViewId,omitempty"`
	Score              float64                   `json:"score"`
}

type EngineStats struct {
	CandidateStockPoints int    `json:"candidateStockPoints"`
	Allocations          int    `json:"allocations"`
	PlansEvaluated       int    `json:"plansEvaluated"`
	PathsConsidered      int    `json:"pathsConsidered"`
	HubsPruned           int    `json:"hubsPruned"`
	RouteCacheHit        bool   `json:"routeCacheHit"`
	StockVersion         uint64 `json:"stockVersion"`
	ConfigVersion        uint64 `json:"configVersion"`
	ComputeMicros        int64  `json:"computeMicros"`
}

type Unfulfillable struct {
	DeliveryMode string `json:"deliveryMode"`
	Reason       string `json:"reason"`
	Code         string `json:"code"`
}

type PromiseResponse struct {
	RequestID         string          `json:"requestId"`
	Options           []PromiseOption `json:"options"`
	Unavailable       []Unfulfillable `json:"unavailable"`
	CalculationTimeMs float64         `json:"calculationTimeMs"`
	Stats             EngineStats     `json:"stats"`
}
