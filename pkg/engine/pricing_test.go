package engine_test

import (
	"math"
	"testing"

	"github.com/onestock/dp100ms/pkg/model"
)

func fp(x float64) *float64 { return &x }

// pricingFixture adds article data, rate cards, services and views.
func pricingFixture(t *testing.T) *fixture {
	f := newFixture(t)
	st := f.s
	// articles: dimensions, prices, attributes
	skus := st.Stock.SKUs()
	for i := range skus {
		skus[i].LengthCm, skus[i].WidthCm, skus[i].HeightCm, skus[i].PriceEur = 30, 20, 10, 25
	}
	skus[3].LengthCm, skus[3].WidthCm, skus[3].HeightCm, skus[3].PriceEur = 120, 60, 20, 300 // SKU-D: TV
	skus[3].Attributes = map[string]any{"installable": true}
	skus[4].Attributes = map[string]any{"hazmat": "UN1266"} // SKU-E: perfume
	// transport cost grid on the standard service (weight bands + oversize)
	st.RateCards.Put(model.RateCard{ID: "STD-COST", Name: "Standard", Scope: model.ScopeParcel, VolumetricDivisor: 5000, Active: true,
		Rows: []model.RateRow{
			{Conditions: map[string]model.Range{"chargeableWeightKg": {Max: fp(5)}}, Outputs: map[string]model.Components{"cost": {Fixed: 7}, "carbonKg": {Fixed: 0.5}}},
			{Conditions: map[string]model.Range{"chargeableWeightKg": {Min: fp(5)}}, Outputs: map[string]model.Components{"cost": {Fixed: 9, PerKg: 0.4}, "carbonKg": {Fixed: 1.5}}},
		},
		Surcharges: []model.Surcharge{{Label: "Hors gabarit", Conditions: map[string]model.Range{"lengthCm": {Min: fp(100)}}, Outputs: map[string]model.Components{"cost": {Fixed: 15}}}}})
	// last mile: low carbon
	st.RateCards.Put(model.RateCard{ID: "LM-COST", Name: "Vélo", Scope: model.ScopeParcel, Active: true,
		Rows: []model.RateRow{{Outputs: map[string]model.Components{"cost": {Fixed: 12}, "carbonKg": {Fixed: 0.01}}}}})
	// customer price with free shipping above 100 EUR
	st.RateCards.Put(model.RateCard{ID: "STD-PRICE", Name: "Prix standard", Scope: model.ScopeOrder, Active: true,
		Rows: []model.RateRow{
			{Label: "Franco", Conditions: map[string]model.Range{"orderAmount": {Min: fp(100)}}, Outputs: map[string]model.Components{"price": {}}},
			{Outputs: map[string]model.Components{"price": {Fixed: 4.9}}},
		}})
	st.AdditionalServices.Put(model.AdditionalService{ID: "INSTALL", Name: "Installation", Kind: "INSTALLATION", Active: true, ExtraDays: 1,
		AppliesTo: []model.Rule{{Field: "attributes.installable", Op: model.OpEq, Value: true}},
		Outputs:   map[string]model.Components{"price": {PerItem: 49}, "cost": {PerItem: 30}}})
	setSvc := func(id string, fn func(*model.CarrierService)) {
		s, _ := st.Services.Get(id)
		fn(&s)
		if err := st.Services.Update(id, s); err != nil {
			t.Fatal(err)
		}
	}
	setSvc("STD", func(s *model.CarrierService) {
		s.RateCardIDs = []string{"STD-COST"}
		s.AdditionalServiceIDs = []string{"INSTALL"}
		s.Restrictions = []model.Restriction{{Name: "Pas de matières dangereuses", Mode: model.RestrictExclude, Rules: []model.Rule{{Field: "attributes.hazmat", Op: model.OpExists}}}}
	})
	setSvc("LM", func(s *model.CarrierService) { s.RateCardIDs = []string{"LM-COST"} })
	m, _ := st.Modes.Get("STANDARD")
	m.PriceRateCardIDs = []string{"STD-PRICE"}
	_ = st.Modes.Update("STANDARD", m)
	return f
}

func modeOpts(resp *model.PromiseResponse, mode string) []model.PromiseOption {
	var out []model.PromiseOption
	for _, o := range resp.Options {
		if o.DeliveryMode == mode {
			out = append(out, o)
		}
	}
	return out
}

func TestRateCardCostAndFranco(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "WH-C", "SKU-A", 10)
	f.disableLeg(t, "C-LH")
	r := req("69003", monday, std, it("SKU-A", 2)) // 2 × 25 EUR = 50 < franco
	resp := f.promise(t, r)
	requireOptions(t, resp)
	o := resp.Options[0]
	// one parcel of 1 kg: 7 EUR cost from the grid + 2 EUR preparation
	if math.Abs(o.Metrics["cost"]-9) > 1e-6 || o.Metrics["price"] != 4.9 || o.Metrics["carbonKg"] != 0.5 {
		t.Fatalf("unexpected metrics %+v", o.Metrics)
	}
	if o.Packages[0].Metrics["cost"] == 0 || o.Packages[0].LeadTimeHours <= 0 || o.Packages[0].DistanceKm <= 0 {
		t.Errorf("package information missing: %+v", o.Packages[0])
	}
	r2 := req("69003", monday, std, it("SKU-A", 4)) // 100 EUR: free shipping
	resp2 := f.promise(t, r2)
	if p := resp2.Options[0].Metrics["price"]; p != 0 {
		t.Fatalf("franco not applied: price %v", p)
	}
	// oversize surcharge on the 120 cm TV
	f.stock(t, "WH-C", "SKU-D", 2)
	resp3 := f.promise(t, req("69003", monday, std, it("SKU-D", 1)))
	// TV 8 kg, volumetric 120×60×20/5000 = 28.8 kg → 9 + 11.52 + 15 + 2 prep
	if c := resp3.Options[0].Metrics["cost"]; math.Abs(c-37.52) > 1e-6 {
		t.Fatalf("oversize cost %v", c)
	}
}

func TestArticleRestriction(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "STORE-A", "SKU-E", 3) // hazmat
	resp := f.promise(t, req("69003", monday, std, it("SKU-E", 1)))
	requireOptions(t, resp)
	for _, o := range resp.Options {
		for _, p := range o.Packages {
			for _, l := range p.Route {
				if l.Service == "STD" {
					t.Fatalf("hazmat article routed on a service that refuses it: %+v", l)
				}
			}
		}
	}
	// only the standard service could reach Grenoble (38) from the store
	f.disableLeg(t, "A-LH")
	resp2 := f.promise(t, req("38000", monday, std, it("SKU-E", 1)))
	if len(resp2.Options) != 0 || resp2.Unavailable[0].Code != "NO_FEASIBLE_PLAN" {
		t.Fatalf("expected NO_FEASIBLE_PLAN, got %+v", resp2.Unavailable)
	}
}

func TestStockViewRestrictsSources(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 5)
	f.stock(t, "WH-C", "SKU-A", 5)
	f.s.StockViews.Put(model.StockView{ID: "WH-ONLY", Name: "Entrepôts", PointTypes: []string{"WAREHOUSE"}, Active: true})
	r := req("69003", monday, std, it("SKU-A", 1))
	r.StockViewID = "WH-ONLY"
	resp := f.promise(t, r)
	requireOptions(t, resp)
	for _, o := range resp.Options {
		if !sources(o)["WH-C"] || len(sources(o)) != 1 || o.StockViewID != "WH-ONLY" {
			t.Fatalf("stock view ignored: %v", sources(o))
		}
	}
	// article rules and reserve
	f.s.StockViews.Put(model.StockView{ID: "RESERVE", Name: "Réserve 5", Reserve: 5, Active: true})
	r.StockViewID = "RESERVE"
	resp2 := f.promise(t, r)
	if len(resp2.Options) != 0 {
		t.Fatal("a reserve of 5 units must leave nothing promisable")
	}
}

func TestCarbonCriterionPicksGreenRoute(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 2)
	f.disableLeg(t, "A-LH")
	r := req("69003", monday, std, it("SKU-A", 1))
	r.Criteria = []model.Criterion{{Metric: "carbonKg", Weight: 1, Priority: 1}, {Metric: "deliveryHours", Weight: 0.01, Priority: 2}}
	r.Selection = model.SelectLexicographic
	resp := f.promise(t, r)
	requireOptions(t, resp)
	best := resp.Options[0]
	for _, o := range resp.Options[1:] {
		if o.Metrics["carbonKg"] < best.Metrics["carbonKg"]-1e-9 {
			t.Fatalf("option %s has less carbon than the first one", o.ID)
		}
	}
	// the bike last mile emits less than the standard carrier
	last := best.Packages[0].Route[len(best.Packages[0].Route)-1]
	if last.Service != "LM" {
		t.Errorf("expected the low-carbon last mile, got %s", last.Service)
	}
	// a hard limit removes options above it
	r.Criteria[0].Max = fp(0.2)
	resp2 := f.promise(t, r)
	for _, o := range resp2.Options {
		if o.Metrics["carbonKg"] > 0.2 {
			t.Fatalf("option above the carbon limit: %v", o.Metrics)
		}
	}
}

func TestAdditionalServiceInstallation(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "WH-C", "SKU-D", 2)
	base := f.promise(t, req("69003", monday, std, it("SKU-D", 1)))
	requireOptions(t, base)
	finalSvc := func(o model.PromiseOption) string { r := o.Packages[0].Route; return r[len(r)-1].Service }
	var stdBase *model.PromiseOption
	for i, o := range base.Options {
		if finalSvc(o) == "STD" {
			stdBase = &base.Options[i]
			for _, s := range o.AdditionalServices {
				if s.ID != "INSTALL" || s.Requested {
					t.Fatalf("unexpected service %+v", s)
				}
			}
			if len(o.AdditionalServices) != 1 {
				t.Fatal("installation should be offered by the standard carrier for the TV")
			}
		} else if len(o.AdditionalServices) != 0 {
			t.Fatalf("carrier %s does not offer installation", finalSvc(o))
		}
	}
	if stdBase == nil {
		t.Fatal("no option with the standard carrier")
	}
	r := req("69003", monday, std, it("SKU-D", 1))
	r.AdditionalServices = []string{"INSTALL"}
	resp := f.promise(t, r)
	requireOptions(t, resp)
	for _, o := range resp.Options {
		if finalSvc(o) != "STD" {
			t.Fatalf("installation requested but delivered by %s", finalSvc(o))
		}
	}
	o := resp.Options[0]
	// 300 EUR order: free shipping, + 49 EUR installation
	if o.Metrics["price"] != stdBase.Metrics["price"]+49 || math.Abs(o.Metrics["cost"]-stdBase.Metrics["cost"]-30) > 1e-6 {
		t.Fatalf("installation not priced: %v vs %v", o.Metrics, stdBase.Metrics)
	}
	if !o.EstimatedDelivery.To.After(stdBase.EstimatedDelivery.To) {
		t.Errorf("installation should add a delivery day: %v vs %v", o.EstimatedDelivery.To, stdBase.EstimatedDelivery.To)
	}
	// the express carrier does not install: no express option with the service
	r.DeliveryModes = []string{"EXPRESS"}
	resp2 := f.promise(t, r)
	if len(resp2.Options) != 0 {
		t.Fatal("express cannot provide installation")
	}
}

func TestPackageAlternatives(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 2)
	f.stock(t, "STORE-B", "SKU-A", 2)
	f.stock(t, "WH-C", "SKU-A", 9)
	r := req("69003", monday, std, it("SKU-A", 1))
	r.Alternatives = &model.AlternativesRequest{Limit: 5, SortBy: "cost"}
	resp := f.promise(t, r)
	requireOptions(t, resp)
	alts := resp.Options[0].Packages[0].Alternatives
	if len(alts) < 3 {
		t.Fatalf("expected 3 alternatives, got %d", len(alts))
	}
	for i := 1; i < len(alts); i++ {
		if alts[i].Metrics["cost"] < alts[i-1].Metrics["cost"] {
			t.Fatalf("alternatives not sorted by cost")
		}
	}
}
