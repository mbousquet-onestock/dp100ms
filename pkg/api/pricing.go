package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
	"github.com/onestock/dp100ms/pkg/pricing"
)

// QuoteRequest evaluates a rate card on articles or explicit variables.
type QuoteRequest struct {
	// Card is an inline card (POST /rate-cards/quote); otherwise the card of
	// the URL is used.
	Card  *model.RateCard    `json:"card,omitempty"`
	Items []model.BasketItem `json:"items,omitempty"`
	// Vars override measured variables (e.g. {"weightKg": 3, "distanceKm": 400}).
	Vars        map[string]float64 `json:"vars,omitempty"`
	Zone        string             `json:"zone,omitempty"` // department code
	OrderAmount *float64           `json:"orderAmount,omitempty"`
}

type QuoteResponse struct {
	CardID   string             `json:"cardId"`
	Scope    model.RateScope    `json:"scope"`
	Matched  bool               `json:"matched"`
	Vars     map[string]float64 `json:"vars"`
	Outputs  map[string]float64 `json:"outputs"`
	Warnings []string           `json:"warnings,omitempty"`
}

func (s *Server) quoteRateCard(w http.ResponseWriter, r *http.Request) {
	var q QuoteRequest
	if !decode(w, r, &q) {
		return
	}
	st := s.store()
	var card model.RateCard
	if id := r.PathValue("id"); id != "" {
		c, ok := st.RateCards.Get(id)
		if !ok {
			notFound(w, r, "rate card")
			return
		}
		card = c
	} else if q.Card != nil {
		card = *q.Card
	} else {
		validationFailed(w, r, []fe{{Field: "card", Message: "required when no rate card id is given"}})
		return
	}
	reg := pricing.NewRegistry()
	compiled, errs := pricing.Compile(&card, reg)
	if len(errs) > 0 {
		validationFailed(w, r, asFE("card", errs))
		return
	}
	var items []pricing.ItemQty
	var skus []*model.SKU
	orderAmount := 0.0
	for i, it := range q.Items {
		k, ok := st.Stock.SKUIndex(it.SKU)
		if !ok || it.Quantity <= 0 {
			validationFailed(w, r, []fe{{Field: "items", Message: "unknown sku or quantity <= 0 at index " + itoa(i)}})
			return
		}
		sku := st.Stock.SKU(k)
		items = append(items, pricing.ItemQty{SKU: &sku, Qty: it.Quantity})
		skus = append(skus, &sku)
		orderAmount += sku.PriceEur * float64(it.Quantity)
	}
	v := pricing.Measure(items)
	v[pricing.VOrderAmount] = orderAmount
	if q.OrderAmount != nil {
		v[pricing.VOrderAmount] = *q.OrderAmount
	}
	var warnings []string
	for name, x := range q.Vars {
		if !v.Set(name, x) {
			warnings = append(warnings, "unknown variable "+name+" ignored")
		}
	}
	out := make([]float64, len(reg.Names))
	matched := compiled.Eval(v, q.Zone, skus, out)
	writeJSON(w, 200, QuoteResponse{CardID: card.ID, Scope: compiled.Scope, Matched: matched, Vars: pricing.VarsMap(v), Outputs: reg.Map(out), Warnings: warnings})
}

func itoa(i int) string {
	b := []byte{}
	if i == 0 {
		return "0"
	}
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

// pricingFields describes what rules, rate cards and criteria can use.
func (s *Server) pricingFields(w http.ResponseWriter, r *http.Request) {
	st := s.store()
	attrs := map[string]bool{}
	for _, k := range st.Stock.SKUs() {
		for a := range k.Attributes {
			attrs[a] = true
		}
	}
	var attrList []string
	for a := range attrs {
		attrList = append(attrList, "attributes."+a)
	}
	sort.Strings(attrList)
	outputs := []string{model.OutCost, model.OutPrice, model.OutCarbon}
	net := s.engine().Network()
	for _, n := range net.Registry.Names[3:] {
		outputs = append(outputs, n)
	}
	writeJSON(w, 200, map[string]any{
		"articleFields":          pricing.ArticleFields,
		"articleAttributes":      attrList,
		"ruleOperators":          model.RuleOps,
		"restrictionModes":       []model.RestrictionMode{model.RestrictExclude, model.RestrictRequire},
		"rateVariables":          model.RateVariables,
		"rateScopes":             []model.RateScope{model.ScopeParcel, model.ScopeShipment, model.ScopeOrder},
		"outputs":                outputs,
		"criteriaMetrics":        append([]string{"deliveryHours", "packages", "legs", "sources"}, outputs...),
		"selections":             []string{model.SelectWeighted, model.SelectLexicographic},
		"additionalServiceKinds": []string{"DELIVERY", "INSTALLATION", "ASSEMBLY", "TAKE_BACK", "APPOINTMENT", "OTHER"},
		"warnings":               net.Warnings,
	})
}

// previewStockView counts the points and articles selected by a view.
func (s *Server) previewStockView(w http.ResponseWriter, r *http.Request) {
	net := s.engine().Network()
	v := net.StockViews[r.PathValue("id")]
	if v == nil {
		notFound(w, r, "active stock view")
		return
	}
	var points []string
	seen := map[*network.Node]bool{}
	for _, n := range net.NodeList {
		if n.StockPoint != nil && !seen[n] && v.AllowsNode(n) {
			seen[n] = true
			points = append(points, n.ID)
		}
	}
	sort.Strings(points)
	skus := 0
	for _, k := range s.store().Stock.SKUs() {
		k := k
		if v.AllowsSKU(&k) {
			skus++
		}
	}
	writeJSON(w, 200, map[string]any{"id": v.ID, "stockPoints": len(points), "pointIds": points, "skus": skus, "reserve": v.Reserve})
}

// putSKU updates an article (dimensions, price, attributes…).
func (s *Server) putSKU(w http.ResponseWriter, r *http.Request) {
	var v model.SKU
	if !decode(w, r, &v) {
		return
	}
	code := r.PathValue("sku")
	if v.Code != code {
		validationFailed(w, r, []fe{{Field: "sku", Message: "must match the URL"}})
		return
	}
	var errs []fe
	if v.Name == "" {
		errs = append(errs, fe{Field: "name", Message: "required"})
	}
	for _, x := range []float64{v.WeightKg, v.VolumeL, v.LengthCm, v.WidthCm, v.HeightCm, v.PriceEur} {
		if x < 0 {
			errs = append(errs, fe{Field: "dimensions", Message: "weights, sizes and price must be >= 0"})
			break
		}
	}
	if len(errs) > 0 {
		validationFailed(w, r, errs)
		return
	}
	st := s.store()
	if err := st.UpdateSKU(v); err != nil {
		stockErr(w, r, err)
		return
	}
	writeJSON(w, 200, v)
}

// SchedulePreviewRequest asks which planning applies to a service.
type SchedulePreviewRequest struct {
	ServiceID  string    `json:"serviceId"`
	PostalCode string    `json:"postalCode"`
	ReadyAt    time.Time `json:"readyAt"`
	// OriginID optionally picks the leg leaving this stock point or hub
	// (carrier routes depend on the origin zone).
	OriginID string `json:"originId,omitempty"`
}

// schedulePreview shows the effective planning of a carrier service for a
// destination: layers applied, pickup, departure, delivery window, grids.
func (s *Server) schedulePreview(w http.ResponseWriter, r *http.Request) {
	var q SchedulePreviewRequest
	if !decode(w, r, &q) {
		return
	}
	carrierID := r.PathValue("id")
	net := s.engine().Network()
	if _, ok := net.Carriers[carrierID]; !ok {
		notFound(w, r, "carrier")
		return
	}
	dept, err := network.Dept(q.PostalCode)
	var errs []fe
	if err != nil {
		errs = append(errs, fe{Field: "postalCode", Message: err.Error()})
	}
	if q.ReadyAt.IsZero() {
		errs = append(errs, fe{Field: "readyAt", Message: "required (RFC 3339)"})
	}
	// a final leg of the service, or any leg of it
	var leg *network.Leg
	for _, l := range net.Legs {
		if l.ServiceID != q.ServiceID || l.CarrierID != carrierID || (q.OriginID != "" && l.From != q.OriginID) {
			continue
		}
		if leg == nil || (l.Final && !leg.Final) {
			leg = l
		}
	}
	if leg == nil {
		errs = append(errs, fe{Field: "serviceId", Message: "no active leg uses this service of the carrier"})
	}
	if len(errs) > 0 {
		validationFailed(w, r, errs)
		return
	}
	plan := leg.Plan(dept)
	clk := calendar.ClockFor(net.Loc)
	out := map[string]any{
		"scheduleIds": nz(plan.ScheduleIDs), "legId": leg.ID, "final": leg.Final,
		"pickupDays": plan.PickupDays, "cutoff": plan.Cutoff, "departures": plan.Departures,
		"deliveryDays": plan.DeliveryDays, "transitDays": plan.TransitDays,
		"windowStart": plan.WindowStart, "windowEnd": plan.WindowEnd, "rateCardIds": nz(plan.CardIDs),
	}
	if plan.RouteID != "" {
		out["routeId"] = plan.RouteID
		out["transitMinHours"] = plan.TransitMinSec / 3600
		out["transitMaxHours"] = plan.TransitMaxSec / 3600
	}
	if dep, ok := plan.NextDeparture(clk, q.ReadyAt.Unix()); ok {
		out["departure"] = clk.Time(dep)
		if leg.Final {
			if from, to, ok := plan.Delivery(clk, dep, int64(leg.Transit.Seconds())); ok {
				out["delivery"] = model.TimeWindow{From: clk.Time(from), To: clk.Time(to)}
			}
		}
	}
	writeJSON(w, 200, out)
}
