package model

// ---------------------------------------------------------------------------
// Article rules
//
// A Rule tests one attribute of an article. Fields are the built-in SKU
// fields (sku, name, category, weightKg, volumeL, lengthCm, widthCm,
// heightCm, longestSideCm, girthCm, sumDimensionsCm, priceEur) or any
// custom attribute as "attributes.<key>".

type RuleOp string

const (
	OpEq       RuleOp = "eq"
	OpNeq      RuleOp = "neq"
	OpIn       RuleOp = "in"
	OpNotIn    RuleOp = "nin"
	OpLt       RuleOp = "lt"
	OpLte      RuleOp = "lte"
	OpGt       RuleOp = "gt"
	OpGte      RuleOp = "gte"
	OpBetween  RuleOp = "between"
	OpExists   RuleOp = "exists"
	OpMissing  RuleOp = "missing"
	OpContains RuleOp = "contains"
)

var RuleOps = []RuleOp{OpEq, OpNeq, OpIn, OpNotIn, OpLt, OpLte, OpGt, OpGte, OpBetween, OpExists, OpMissing, OpContains}

type Rule struct {
	Field string `json:"field"`
	Op    RuleOp `json:"op"`
	// Value is a string or a number; Values is used by in / nin / between.
	Value  any   `json:"value,omitempty"`
	Values []any `json:"values,omitempty"`
}

// RestrictionMode tells how a list of rules restricts articles.
type RestrictionMode string

const (
	// RestrictExclude refuses an article matching any rule.
	RestrictExclude RestrictionMode = "EXCLUDE_IF_ANY"
	// RestrictRequire accepts only articles matching every rule.
	RestrictRequire RestrictionMode = "REQUIRE_ALL"
)

// Restriction is a named article restriction of a carrier service or leg.
type Restriction struct {
	Name  string          `json:"name"`
	Mode  RestrictionMode `json:"mode"`
	Rules []Rule          `json:"rules"`
}

// ---------------------------------------------------------------------------
// Rate cards

// RateScope is the object a rate card is evaluated on.
type RateScope string

const (
	ScopeParcel   RateScope = "PARCEL"   // every parcel on every leg using the card
	ScopeShipment RateScope = "SHIPMENT" // every shipment (parcels sharing a path)
	ScopeOrder    RateScope = "ORDER"    // once per option (customer price, franco)
)

// Metric variables available in rate card conditions and components:
//
//	weightKg, volumeL, volumetricWeightKg, chargeableWeightKg,
//	lengthCm, widthCm, heightCm (parcel bounding box, longest first),
//	girthCm (length + 2 × (width + height)), sumDimensionsCm,
//	itemCount, parcelCount, orderAmount, goodsValue, distanceKm, legs,
//	transitDays, plus the derived metrics of the card.
var RateVariables = []string{
	"weightKg", "volumeL", "volumetricWeightKg", "chargeableWeightKg",
	"lengthCm", "widthCm", "heightCm", "girthCm", "sumDimensionsCm",
	"itemCount", "parcelCount", "orderAmount", "goodsValue", "distanceKm", "legs", "transitDays",
}

// DerivedMetric is a linear combination of variables, e.g. the
// carrier-specific "length + 2 × width + 2 × height".
type DerivedMetric struct {
	Key   string `json:"key"`
	Label string `json:"label,omitempty"`
	Terms []Term `json:"terms"`
}

type Term struct {
	Var  string  `json:"var"`
	Coef float64 `json:"coef"`
}

// Range is [Min, Max) on a variable; nil bounds are open.
type Range struct {
	Min *float64 `json:"min,omitempty"`
	Max *float64 `json:"max,omitempty"`
}

// Components compute one output: Fixed + Σ rate × variable, then clamped.
type Components struct {
	Fixed          float64 `json:"fixed,omitempty"`
	PerKg          float64 `json:"perKg,omitempty"` // × chargeableWeightKg
	PerItem        float64 `json:"perItem,omitempty"`
	PerParcel      float64 `json:"perParcel,omitempty"`
	PerKm          float64 `json:"perKm,omitempty"`
	PerKgKm        float64 `json:"perKgKm,omitempty"`        // × weightKg × distanceKm
	PercentOfValue float64 `json:"percentOfValue,omitempty"` // % of orderAmount (ORDER) or goodsValue
	// PerUnit applies a rate to any variable (incl. derived metrics),
	// e.g. {"girthCm": 0.02}.
	PerUnit map[string]float64 `json:"perUnit,omitempty"`
	Min     *float64           `json:"min,omitempty"`
	Max     *float64           `json:"max,omitempty"`
}

// RateRow is one line of a grid: the first row whose conditions all match
// gives the outputs.
type RateRow struct {
	Label      string                `json:"label,omitempty"`
	Conditions map[string]Range      `json:"conditions,omitempty"`
	Zones      []string              `json:"zones,omitempty"` // destination departments
	Outputs    map[string]Components `json:"outputs"`
}

// Surcharge adds outputs when its conditions match (cumulative).
type Surcharge struct {
	Label      string                `json:"label"`
	Conditions map[string]Range      `json:"conditions,omitempty"`
	Zones      []string              `json:"zones,omitempty"`
	Rules      []Rule                `json:"rules,omitempty"` // any article of the parcel matching
	Outputs    map[string]Components `json:"outputs"`
}

// Standard output keys. Any other key is a custom output summed the same way.
const (
	OutCost   = "cost"     // transport cost paid to the carrier
	OutPrice  = "price"    // amount billed to the customer
	OutCarbon = "carbonKg" // CO2e emissions
)

// RateCard is a multi-dimensional tariff grid.
type RateCard struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Description       string          `json:"description,omitempty"`
	CarrierID         string          `json:"carrierId,omitempty"`
	Scope             RateScope       `json:"scope"`
	Currency          string          `json:"currency"`
	VolumetricDivisor float64         `json:"volumetricDivisor,omitempty"` // cm³ per kg, e.g. 5000
	Derived           []DerivedMetric `json:"derived,omitempty"`
	Rows              []RateRow       `json:"rows"`
	Surcharges        []Surcharge     `json:"surcharges,omitempty"`
	// NoMatch: "REJECT" makes the route infeasible when no row matches
	// (e.g. a parcel too heavy for the grid); "ZERO" adds nothing.
	NoMatch string `json:"noMatch,omitempty"`
	Active  bool   `json:"active"`
}

// ---------------------------------------------------------------------------
// Additional services (delivery to room, installation, take-back…)

type AdditionalService struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"` // DELIVERY, INSTALLATION, ASSEMBLY, TAKE_BACK, APPOINTMENT, OTHER
	Description string `json:"description,omitempty"`
	// Applicability: the service applies to the articles matching every rule
	// (empty = every article).
	AppliesTo []Rule `json:"appliesTo,omitempty"`
	// Outputs per order and per applicable item (price, cost, carbonKg…).
	Outputs map[string]Components `json:"outputs"`
	// ExtraDays delays the delivery by delivery-working days.
	ExtraDays int  `json:"extraDays"`
	Active    bool `json:"active"`
}

// ---------------------------------------------------------------------------
// Stock views

// StockView selects the stock points and the articles a delivery mode may
// use, with an optional extra reserve.
type StockView struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     string   `json:"description,omitempty"`
	PointIDs        []string `json:"pointIds,omitempty"`    // explicit list (empty = all)
	PointTypes      []string `json:"pointTypes,omitempty"`  // STORE, WAREHOUSE, LAST_MILE_HUB
	Departments     []string `json:"departments,omitempty"` // postal code prefixes of the points
	ExcludePointIDs []string `json:"excludePointIds,omitempty"`
	// ArticleRules: articles must match every rule (empty = all).
	ArticleRules []Rule `json:"articleRules,omitempty"`
	// Reserve units kept back on every line on top of the safety stock.
	Reserve int  `json:"reserve"`
	Active  bool `json:"active"`
}

// ---------------------------------------------------------------------------
// Delivery mode selection criteria

type Criterion struct {
	// Metric: deliveryHours, cost, price, carbonKg, packages, legs, sources
	// or any custom rate card output.
	Metric    string  `json:"metric"`
	Direction string  `json:"direction,omitempty"` // MIN (default) or MAX
	Weight    float64 `json:"weight"`
	Priority  int     `json:"priority"` // 1 = most important (LEXICOGRAPHIC)
	// Max rejects options above this value (hard constraint).
	Max *float64 `json:"max,omitempty"`
	// Tolerance for LEXICOGRAPHIC comparison (same unit as the metric).
	Tolerance float64 `json:"tolerance,omitempty"`
}

const (
	SelectWeighted      = "WEIGHTED"
	SelectLexicographic = "LEXICOGRAPHIC"
)
