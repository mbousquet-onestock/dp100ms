package api

import (
	"fmt"
	"regexp"

	"github.com/onestock/dp100ms/pkg/engine"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

type fe = engine.FieldError

var idRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
var pcRe = regexp.MustCompile(`^[0-9]{5}$`)

func checkID(id string) []fe {
	if !idRe.MatchString(id) {
		return []fe{{Field: "id", Message: "1-64 chars among letters, digits, '_', '-', '.'"}}
	}
	return nil
}

func checkCalendar(field string, c model.Calendar) []fe {
	var errs []fe
	if len(c.WorkingDays) == 0 {
		errs = append(errs, fe{Field: field + ".workingDays", Message: "at least one working day (1=Monday … 7=Sunday)"})
	}
	for _, d := range c.WorkingDays {
		if d < 1 || d > 7 {
			errs = append(errs, fe{Field: field + ".workingDays", Message: "days must be between 1 and 7"})
			break
		}
	}
	return errs
}

func checkModes(s *store.Store, field string, modes []string) []fe {
	var errs []fe
	for i, m := range modes {
		if _, ok := s.Modes.Get(m); !ok {
			errs = append(errs, fe{Field: fmt.Sprintf("%s[%d]", field, i), Message: "unknown delivery mode " + m})
		}
	}
	return errs
}

func validateStockPoint(s *store.Store, v *model.StockPoint) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if !v.Type.Valid() {
		errs = append(errs, fe{Field: "type", Message: "must be STORE, WAREHOUSE or LAST_MILE_HUB"})
	}
	if !pcRe.MatchString(v.Address.PostalCode) {
		errs = append(errs, fe{Field: "address.postalCode", Message: "5-digit French postal code"})
	}
	if v.Lat < 41 || v.Lat > 51.5 || v.Lon < -5.5 || v.Lon > 10 {
		errs = append(errs, fe{Field: "lat/lon", Message: "must be within metropolitan France"})
	}
	if v.ClosingTime <= v.OpeningTime {
		errs = append(errs, fe{Field: "closingTime", Message: "must be after openingTime"})
	}
	if v.PrepTimeMinutes < 0 || v.PrepTimeMinutes > 7*24*60 {
		errs = append(errs, fe{Field: "prepTimeMinutes", Message: "must be between 0 and 10080"})
	}
	if v.SafetyStock < 0 {
		errs = append(errs, fe{Field: "safetyStock", Message: "must be >= 0"})
	}
	if v.Timezone == "" {
		v.Timezone = "Europe/Paris"
	}
	if v.Address.Country == "" {
		v.Address.Country = "FR"
	}
	errs = append(errs, checkCalendar("prepCalendar", v.PrepCalendar)...)
	errs = append(errs, checkModes(s, "allowedModes", v.AllowedModes)...)
	return errs
}

func validateCarrier(_ *store.Store, v *model.Carrier) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	return errs
}

func validateService(s *store.Store, v *model.CarrierService) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if _, ok := s.Carriers.Get(v.CarrierID); !ok {
		errs = append(errs, fe{Field: "carrierId", Message: "unknown carrier " + v.CarrierID})
	}
	known := false
	for _, k := range model.ServiceKinds {
		if k == v.Kind {
			known = true
		}
	}
	if !known {
		errs = append(errs, fe{Field: "kind", Message: "unknown service kind"})
	}
	if v.TransitDays < 0 || v.TransitDays > 30 {
		errs = append(errs, fe{Field: "transitDays", Message: "must be between 0 and 30"})
	}
	if v.TransitMinutes < 0 {
		errs = append(errs, fe{Field: "transitMinutes", Message: "must be >= 0"})
	}
	if v.WindowEnd != 0 && v.WindowEnd <= v.WindowStart {
		errs = append(errs, fe{Field: "windowEnd", Message: "must be after windowStart"})
	}
	if v.MaxWeightKg < 0 || v.MaxVolumeL < 0 || v.MaxItems < 0 || v.BaseCost < 0 || v.CostPerKg < 0 {
		errs = append(errs, fe{Field: "limits", Message: "limits and costs must be >= 0"})
	}
	errs = append(errs, checkCalendar("pickupCalendar", v.PickupCalendar)...)
	errs = append(errs, checkCalendar("deliveryCalendar", v.DeliveryCalendar)...)
	errs = append(errs, checkModes(s, "modes", v.Modes)...)
	return errs
}

func validateHub(s *store.Store, v *model.Hub) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if v.Kind != model.HubConsolidation && v.Kind != model.HubLastMile {
		errs = append(errs, fe{Field: "kind", Message: "must be CONSOLIDATION or LAST_MILE"})
	}
	if v.StockPointID != "" {
		if _, ok := s.StockPoints.Get(v.StockPointID); !ok {
			errs = append(errs, fe{Field: "stockPointId", Message: "unknown stock point"})
		} else if v.StockPointID != v.ID {
			errs = append(errs, fe{Field: "id", Message: "a hub attached to a stock point must share its id"})
		}
	} else if _, clash := s.StockPoints.Get(v.ID); clash {
		errs = append(errs, fe{Field: "id", Message: "id is used by a stock point; set stockPointId"})
	}
	if v.SortingMinutes < 0 || v.ConsolidationMinutes < 0 || v.MaxConsolidationWaitHours < 0 {
		errs = append(errs, fe{Field: "minutes", Message: "durations must be >= 0"})
	}
	for i, u := range v.Unavailability {
		if !u.To.After(u.From) {
			errs = append(errs, fe{Field: fmt.Sprintf("unavailability[%d]", i), Message: "to must be after from"})
		}
	}
	errs = append(errs, checkCalendar("calendar", v.Calendar)...)
	return errs
}

func nodeExists(s *store.Store, id string) bool {
	if _, ok := s.StockPoints.Get(id); ok {
		return true
	}
	_, ok := s.Hubs.Get(id)
	return ok
}

func validateLeg(s *store.Store, v *model.Leg) []fe {
	errs := checkID(v.ID)
	if !nodeExists(s, v.From) {
		errs = append(errs, fe{Field: "from", Message: "unknown node " + v.From})
	}
	if v.To != model.CustomerNode {
		if _, ok := s.Hubs.Get(v.To); !ok {
			errs = append(errs, fe{Field: "to", Message: "must be CUSTOMER or a hub id"})
		}
	}
	if v.From == v.To {
		errs = append(errs, fe{Field: "to", Message: "must differ from from"})
	}
	svc, ok := s.Services.Get(v.ServiceID)
	if !ok {
		errs = append(errs, fe{Field: "serviceId", Message: "unknown service"})
	} else if svc.CarrierID != v.CarrierID {
		errs = append(errs, fe{Field: "carrierId", Message: "service " + v.ServiceID + " belongs to " + svc.CarrierID})
	}
	if _, ok := s.Carriers.Get(v.CarrierID); !ok {
		errs = append(errs, fe{Field: "carrierId", Message: "unknown carrier"})
	}
	if v.CutoffMinutesBefore < 0 || v.TransitMinutes < 0 {
		errs = append(errs, fe{Field: "minutes", Message: "durations must be >= 0"})
	}
	if v.Calendar != nil {
		errs = append(errs, checkCalendar("calendar", *v.Calendar)...)
	}
	errs = append(errs, checkModes(s, "modes", v.Modes)...)
	return errs
}

func validateMode(_ *store.Store, v *model.DeliveryMode) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if v.MaxLegs < 1 || v.MaxLegs > 5 {
		errs = append(errs, fe{Field: "maxLegs", Message: "must be between 1 and 5"})
	}
	if v.MaxSources < 1 || v.MaxSources > 6 {
		errs = append(errs, fe{Field: "maxSources", Message: "must be between 1 and 6"})
	}
	if v.MaxDeliveryDays < 0 {
		errs = append(errs, fe{Field: "maxDeliveryDays", Message: "must be >= 0"})
	}
	return errs
}

func validateScenario(_ *store.Store, v *model.Scenario) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if len(v.Request.Items) == 0 {
		errs = append(errs, fe{Field: "request.items", Message: "at least one item"})
	}
	return errs
}
