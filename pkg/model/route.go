package model

// ---------------------------------------------------------------------------
// Zones and carrier routes
//
// A Zone groups departments, postal code prefixes and stock points. Carrier
// routes link an origin zone to a destination zone for one carrier service
// and carry the cost grid, the transit time, the weekly planning (pickups and
// delivery slots), article restrictions and free metadata.

// Zone is a named set of places. A place belongs to the zone when it matches
// any of its departments ("*" = metropolitan France), postal code prefixes
// or stock point IDs.
type Zone struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	Departments   []string `json:"departments,omitempty"`
	PostalCodes   []string `json:"postalCodes,omitempty"`
	StockPointIDs []string `json:"stockPointIds,omitempty"`
	Active        bool     `json:"active"`
}

// RouteDay is the planning of one weekday (1 = Monday … 7 = Sunday):
// the pickup times at the origin and the delivery slot at the destination.
// A day without pickups has no pickup; a day without slot has no delivery.
type RouteDay struct {
	Weekday       int         `json:"weekday"`
	Pickups       []TimeOfDay `json:"pickups,omitempty"`
	DeliveryStart *TimeOfDay  `json:"deliveryStart,omitempty"`
	DeliveryEnd   *TimeOfDay  `json:"deliveryEnd,omitempty"`
}

// RoutePlanning is the weekly planning of a route.
type RoutePlanning struct {
	// Timezone of the times (only the deployment time zone is supported).
	Timezone      string     `json:"timezone,omitempty"`
	Days          []RouteDay `json:"days"`
	HonorHolidays bool       `json:"honorHolidays"`
	ClosedDates   []string   `json:"closedDates,omitempty"`
}

// CarrierRoute is a delivery route of a carrier service from an origin zone
// to a destination zone. When several routes match a leg and a destination,
// the highest priority wins, then the most specific destination zone.
type CarrierRoute struct {
	ID                string `json:"id"`
	CarrierID         string `json:"carrierId"`
	ServiceID         string `json:"serviceId"`
	Name              string `json:"name,omitempty"`
	OriginZoneID      string `json:"originZoneId"`
	DestinationZoneID string `json:"destinationZoneId"`
	// Costs is the cost grid of the route (transport cost, customer shipping
	// fees, carbon or custom outputs). Its id is ignored.
	Costs *RateCard `json:"costs,omitempty"`
	// Transit time from pickup to delivery, in hours. 0/0 keeps the transit
	// of the service (in delivery days).
	TransitMinHours int               `json:"transitMinHours"`
	TransitMaxHours int               `json:"transitMaxHours"`
	Planning        *RoutePlanning    `json:"planning,omitempty"`
	Restrictions    []Restriction     `json:"restrictions,omitempty"`
	Metadata        map[string]string `json:"metadata,omitempty"`
	Priority        int               `json:"priority"`
	Active          bool              `json:"active"`
}
