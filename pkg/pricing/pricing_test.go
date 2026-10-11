package pricing

import (
	"math"
	"testing"

	"github.com/onestock/dp100ms/pkg/model"
)

func f(x float64) *float64 { return &x }

func TestRules(t *testing.T) {
	s := &model.SKU{Code: "SKU-1", Category: "Maison", WeightKg: 12, LengthCm: 120, WidthCm: 40, HeightCm: 30, PriceEur: 499,
		Attributes: map[string]any{"fragile": true, "hazmat": "UN1266", "tags": []any{"tv", "oled"}}}
	cases := []struct {
		r    model.Rule
		want bool
	}{
		{model.Rule{Field: "category", Op: model.OpEq, Value: "maison"}, true},
		{model.Rule{Field: "weightKg", Op: model.OpGt, Value: 10}, true},
		{model.Rule{Field: "longestSideCm", Op: model.OpGte, Value: "120"}, true},
		{model.Rule{Field: "girthCm", Op: model.OpLte, Value: 260}, true}, // 120 + 2×(40+30)
		{model.Rule{Field: "attributes.fragile", Op: model.OpEq, Value: true}, true},
		{model.Rule{Field: "attributes.hazmat", Op: model.OpExists}, true},
		{model.Rule{Field: "attributes.battery", Op: model.OpMissing}, true},
		{model.Rule{Field: "attributes.tags", Op: model.OpContains, Value: "oled"}, true},
		{model.Rule{Field: "category", Op: model.OpIn, Values: []any{"Sport", "Mode"}}, false},
		{model.Rule{Field: "priceEur", Op: model.OpBetween, Values: []any{100, 500}}, true},
	}
	for i, c := range cases {
		if got := MatchRule(c.r, s); got != c.want {
			t.Errorf("case %d %+v: got %v", i, c.r, got)
		}
	}
	excl := []model.Restriction{{Name: "no hazmat", Mode: model.RestrictExclude, Rules: []model.Rule{{Field: "attributes.hazmat", Op: model.OpExists}}}}
	if Allows(excl, s) {
		t.Error("hazmat article must be refused")
	}
	req := []model.Restriction{{Name: "small", Mode: model.RestrictRequire, Rules: []model.Rule{{Field: "weightKg", Op: model.OpLte, Value: 20}}}}
	if !Allows(req, s) {
		t.Error("12 kg article must be accepted")
	}
}

func TestRateCardGridDerivedAndFranco(t *testing.T) {
	reg := NewRegistry()
	card := &model.RateCard{ID: "C", Scope: model.ScopeParcel, VolumetricDivisor: 5000, NoMatch: "REJECT",
		Derived: []model.DerivedMetric{{Key: "lPlus2wh", Terms: []model.Term{{Var: "lengthCm", Coef: 1}, {Var: "widthCm", Coef: 2}, {Var: "heightCm", Coef: 2}}}},
		Rows: []model.RateRow{
			{Conditions: map[string]model.Range{"chargeableWeightKg": {Max: f(2)}}, Outputs: map[string]model.Components{"cost": {Fixed: 5}, "carbonKg": {PerKgKm: 0.0002}}},
			{Conditions: map[string]model.Range{"chargeableWeightKg": {Min: f(2), Max: f(30)}}, Outputs: map[string]model.Components{"cost": {Fixed: 6, PerKg: 0.5}}},
		},
		Surcharges: []model.Surcharge{
			{Label: "hors gabarit", Conditions: map[string]model.Range{"lPlus2wh": {Min: f(200)}}, Outputs: map[string]model.Components{"cost": {Fixed: 10}}},
			{Label: "fragile", Rules: []model.Rule{{Field: "attributes.fragile", Op: model.OpEq, Value: true}}, Outputs: map[string]model.Components{"cost": {Fixed: 2}}},
		}}
	c, errs := Compile(card, reg)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	small := &model.SKU{WeightKg: 1, LengthCm: 20, WidthCm: 10, HeightCm: 10, VolumeL: 2}
	v := Measure([]ItemQty{{small, 1}})
	v[VDistance] = 500
	out := make([]float64, len(reg.Names))
	if !c.Eval(v, "75", []*model.SKU{small}, out) || out[OutCost] != 5 || math.Abs(out[OutCarbon]-0.1) > 1e-9 {
		t.Fatalf("small parcel: %v", out)
	}
	// volumetric weight: 100×60×50 / 5000 = 60 kg > 30 → no row → reject
	big := &model.SKU{WeightKg: 8, LengthCm: 100, WidthCm: 60, HeightCm: 50, VolumeL: 300, Attributes: map[string]any{"fragile": true}}
	out = make([]float64, len(reg.Names))
	if c.Eval(Measure([]ItemQty{{big, 1}}), "75", []*model.SKU{big}, out) {
		t.Fatal("a 60 kg chargeable parcel must be rejected by the grid")
	}
	mid := &model.SKU{WeightKg: 8, LengthCm: 90, WidthCm: 40, HeightCm: 20, VolumeL: 72, Attributes: map[string]any{"fragile": true}}
	out = make([]float64, len(reg.Names))
	c.Eval(Measure([]ItemQty{{mid, 1}}), "75", []*model.SKU{mid}, out)
	// chargeable = max(8, 90×40×20/5000=14.4) = 14.4 → 6 + 7.2; l+2w+2h = 210 → +10; fragile +2
	if math.Abs(out[OutCost]-25.2) > 1e-9 {
		t.Fatalf("mid parcel cost %v", out[OutCost])
	}
	// franco: customer price 0 above 60 EUR
	franco := &model.RateCard{ID: "P", Scope: model.ScopeOrder, Rows: []model.RateRow{
		{Conditions: map[string]model.Range{"orderAmount": {Min: f(60)}}, Outputs: map[string]model.Components{"price": {}}},
		{Outputs: map[string]model.Components{"price": {Fixed: 4.9}}},
	}}
	pc, _ := Compile(franco, reg)
	var ov Vars
	ov[VOrderAmount] = 59
	out = make([]float64, len(reg.Names))
	pc.Eval(ov, "75", nil, out)
	if out[OutPrice] != 4.9 {
		t.Fatalf("below franco: %v", out[OutPrice])
	}
	ov[VOrderAmount] = 60
	out = make([]float64, len(reg.Names))
	pc.Eval(ov, "75", nil, out)
	if out[OutPrice] != 0 {
		t.Fatalf("franco: %v", out[OutPrice])
	}
}

func TestCompileErrors(t *testing.T) {
	_, errs := Compile(&model.RateCard{ID: "X", Scope: "WEEKLY", Rows: []model.RateRow{{Conditions: map[string]model.Range{"color": {}}}}}, NewRegistry())
	if len(errs) < 2 {
		t.Fatalf("expected errors, got %v", errs)
	}
}
