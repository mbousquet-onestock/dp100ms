package api

import (
	"fmt"
	"strings"

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
