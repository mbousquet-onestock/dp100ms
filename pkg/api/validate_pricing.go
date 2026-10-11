package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/pricing"
	"github.com/onestock/dp100ms/pkg/store"
)

func asFE(field string, msgs []string) []fe {
	out := make([]fe, 0, len(msgs))
	for _, m := range msgs {
		f := field
		if i := strings.Index(m, ":"); i > 0 && !strings.Contains(m[:i], " ") {
			f = field + "." + m[:i]
			m = strings.TrimSpace(m[i+1:])
		}
		out = append(out, fe{Field: f, Message: m})
	}
	return out
}

func validateRateCard(st *store.Store, v *model.RateCard) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if v.Currency == "" {
		v.Currency = "EUR"
	}
	if v.CarrierID != "" {
		if _, ok := st.Carriers.Get(v.CarrierID); !ok {
			errs = append(errs, fe{Field: "carrierId", Message: "unknown carrier"})
		}
	}
	if v.NoMatch != "" && v.NoMatch != "REJECT" && v.NoMatch != "ZERO" {
		errs = append(errs, fe{Field: "noMatch", Message: "REJECT or ZERO"})
	}
	_, msgs := pricing.Compile(v, pricing.NewRegistry())
	return append(errs, asFE("rateCard", msgs)...)
}

func validateRestrictions(prefix string, rs []model.Restriction) []fe {
	var errs []fe
	for i, r := range rs {
		p := fmt.Sprintf("%s[%d]", prefix, i)
		if r.Mode != model.RestrictExclude && r.Mode != model.RestrictRequire {
			errs = append(errs, fe{Field: p + ".mode", Message: "EXCLUDE_IF_ANY or REQUIRE_ALL"})
		}
		if len(r.Rules) == 0 {
			errs = append(errs, fe{Field: p + ".rules", Message: "at least one rule"})
		}
		for _, m := range pricing.ValidateRules(p+".rules", r.Rules) {
			errs = append(errs, fe{Field: p, Message: m})
		}
	}
	return errs
}

func checkCards(st *store.Store, field string, ids []string, wantOrder bool) []fe {
	var errs []fe
	for i, id := range ids {
		c, ok := st.RateCards.Get(id)
		if !ok {
			errs = append(errs, fe{Field: fmt.Sprintf("%s[%d]", field, i), Message: "unknown rate card " + id})
			continue
		}
		if wantOrder && c.Scope != model.ScopeOrder {
			errs = append(errs, fe{Field: fmt.Sprintf("%s[%d]", field, i), Message: "customer price cards must have scope ORDER"})
		}
	}
	return errs
}

func validateServicePricing(st *store.Store, v *model.CarrierService) []fe {
	errs := checkCards(st, "rateCardIds", v.RateCardIDs, false)
	errs = append(errs, validateRestrictions("restrictions", v.Restrictions)...)
	for i, id := range v.AdditionalServiceIDs {
		if _, ok := st.AdditionalServices.Get(id); !ok {
			errs = append(errs, fe{Field: fmt.Sprintf("additionalServiceIds[%d]", i), Message: "unknown additional service " + id})
		}
	}
	if v.CarbonGramsPerKgKm < 0 {
		errs = append(errs, fe{Field: "carbonGramsPerKgKm", Message: "must be >= 0"})
	}
	return errs
}

func validateLegPricing(st *store.Store, v *model.Leg) []fe {
	return append(checkCards(st, "rateCardIds", v.RateCardIDs, false), validateRestrictions("restrictions", v.Restrictions)...)
}

var builtinMetrics = map[string]bool{"deliveryHours": true, "deliveryTime": true, "packages": true, "legs": true, "sources": true,
	model.OutCost: true, model.OutPrice: true, model.OutCarbon: true}

func validateCriteria(prefix string, crits []model.Criterion, selection string) []fe {
	var errs []fe
	if selection != "" && selection != model.SelectWeighted && selection != model.SelectLexicographic {
		errs = append(errs, fe{Field: "selection", Message: "WEIGHTED or LEXICOGRAPHIC"})
	}
	for i, c := range crits {
		p := fmt.Sprintf("%s[%d]", prefix, i)
		if c.Metric == "" {
			errs = append(errs, fe{Field: p + ".metric", Message: "required (deliveryHours, cost, price, carbonKg, packages, legs, sources or a rate card output)"})
		}
		if c.Direction != "" && c.Direction != "MIN" && c.Direction != "MAX" {
			errs = append(errs, fe{Field: p + ".direction", Message: "MIN or MAX"})
		}
		if c.Weight < 0 || c.Tolerance < 0 {
			errs = append(errs, fe{Field: p, Message: "weight and tolerance must be >= 0"})
		}
	}
	return errs
}

func validateModePricing(st *store.Store, v *model.DeliveryMode) []fe {
	errs := validateCriteria("criteria", v.Criteria, v.Selection)
	if v.StockViewID != "" {
		if _, ok := st.StockViews.Get(v.StockViewID); !ok {
			errs = append(errs, fe{Field: "stockViewId", Message: "unknown stock view"})
		}
	}
	for i, id := range v.ServiceIDs {
		svc, ok := st.Services.Get(id)
		if !ok {
			errs = append(errs, fe{Field: fmt.Sprintf("serviceIds[%d]", i), Message: "unknown service " + id})
		} else if svc.Kind == model.KindLinehaul || svc.Kind == model.KindShuttle {
			errs = append(errs, fe{Field: fmt.Sprintf("serviceIds[%d]", i), Message: "service " + id + " does not deliver the customer"})
		}
	}
	for i, op := range v.Operations {
		p := fmt.Sprintf("operations[%d]", i)
		ok := false
		for _, k := range model.ModeOperationKinds {
			ok = ok || op.Kind == k
		}
		if !ok {
			errs = append(errs, fe{Field: p + ".kind", Message: strings.Join(model.ModeOperationKinds, ", ")})
		}
		if op.Minutes < 0 || op.Minutes > 14*24*60 {
			errs = append(errs, fe{Field: p + ".minutes", Message: "must be between 0 and 20160"})
		}
	}
	return append(errs, checkCards(st, "priceRateCardIds", v.PriceRateCardIDs, true)...)
}

func validateAdditionalService(_ *store.Store, v *model.AdditionalService) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if v.ExtraDays < 0 || v.ExtraDays > 30 {
		errs = append(errs, fe{Field: "extraDays", Message: "must be between 0 and 30"})
	}
	if v.Kind == "" {
		v.Kind = "OTHER"
	}
	for _, m := range pricing.ValidateRules("appliesTo", v.AppliesTo) {
		errs = append(errs, fe{Field: "appliesTo", Message: m})
	}
	return errs
}

func validateStockView(st *store.Store, v *model.StockView) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if v.Reserve < 0 {
		errs = append(errs, fe{Field: "reserve", Message: "must be >= 0"})
	}
	for i, id := range append(append([]string(nil), v.PointIDs...), v.ExcludePointIDs...) {
		if _, ok := st.StockPoints.Get(id); !ok {
			errs = append(errs, fe{Field: fmt.Sprintf("pointIds[%d]", i), Message: "unknown stock point " + id})
		}
	}
	for i, t := range v.PointTypes {
		if !model.StockPointType(t).Valid() {
			errs = append(errs, fe{Field: fmt.Sprintf("pointTypes[%d]", i), Message: "STORE, WAREHOUSE or LAST_MILE_HUB"})
		}
	}
	for _, m := range pricing.ValidateRules("articleRules", v.ArticleRules) {
		errs = append(errs, fe{Field: "articleRules", Message: m})
	}
	return errs
}

func checkDays(field string, days []int) []fe {
	for _, d := range days {
		if d < 1 || d > 7 {
			return []fe{{Field: field, Message: "days must be between 1 (Monday) and 7 (Sunday)"}}
		}
	}
	return nil
}

// validateCarrierPlanning checks the default grids and the schedules.
func validateCarrierPlanning(st *store.Store, v *model.Carrier) []fe {
	errs := checkCards(st, "rateCardIds", v.RateCardIDs, false)
	errs = append(errs, validateRestrictions("restrictions", v.Restrictions)...)
	seen := map[string]bool{}
	for i := range v.Schedules {
		sc := &v.Schedules[i]
		p := fmt.Sprintf("schedules[%d]", i)
		if sc.ID == "" {
			sc.ID = fmt.Sprintf("%s-PLAN-%d", v.ID, i+1)
		}
		if seen[sc.ID] {
			errs = append(errs, fe{Field: p + ".id", Message: "duplicate schedule id " + sc.ID})
		}
		seen[sc.ID] = true
		if sc.Name == "" {
			errs = append(errs, fe{Field: p + ".name", Message: "required"})
		}
		for j, sid := range sc.ServiceIDs {
			svc, ok := st.Services.Get(sid)
			if !ok || svc.CarrierID != v.ID {
				errs = append(errs, fe{Field: fmt.Sprintf("%s.serviceIds[%d]", p, j), Message: "not a service of carrier " + v.ID})
			}
		}
		for j, z := range sc.Zones {
			if len(z) < 2 || len(z) > 3 {
				errs = append(errs, fe{Field: fmt.Sprintf("%s.zones[%d]", p, j), Message: "department code expected (e.g. 33, 2A → 20)"})
			}
		}
		errs = append(errs, checkDays(p+".pickupDays", sc.PickupDays)...)
		errs = append(errs, checkDays(p+".deliveryDays", sc.DeliveryDays)...)
		if sc.TransitDays != nil && (*sc.TransitDays < 0 || *sc.TransitDays > 30) {
			errs = append(errs, fe{Field: p + ".transitDays", Message: "must be between 0 and 30"})
		}
		if sc.WindowStart != nil && sc.WindowEnd != nil && *sc.WindowEnd <= *sc.WindowStart {
			errs = append(errs, fe{Field: p + ".windowEnd", Message: "must be after windowStart"})
		}
		for j, d := range sc.ClosedDates {
			if len(d) != 10 || d[4] != '-' || d[7] != '-' {
				errs = append(errs, fe{Field: fmt.Sprintf("%s.closedDates[%d]", p, j), Message: "YYYY-MM-DD expected"})
			}
		}
		errs = append(errs, checkCards(st, p+".rateCardIds", sc.RateCardIDs, false)...)
	}
	return errs
}

func validateZone(st *store.Store, v *model.Zone) []fe {
	errs := checkID(v.ID)
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	if len(v.Departments)+len(v.PostalCodes)+len(v.StockPointIDs) == 0 {
		errs = append(errs, fe{Field: "departments", Message: "a zone needs departments, postal codes or stock points"})
	}
	for i, d := range v.Departments {
		if d != "*" && (len(d) < 2 || len(d) > 3) {
			errs = append(errs, fe{Field: fmt.Sprintf("departments[%d]", i), Message: "department code (e.g. 33, 2A, 974) or *"})
		}
	}
	for i, d := range v.ExcludedDepartments {
		if len(d) < 2 || len(d) > 3 {
			errs = append(errs, fe{Field: fmt.Sprintf("excludedDepartments[%d]", i), Message: "department code (e.g. 20)"})
		}
	}
	for i, p := range v.PostalCodes {
		if len(p) < 2 || len(p) > 5 {
			errs = append(errs, fe{Field: fmt.Sprintf("postalCodes[%d]", i), Message: "postal code or prefix of 2 to 5 characters"})
		}
	}
	for i, id := range v.StockPointIDs {
		_, sp := st.StockPoints.Get(id)
		_, hub := st.Hubs.Get(id)
		if !sp && !hub {
			errs = append(errs, fe{Field: fmt.Sprintf("stockPointIds[%d]", i), Message: "unknown stock point or hub " + id})
		}
	}
	return errs
}

func validateCarrierRoute(st *store.Store, v *model.CarrierRoute) []fe {
	errs := checkID(v.ID)
	if _, ok := st.Carriers.Get(v.CarrierID); !ok {
		errs = append(errs, fe{Field: "carrierId", Message: "unknown carrier"})
	}
	if svc, ok := st.Services.Get(v.ServiceID); !ok {
		errs = append(errs, fe{Field: "serviceId", Message: "unknown service"})
	} else if svc.CarrierID != v.CarrierID {
		errs = append(errs, fe{Field: "serviceId", Message: "service of another carrier"})
	}
	if _, ok := st.Zones.Get(v.OriginZoneID); !ok {
		errs = append(errs, fe{Field: "originZoneId", Message: "unknown zone"})
	}
	if _, ok := st.Zones.Get(v.DestinationZoneID); !ok {
		errs = append(errs, fe{Field: "destinationZoneId", Message: "unknown zone"})
	}
	if v.TransitMinHours < 0 || v.TransitMaxHours < 0 {
		errs = append(errs, fe{Field: "transitMinHours", Message: "must be >= 0"})
	}
	if v.TransitMaxHours < v.TransitMinHours {
		errs = append(errs, fe{Field: "transitMaxHours", Message: "must be >= transitMinHours"})
	}
	if v.Costs != nil {
		rc := *v.Costs
		rc.ID = "route"
		if rc.Scope == "" {
			v.Costs.Scope = model.ScopeParcel
			rc.Scope = model.ScopeParcel
		}
		if v.Costs.Currency == "" {
			v.Costs.Currency = "EUR"
		}
		if rc.NoMatch != "" && rc.NoMatch != "REJECT" && rc.NoMatch != "ZERO" {
			errs = append(errs, fe{Field: "costs.noMatch", Message: "REJECT or ZERO"})
		}
		v.Costs.Active = true
		_, msgs := pricing.Compile(&rc, pricing.NewRegistry())
		errs = append(errs, asFE("costs", msgs)...)
	}
	if pl := v.Planning; pl != nil {
		tz := st.Settings().Timezone
		if tz == "" {
			tz = "Europe/Paris"
		}
		if pl.Timezone != "" && pl.Timezone != tz {
			errs = append(errs, fe{Field: "planning.timezone", Message: "only the deployment time zone is supported"})
		}
		seen := map[int]bool{}
		for i, d := range pl.Days {
			p := fmt.Sprintf("planning.days[%d]", i)
			if d.Weekday < 1 || d.Weekday > 7 {
				errs = append(errs, fe{Field: p + ".weekday", Message: "1 (Monday) to 7 (Sunday)"})
			} else if seen[d.Weekday] {
				errs = append(errs, fe{Field: p + ".weekday", Message: "duplicate day"})
			}
			seen[d.Weekday] = true
			if (d.DeliveryStart == nil) != (d.DeliveryEnd == nil) {
				errs = append(errs, fe{Field: p + ".deliveryEnd", Message: "set both slot bounds or none"})
			} else if d.DeliveryStart != nil && *d.DeliveryEnd <= *d.DeliveryStart {
				errs = append(errs, fe{Field: p + ".deliveryEnd", Message: "must be after deliveryStart"})
			}
		}
		for i, s := range pl.ClosedDates {
			if _, err := time.Parse("2006-01-02", s); err != nil {
				errs = append(errs, fe{Field: fmt.Sprintf("planning.closedDates[%d]", i), Message: "YYYY-MM-DD"})
			}
		}
	}
	errs = append(errs, validateRestrictions("restrictions", v.Restrictions)...)
	return errs
}
