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
	// Debug adds the rejected candidates and engine counters.
	Debug bool `json:"debug,omitempty"`
}

type TimeWindow struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type LegResult struct {
	LegID              string      `json:"legId"`
	From               string      `json:"from"`
	To                 string      `json:"to"`
	Carrier            string      `json:"carrier"`
	CarrierName        string      `json:"carrierName"`
	Service            string      `json:"service"`
	ServiceKind        ServiceKind `json:"serviceKind"`
	EstimatedDeparture time.Time   `json:"estimatedDeparture"`
	EstimatedArrival   time.Time   `json:"estimatedArrival"`
	Cost               float64     `json:"cost"`
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
	Score                       float64               `json:"score"`
}

type EngineStats struct {
	CandidateStockPoints int    `json:"candidateStockPoints"`
	Allocations          int    `json:"allocations"`
	PlansEvaluated       int    `json:"plansEvaluated"`
	PathsConsidered      int    `json:"pathsConsidered"`
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
