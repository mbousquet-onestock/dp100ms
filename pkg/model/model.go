// Package model holds the logistic domain entities shared by the store, the
// network compiler, the promise engine and the HTTP API.
package model

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// TimeOfDay is a local wall-clock time expressed in minutes after midnight.
// It is serialised as "HH:MM".
type TimeOfDay int

func (t TimeOfDay) String() string { return fmt.Sprintf("%02d:%02d", int(t)/60, int(t)%60) }

func (t TimeOfDay) MarshalJSON() ([]byte, error) { return json.Marshal(t.String()) }

func (t *TimeOfDay) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		var n int
		if err2 := json.Unmarshal(b, &n); err2 != nil {
			return fmt.Errorf("time of day must be \"HH:MM\"")
		}
		*t = TimeOfDay(n)
		return nil
	}
	v, err := ParseTimeOfDay(s)
	if err != nil {
		return err
	}
	*t = v
	return nil
}

// ParseTimeOfDay parses "HH:MM" (24h).
func ParseTimeOfDay(s string) (TimeOfDay, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid time of day %q, expected HH:MM", s)
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 24 || m < 0 || m > 59 || (h == 24 && m != 0) {
		return 0, fmt.Errorf("invalid time of day %q, expected HH:MM", s)
	}
	return TimeOfDay(h*60 + m), nil
}

// MustTOD is a helper for static data.
func MustTOD(s string) TimeOfDay {
	t, err := ParseTimeOfDay(s)
	if err != nil {
		panic(err)
	}
	return t
}

// Calendar describes on which days an activity (preparation, carrier pickup,
// delivery, hub processing) takes place.
type Calendar struct {
	// WorkingDays uses ISO numbering: 1 = Monday … 7 = Sunday.
	WorkingDays []int `json:"workingDays"`
	// HonorHolidays skips French public holidays.
	HonorHolidays bool `json:"honorHolidays"`
	// ClosedDates are additional closing days (YYYY-MM-DD).
	ClosedDates []string `json:"closedDates,omitempty"`
}

// Mask returns the weekday bitmask (bit time.Weekday).
func (c Calendar) Mask() uint8 {
	var m uint8
	for _, d := range c.WorkingDays {
		m |= 1 << uint(time.Weekday(d%7))
	}
	return m
}

type StockPointType string

const (
	StockPointStore       StockPointType = "STORE"
	StockPointWarehouse   StockPointType = "WAREHOUSE"
	StockPointLastMileHub StockPointType = "LAST_MILE_HUB"
)

func (t StockPointType) Valid() bool {
	return t == StockPointStore || t == StockPointWarehouse || t == StockPointLastMileHub
}

type Address struct {
	Line1      string `json:"line1"`
	PostalCode string `json:"postalCode"`
	City       string `json:"city"`
	Country    string `json:"country"`
}

// StockPoint is a location holding stock that can prepare parcels.
type StockPoint struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	Type            StockPointType `json:"type"`
	Address         Address        `json:"address"`
	Lat             float64        `json:"lat"`
	Lon             float64        `json:"lon"`
	Timezone        string         `json:"timezone"`
	OpeningTime     TimeOfDay      `json:"openingTime"`
	ClosingTime     TimeOfDay      `json:"closingTime"`
	PrepCalendar    Calendar       `json:"prepCalendar"`
	PrepTimeMinutes int            `json:"prepTimeMinutes"`
	// Cutoff is the last order time for a same-day preparation start.
	Cutoff TimeOfDay `json:"cutoff"`
	// DailyCapacity is the number of orders the point can prepare per day.
	DailyCapacity int `json:"dailyCapacity"`
	// SafetyStock units are kept back from the promisable quantity per SKU.
	SafetyStock  int      `json:"safetyStock"`
	AllowedModes []string `json:"allowedModes"`
	// PrepCostPerParcel is the handling cost of one parcel prepared here.
	PrepCostPerParcel float64 `json:"prepCostPerParcel"`
	Active            bool    `json:"active"`
}

// Carrier is a transport company.
type Carrier struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type ServiceKind string

const (
	KindStandard ServiceKind = "STANDARD"
	KindExpress  ServiceKind = "EXPRESS"
	KindSameDay  ServiceKind = "SAME_DAY"
	KindHome     ServiceKind = "HOME"
	KindRelay    ServiceKind = "RELAY"
	KindStore    ServiceKind = "STORE_DELIVERY"
	KindLastMile ServiceKind = "LAST_MILE"
	KindLinehaul ServiceKind = "LINEHAUL"
	KindShuttle  ServiceKind = "SHUTTLE"
)

var ServiceKinds = []ServiceKind{KindStandard, KindExpress, KindSameDay, KindHome, KindRelay, KindStore, KindLastMile, KindLinehaul, KindShuttle}

// CarrierService is a product sold by a carrier.
type CarrierService struct {
	ID        string      `json:"id"`
	CarrierID string      `json:"carrierId"`
	Name      string      `json:"name"`
	Kind      ServiceKind `json:"kind"`
	// Modes are the delivery modes this service can fulfil when it is the
	// final leg towards the customer.
	Modes []string `json:"modes"`
	// Coverage lists French department codes ("33", "75", "20" for Corsica)
	// or "*" for metropolitan France. Excluded departments win.
	Coverage         []string `json:"coverage"`
	ExcludedCoverage []string `json:"excludedCoverage,omitempty"`
	// ServedPostalCodes optionally restricts coverage to explicit codes or
	// prefixes ("750", "69001").
	ServedPostalCodes []string `json:"servedPostalCodes,omitempty"`
	// Final-leg transit in business days of DeliveryCalendar (0 = same day).
	TransitDays int `json:"transitDays"`
	// Line-haul transit in minutes (used when the leg ends at a hub).
	TransitMinutes   int       `json:"transitMinutes"`
	PickupCalendar   Calendar  `json:"pickupCalendar"`
	DeliveryCalendar Calendar  `json:"deliveryCalendar"`
	Cutoff           TimeOfDay `json:"cutoff"`
	WindowStart      TimeOfDay `json:"windowStart"`
	WindowEnd        TimeOfDay `json:"windowEnd"`
	MaxWeightKg      float64   `json:"maxWeightKg"`
	MaxVolumeL       float64   `json:"maxVolumeL"`
	MaxItems         int       `json:"maxItems"`
	DailyCapacity    int       `json:"dailyCapacity"`
	BaseCost         float64   `json:"baseCost"`
	CostPerKg        float64   `json:"costPerKg"`
	// RateCardIDs price every parcel / shipment carried by this service
	// (cost, customer price, carbon or custom outputs). Without a card,
	// BaseCost + CostPerKg × weight is used.
	RateCardIDs []string `json:"rateCardIds,omitempty"`
	// CarbonGramsPerKgKm is the fallback emission factor.
	CarbonGramsPerKgKm float64 `json:"carbonGramsPerKgKm,omitempty"`
	// Restrictions on the articles the service can carry.
	Restrictions []Restriction `json:"restrictions,omitempty"`
	// AdditionalServiceIDs offered when this service delivers the customer.
	AdditionalServiceIDs []string `json:"additionalServiceIds,omitempty"`
	Active               bool     `json:"active"`
}

type HubKind string

const (
	HubConsolidation HubKind = "CONSOLIDATION"
	HubLastMile      HubKind = "LAST_MILE"
)

// Unavailability is a period during which a hub does not process parcels.
type Unavailability struct {
	From   time.Time `json:"from"`
	To     time.Time `json:"to"`
	Reason string    `json:"reason,omitempty"`
}

// Hub is a transit / consolidation node of the network. When StockPointID
// is set the hub is also a stock point and shares its ID.
type Hub struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Kind                 HubKind   `json:"kind"`
	StockPointID         string    `json:"stockPointId,omitempty"`
	PostalCode           string    `json:"postalCode"`
	City                 string    `json:"city"`
	Lat                  float64   `json:"lat"`
	Lon                  float64   `json:"lon"`
	Calendar             Calendar  `json:"calendar"`
	OpeningTime          TimeOfDay `json:"openingTime"`
	ClosingTime          TimeOfDay `json:"closingTime"`
	SortingMinutes       int       `json:"sortingMinutes"`
	ConsolidationEnabled bool      `json:"consolidationEnabled"`
	ConsolidationMinutes int       `json:"consolidationMinutes"`
	// MaxConsolidationWaitHours bounds how long the first component may wait
	// for the last one. 0 = unbounded.
	MaxConsolidationWaitHours int              `json:"maxConsolidationWaitHours"`
	ConsolidationCost         float64          `json:"consolidationCost"`
	Unavailability            []Unavailability `json:"unavailability,omitempty"`
	Active                    bool             `json:"active"`
}

// CustomerNode is the pseudo node ID of the delivery address.
const CustomerNode = "CUSTOMER"

// Leg is a directed transport segment of the network graph.
type Leg struct {
	ID        string `json:"id"`
	From      string `json:"from"`
	To        string `json:"to"` // node ID or CUSTOMER
	CarrierID string `json:"carrierId"`
	ServiceID string `json:"serviceId"`
	// DestinationZones restricts a final leg (To == CUSTOMER) to department
	// codes; empty means the service coverage applies.
	DestinationZones []string `json:"destinationZones,omitempty"`
	// Departures are the scheduled pickup times on calendar days. Parcels
	// must be ready CutoffMinutesBefore each departure.
	Departures          []TimeOfDay `json:"departures"`
	CutoffMinutesBefore int         `json:"cutoffMinutesBefore"`
	// Calendar overrides the service pickup calendar when set.
	Calendar *Calendar `json:"calendar,omitempty"`
	// TransitMinutes overrides the service transit for hub-bound legs.
	TransitMinutes int `json:"transitMinutes,omitempty"`
	// Cost overrides: added to service cost.
	ExtraCost   float64 `json:"extraCost"`
	MaxWeightKg float64 `json:"maxWeightKg,omitempty"`
	// Modes override the service modes for final legs.
	Modes []string `json:"modes,omitempty"`
	// RateCardIDs override the service rate cards for this route segment.
	RateCardIDs []string `json:"rateCardIds,omitempty"`
	// Restrictions add article restrictions to the service ones.
	Restrictions []Restriction `json:"restrictions,omitempty"`
	Active       bool          `json:"active"`
}

// Route is an explicit, named multi-leg template. The engine also discovers
// bounded paths automatically; explicit routes are always considered.
type Route struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	LegIDs      []string `json:"legIds"`
	Modes       []string `json:"modes,omitempty"`
	Description string   `json:"description,omitempty"`
	Active      bool     `json:"active"`
}

// DeliveryMode is a commercial delivery promise type offered to customers.
type DeliveryMode struct {
	ID                 string  `json:"id"` // STANDARD, EXPRESS…
	Name               string  `json:"name"`
	Description        string  `json:"description,omitempty"`
	MaxLegs            int     `json:"maxLegs"`
	MaxSources         int     `json:"maxSources"`
	AllowConsolidation bool    `json:"allowConsolidation"`
	AllowSplit         bool    `json:"allowSplit"`
	MaxDeliveryDays    int     `json:"maxDeliveryDays"`
	Price              float64 `json:"price"`
	// Criteria rank the options (and pick each shipment's path) for the
	// customer: weighted sum or lexicographic by priority.
	Criteria  []Criterion `json:"criteria,omitempty"`
	Selection string      `json:"selection,omitempty"` // WEIGHTED | LEXICOGRAPHIC
	// StockViewID restricts the stock points and articles used.
	StockViewID string `json:"stockViewId,omitempty"`
	// PriceRateCardIDs compute the amount billed to the customer (ORDER
	// scope, e.g. free shipping above an order amount). Without a card the
	// mode Price is billed.
	PriceRateCardIDs []string `json:"priceRateCardIds,omitempty"`
	Active           bool     `json:"active"`
}

// SKU describes a catalog article.
type SKU struct {
	Code     string  `json:"sku"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	WeightKg float64 `json:"weightKg"`
	VolumeL  float64 `json:"volumeL"`
	LengthCm float64 `json:"lengthCm"`
	WidthCm  float64 `json:"widthCm"`
	HeightCm float64 `json:"heightCm"`
	PriceEur float64 `json:"priceEur"`
	// Attributes are free article attributes usable in rules
	// ("attributes.fragile", "attributes.hazmat"…).
	Attributes map[string]any `json:"attributes,omitempty"`
}

// StockLine is the stock of one SKU in one stock point.
type StockLine struct {
	StockPointID string `json:"stockPointId"`
	SKU          string `json:"sku"`
	Physical     int    `json:"physical"`
	Reserved     int    `json:"reserved"`
	// Available = Physical - Reserved (available to sell).
	Available int `json:"available"`
	// Promisable = Available - SafetyStock (usable for promises).
	Promisable int  `json:"promisable"`
	Listed     bool `json:"listed"`
}

// ScoringWeights rank options. All weights are >= 0.
type ScoringWeights struct {
	DeliveryTime float64 `json:"deliveryTime"`
	Packages     float64 `json:"packages"`
	Cost         float64 `json:"cost"`
	Legs         float64 `json:"legs"`
	Sources      float64 `json:"sources"`
}

func DefaultWeights() ScoringWeights {
	return ScoringWeights{DeliveryTime: 0.45, Packages: 0.2, Cost: 0.2, Legs: 0.05, Sources: 0.1}
}

// EngineSettings are global tunables of the promise engine.
type EngineSettings struct {
	Weights        ScoringWeights `json:"weights"`
	BeamWidth      int            `json:"beamWidth"`
	MaxAllocations int            `json:"maxAllocations"`
	MaxLegs        int            `json:"maxLegs"`
	MaxHubsPerPlan int            `json:"maxHubsPerPlan"`
	// MaxCandidates bounds the stock points whose routes are timed per mode.
	MaxCandidates int    `json:"maxCandidates"`
	Timezone      string `json:"timezone"`
}

func DefaultSettings() EngineSettings {
	return EngineSettings{Weights: DefaultWeights(), BeamWidth: 6, MaxAllocations: 12, MaxLegs: 3, MaxHubsPerPlan: 3, MaxCandidates: 48, Timezone: "Europe/Paris"}
}

// Scenario is a saved basket simulation.
type Scenario struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	Request     PromiseRequest `json:"request"`
	CreatedAt   time.Time      `json:"createdAt"`
}
