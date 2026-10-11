package engine_test

import (
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
)

func tptr(s string) *model.TimeOfDay { t := model.MustTOD(s); return &t }
func iptr(i int) *int               { return &i }

func setCarrier(t *testing.T, f *fixture, id string, fn func(*model.Carrier)) {
	t.Helper()
	c, _ := f.s.Carriers.Get(id)
	fn(&c)
	if err := f.s.Carriers.Update(id, c); err != nil {
		t.Fatal(err)
	}
}

// Carrier-level cost grid and delivery planning, with a zone override.
func TestCarrierScheduleAndGrid(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "WH-C", "SKU-A", 10)
	f.disableLeg(t, "C-LH")
	f.disableLeg(t, "C-EXP")
	// the standard service has no grid of its own: the carrier grid applies
	svc, _ := f.s.Services.Get("STD")
	svc.RateCardIDs = nil
	_ = f.s.Services.Update("STD", svc)
	f.s.RateCards.Put(model.RateCard{ID: "CAR-GRID", Name: "Grille transporteur", Scope: model.ScopeParcel, Active: true,
		Rows: []model.RateRow{{Outputs: map[string]model.Components{"cost": {Fixed: 11}}}}})
	f.s.RateCards.Put(model.RateCard{ID: "ZONE-GRID", Name: "Grille zone 38", Scope: model.ScopeParcel, Active: true,
		Rows: []model.RateRow{{Outputs: map[string]model.Components{"cost": {Fixed: 30}}}}})
	setCarrier(t, f, "CAR-STD", func(c *model.Carrier) {
		c.RateCardIDs = []string{"CAR-GRID"}
		c.Schedules = []model.DeliverySchedule{
			{ID: "NAT", Name: "National", PickupDays: []int{1, 2, 3, 4, 5}, Cutoff: tptr("18:00"), DeliveryDays: []int{1, 2, 3, 4, 5, 6}, HonorHolidays: true, Active: true},
			{ID: "J3", Name: "J+3 Isère", Zones: []string{"38"}, TransitDays: iptr(3), WindowStart: tptr("14:00"), WindowEnd: tptr("18:00"), RateCardIDs: []string{"ZONE-GRID"}, HonorHolidays: true, Active: true},
		}
	})
	// Lyon: national planning; the warehouse pickup at 19:00 is capped by
	// the 18:00 cut-off -> picked up Monday 18:00, delivered Wednesday
	lyon := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, lyon)
	o := lyon.Options[0]
	leg := o.Packages[0].Route[0]
	if leg.EstimatedDeparture.Hour() != 18 || o.EstimatedDelivery.To.Day() != 14 {
		t.Fatalf("national planning: departure %v delivery %v", leg.EstimatedDeparture, o.EstimatedDelivery.To)
	}
	if o.Metrics["cost"] != 11+2 { // carrier grid + preparation
		t.Fatalf("carrier grid not applied: %v", o.Metrics)
	}
	// Grenoble (38): zone planning J+3, afternoon window, zone grid
	gre := f.promise(t, req("38000", monday, std, it("SKU-A", 1)))
	requireOptions(t, gre)
	g := gre.Options[0]
	if g.EstimatedDelivery.To.Day() != 15 || g.EstimatedDelivery.From.Hour() != 14 {
		t.Fatalf("zone planning: %v – %v", g.EstimatedDelivery.From, g.EstimatedDelivery.To)
	}
	if g.Metrics["cost"] != 30+2 {
		t.Fatalf("zone grid not applied: %v", g.Metrics)
	}
	// an order on Friday after the cut-off waits for Monday (pickup Mon-Fri)
	fri := f.promise(t, req("69003", at(2026, 10, 16, 15, 30), std, it("SKU-A", 1)))
	requireOptions(t, fri)
	if d := fri.Options[0].Packages[0].Route[0].EstimatedDeparture; d.Weekday() != time.Monday {
		t.Fatalf("expected a Monday pickup, got %v", d)
	}
}
