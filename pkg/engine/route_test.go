package engine_test

import (
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
)

// Carrier routes: origin zone -> destination zone with a cost grid, a
// transit in hours, a weekly planning and restrictions.
func TestCarrierRoutes(t *testing.T) {
	f := pricingFixture(t)
	f.stock(t, "WH-C", "SKU-A", 10)
	f.stock(t, "WH-C", "SKU-E", 10)
	f.disableLeg(t, "C-LH")
	f.disableLeg(t, "C-EXP")
	st := f.s
	st.Zones.Put(model.Zone{ID: "FR", Name: "France", Departments: []string{"*"}, Active: true})
	st.Zones.Put(model.Zone{ID: "ISERE", Name: "Isère", Departments: []string{"38"}, Active: true})
	svc, _ := st.Services.Get("STD")
	svc.Restrictions = nil
	_ = st.Services.Update("STD", svc)
	week := func(start, end string, pickups ...string) *model.RoutePlanning {
		pl := &model.RoutePlanning{Timezone: "Europe/Paris", HonorHolidays: true}
		for wd := 1; wd <= 6; wd++ {
			d := model.RouteDay{Weekday: wd, DeliveryStart: tptr(start), DeliveryEnd: tptr(end)}
			if wd <= 5 {
				for _, p := range pickups {
					d.Pickups = append(d.Pickups, model.MustTOD(p))
				}
			}
			pl.Days = append(pl.Days, d)
		}
		return pl
	}
	grid := func(cost, price float64) *model.RateCard {
		return &model.RateCard{Scope: model.ScopeParcel, Active: true, NoMatch: "REJECT", Rows: []model.RateRow{
			{Conditions: map[string]model.Range{"weightKg": {Max: fp(30)}}, Outputs: map[string]model.Components{"cost": {Fixed: cost}, "price": {Fixed: price}, "carbonKg": {Fixed: 0.12}}},
		}}
	}
	st.CarrierRoutes.Put(model.CarrierRoute{ID: "R-FR", CarrierID: "CAR-STD", ServiceID: "STD", OriginZoneID: "FR", DestinationZoneID: "FR",
		Costs: grid(20, 20), TransitMinHours: 12, TransitMaxHours: 12, Planning: week("05:00", "22:00", "12:00", "18:00"), Active: true})
	st.CarrierRoutes.Put(model.CarrierRoute{ID: "R-38", CarrierID: "CAR-STD", ServiceID: "STD", OriginZoneID: "FR", DestinationZoneID: "ISERE",
		Costs: grid(15, 9), TransitMinHours: 24, TransitMaxHours: 36, Planning: week("08:00", "13:00", "18:00"), Active: true,
		Restrictions: []model.Restriction{{Name: "Pas de matières dangereuses", Mode: model.RestrictExclude, Rules: []model.Rule{{Field: "attributes.hazmat", Op: model.OpExists}}}}})

	// Lyon: France -> France route, pickup at 12:00 or 18:00, 12 h transit,
	// delivered Tuesday in the 05:00-22:00 slot
	lyon := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, lyon)
	o := lyon.Options[0]
	dep := o.Packages[0].Route[0].EstimatedDeparture
	if h := dep.Hour(); (h != 12 && h != 18) || dep.Minute() != 0 {
		t.Fatalf("departure not on a route pickup: %v", dep)
	}
	if o.EstimatedDelivery.To.Day() != 13 || o.EstimatedDelivery.To.Hour() != 22 || o.EstimatedDelivery.From.Before(dep.Add(12*time.Hour)) {
		t.Fatalf("France route slot: %v – %v (departure %v)", o.EstimatedDelivery.From, o.EstimatedDelivery.To, dep)
	}
	if o.Metrics["cost"] != 20+2 || o.Metrics["carbonKg"] != 0.12 {
		t.Fatalf("route grid not applied: %v", o.Metrics)
	}
	// Grenoble: the more specific Isère route wins: pickup 18:00, 36 h max
	// -> Wednesday 06:00, delivered in the Wednesday 08:00-13:00 slot
	gre := f.promise(t, req("38000", monday, std, it("SKU-A", 1)))
	requireOptions(t, gre)
	g := gre.Options[0]
	if d := g.Packages[0].Route[0].EstimatedDeparture; d.Hour() != 18 {
		t.Fatalf("Isère pickup: %v", d)
	}
	if g.EstimatedDelivery.From.Day() != 14 || g.EstimatedDelivery.From.Hour() != 8 || g.EstimatedDelivery.To.Hour() != 13 {
		t.Fatalf("Isère slot: %v – %v", g.EstimatedDelivery.From, g.EstimatedDelivery.To)
	}
	if g.Metrics["cost"] != 15+2 {
		t.Fatalf("Isère grid not applied: %v", g.Metrics)
	}
	// the Isère route refuses hazardous goods, the France route accepts them
	if r := f.promise(t, req("38000", monday, std, it("SKU-E", 1))); len(r.Options) != 0 {
		t.Fatalf("route restriction ignored: %d options", len(r.Options))
	}
	requireOptions(t, f.promise(t, req("69003", monday, std, it("SKU-E", 1))))
	// Saturday order: no pickup before Monday 12:00
	sat := f.promise(t, req("69003", at(2026, 10, 17, 9, 0), std, it("SKU-A", 1)))
	requireOptions(t, sat)
	if d := sat.Options[0].Packages[0].Route[0].EstimatedDeparture; d.Weekday() != time.Monday {
		t.Fatalf("expected a Monday pickup, got %v", d)
	}
}
