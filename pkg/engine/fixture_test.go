package engine_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/engine"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
	"github.com/onestock/dp100ms/pkg/store"
)

// The fixture is a small, fully controlled network around Lyon:
//
//	STORE-A ─┬─ STD ──────────────────────────────► CUSTOMER
//	         ├─ SHUTTLE ─► LMH-L ─ LASTMILE (69) ──► CUSTOMER
//	         └─ LINEHAUL ─► HUB-R ─ LINEHAUL ─► LMH-L
//	STORE-B ─┬─ STD ──────────────────────────────► CUSTOMER
//	         └─ SHUTTLE ─► LMH-L
//	WH-C ────┬─ STD / EXPRESS ────────────────────► CUSTOMER
//	         └─ LINEHAUL ─► HUB-R
//	HUB-R ───── REGIONAL (69, 38) ────────────────► CUSTOMER
var paris = calendar.Paris()

func at(y int, m time.Month, d, hh, mm int) time.Time {
	return time.Date(y, m, d, hh, mm, 0, 0, paris)
}

var monday = at(2026, 10, 12, 10, 0)

func tod(s string) model.TimeOfDay { return model.MustTOD(s) }

func cal(days ...int) model.Calendar { return model.Calendar{WorkingDays: days, HonorHolidays: true} }

type fixture struct {
	s *store.Store
	e *engine.Engine
}

func newFixture(t testing.TB) *fixture {
	t.Helper()
	s := store.New()
	for _, m := range []model.DeliveryMode{
		{ID: "STANDARD", Name: "Standard", MaxLegs: 3, MaxSources: 3, AllowConsolidation: true, AllowSplit: true, MaxDeliveryDays: 10, Active: true},
		{ID: "EXPRESS", Name: "Express", MaxLegs: 2, MaxSources: 2, AllowConsolidation: false, AllowSplit: true, MaxDeliveryDays: 5, Active: true},
	} {
		s.Modes.LoadRaw(m)
	}
	for _, c := range []string{"CAR-STD", "CAR-EXP", "CAR-LM", "CAR-LH", "CAR-SH", "CAR-REG"} {
		s.Carriers.LoadRaw(model.Carrier{ID: c, Name: c, Active: true})
	}
	monSat := []int{1, 2, 3, 4, 5, 6}
	monFri := []int{1, 2, 3, 4, 5}
	for _, sv := range []model.CarrierService{
		{ID: "STD", CarrierID: "CAR-STD", Name: "Standard", Kind: model.KindStandard, Modes: []string{"STANDARD"}, Coverage: []string{"*"}, ExcludedCoverage: []string{"20"},
			TransitDays: 2, PickupCalendar: cal(monFri...), DeliveryCalendar: cal(monSat...), WindowStart: tod("09:00"), WindowEnd: tod("18:00"), MaxWeightKg: 30, BaseCost: 6, CostPerKg: 0.5, Active: true},
		{ID: "EXP", CarrierID: "CAR-EXP", Name: "Express", Kind: model.KindExpress, Modes: []string{"EXPRESS"}, Coverage: []string{"*"},
			TransitDays: 1, PickupCalendar: cal(monFri...), DeliveryCalendar: cal(monFri...), WindowStart: tod("08:00"), WindowEnd: tod("13:00"), MaxWeightKg: 10, MaxItems: 3, BaseCost: 12, CostPerKg: 1, Active: true},
		{ID: "LM", CarrierID: "CAR-LM", Name: "Last mile", Kind: model.KindLastMile, Modes: []string{"STANDARD"}, Coverage: []string{"69"},
			TransitDays: 0, PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), WindowStart: tod("14:00"), WindowEnd: tod("20:00"), MaxWeightKg: 15, BaseCost: 5, Active: true},
		{ID: "LH", CarrierID: "CAR-LH", Name: "Linehaul", Kind: model.KindLinehaul, Coverage: []string{"*"}, TransitMinutes: 300,
			PickupCalendar: cal(monFri...), DeliveryCalendar: cal(1, 2, 3, 4, 5, 6, 7), MaxWeightKg: 30, BaseCost: 1, Active: true},
		{ID: "SH", CarrierID: "CAR-SH", Name: "Shuttle", Kind: model.KindShuttle, Coverage: []string{"*"}, TransitMinutes: 60,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), MaxWeightKg: 30, BaseCost: 0.5, Active: true},
		{ID: "REG", CarrierID: "CAR-REG", Name: "Regional", Kind: model.KindHome, Modes: []string{"STANDARD"}, Coverage: []string{"69", "38"},
			TransitDays: 1, PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), WindowStart: tod("09:00"), WindowEnd: tod("18:00"), MaxWeightKg: 30, BaseCost: 4, Active: true},
	} {
		s.Services.LoadRaw(sv)
	}
	store := func(id string, lat, lon float64) model.StockPoint {
		return model.StockPoint{ID: id, Name: id, Type: model.StockPointStore, Address: model.Address{PostalCode: "69002", City: "Lyon", Country: "FR"},
			Lat: lat, Lon: lon, Timezone: "Europe/Paris", OpeningTime: tod("09:00"), ClosingTime: tod("19:00"), PrepCalendar: cal(monSat...),
			PrepTimeMinutes: 60, Cutoff: tod("16:00"), DailyCapacity: 100, SafetyStock: 0, PrepCostPerParcel: 2, Active: true}
	}
	s.StockPoints.LoadRaw(store("STORE-A", 45.76, 4.83))
	s.StockPoints.LoadRaw(store("STORE-B", 45.77, 4.85))
	wh := store("WH-C", 45.70, 4.94)
	wh.Type = model.StockPointWarehouse
	wh.OpeningTime, wh.ClosingTime, wh.Cutoff, wh.PrepTimeMinutes = tod("06:00"), tod("22:00"), tod("15:00"), 120
	wh.PrepCalendar = cal(monFri...)
	s.StockPoints.LoadRaw(wh)
	lmh := store("LMH-L", 45.73, 4.84)
	lmh.Type = model.StockPointLastMileHub
	lmh.OpeningTime, lmh.ClosingTime, lmh.Cutoff, lmh.PrepTimeMinutes = tod("05:00"), tod("23:00"), tod("20:00"), 30
	s.StockPoints.LoadRaw(lmh)
	s.Hubs.LoadRaw(model.Hub{ID: "LMH-L", Name: "LMH Lyon", Kind: model.HubLastMile, StockPointID: "LMH-L", Calendar: cal(monSat...),
		OpeningTime: tod("04:00"), ClosingTime: tod("23:00"), SortingMinutes: 30, ConsolidationEnabled: true, ConsolidationMinutes: 30, ConsolidationCost: 0.5, Active: true})
	s.Hubs.LoadRaw(model.Hub{ID: "HUB-R", Name: "Regional hub", Kind: model.HubConsolidation, Calendar: cal(monFri...),
		OpeningTime: tod("00:00"), ClosingTime: tod("24:00"), SortingMinutes: 60, ConsolidationEnabled: true, ConsolidationMinutes: 60, ConsolidationCost: 0.8, Active: true})
	legs := []model.Leg{
		{ID: "A-STD", From: "STORE-A", To: model.CustomerNode, CarrierID: "CAR-STD", ServiceID: "STD", Departures: []model.TimeOfDay{tod("17:00")}},
		{ID: "B-STD", From: "STORE-B", To: model.CustomerNode, CarrierID: "CAR-STD", ServiceID: "STD", Departures: []model.TimeOfDay{tod("17:00")}},
		{ID: "C-STD", From: "WH-C", To: model.CustomerNode, CarrierID: "CAR-STD", ServiceID: "STD", Departures: []model.TimeOfDay{tod("19:00")}},
		{ID: "C-EXP", From: "WH-C", To: model.CustomerNode, CarrierID: "CAR-EXP", ServiceID: "EXP", Departures: []model.TimeOfDay{tod("18:00")}},
		{ID: "A-SH", From: "STORE-A", To: "LMH-L", CarrierID: "CAR-SH", ServiceID: "SH", Departures: []model.TimeOfDay{tod("12:00"), tod("17:30")}, CutoffMinutesBefore: 15},
		{ID: "B-SH", From: "STORE-B", To: "LMH-L", CarrierID: "CAR-SH", ServiceID: "SH", Departures: []model.TimeOfDay{tod("12:00"), tod("17:30")}, CutoffMinutesBefore: 15},
		{ID: "L-LM", From: "LMH-L", To: model.CustomerNode, CarrierID: "CAR-LM", ServiceID: "LM", Departures: []model.TimeOfDay{tod("13:30")}},
		{ID: "A-LH", From: "STORE-A", To: "HUB-R", CarrierID: "CAR-LH", ServiceID: "LH", Departures: []model.TimeOfDay{tod("18:30")}},
		{ID: "C-LH", From: "WH-C", To: "HUB-R", CarrierID: "CAR-LH", ServiceID: "LH", Departures: []model.TimeOfDay{tod("20:00")}},
		{ID: "R-LH", From: "HUB-R", To: "LMH-L", CarrierID: "CAR-LH", ServiceID: "LH", Departures: []model.TimeOfDay{tod("03:00")}, TransitMinutes: 120},
		{ID: "R-REG", From: "HUB-R", To: model.CustomerNode, CarrierID: "CAR-REG", ServiceID: "REG", Departures: []model.TimeOfDay{tod("06:00")}},
	}
	for _, l := range legs {
		l.Active = true
		s.Legs.LoadRaw(l)
	}
	s.LoadSettingsRaw(model.DefaultSettings())
	skus := []model.SKU{
		{Code: "SKU-A", Name: "A", Category: "Mode", WeightKg: 0.5, VolumeL: 2},
		{Code: "SKU-B", Name: "B", Category: "Mode", WeightKg: 1, VolumeL: 3},
		{Code: "SKU-C", Name: "C", Category: "Maison", WeightKg: 2, VolumeL: 5},
		{Code: "SKU-D", Name: "D heavy", Category: "Bricolage", WeightKg: 8, VolumeL: 20},
		{Code: "SKU-E", Name: "E", Category: "Beauté", WeightKg: 0.2, VolumeL: 1},
	}
	s.InitStock(skus)
	s.BumpConfig()
	return &fixture{s: s, e: engine.New(s)}
}

func (f *fixture) stock(t testing.TB, point, sku string, qty int) {
	t.Helper()
	if err := f.s.Stock.Set(point, sku, qty, 0, true); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) disableLeg(t testing.TB, id string) {
	t.Helper()
	l, ok := f.s.Legs.Get(id)
	if !ok {
		t.Fatalf("no leg %s", id)
	}
	l.Active = false
	if err := f.s.Legs.Update(id, l); err != nil {
		t.Fatal(err)
	}
}

func req(pc string, order time.Time, modes []string, items ...model.BasketItem) *model.PromiseRequest {
	return &model.PromiseRequest{Destination: model.Destination{Country: "FR", PostalCode: pc}, OrderDate: order, Items: items, DeliveryModes: modes, MaxOptions: 20}
}

func it(sku string, q int) model.BasketItem { return model.BasketItem{SKU: sku, Quantity: q} }

func (f *fixture) promise(t testing.TB, r *model.PromiseRequest) *model.PromiseResponse {
	t.Helper()
	resp, err := f.e.Promise(r)
	if err != nil {
		t.Fatal(err)
	}
	checkInvariants(t, f, r, resp, nil)
	return resp
}

// checkInvariants verifies the global promise invariants on every option.
// stockAt optionally provides the promisable stock of the snapshot version.
func checkInvariants(t testing.TB, f *fixture, r *model.PromiseRequest, resp *model.PromiseResponse, stockAt func(version uint64, point, sku string) int) {
	t.Helper()
	want := map[string]int{}
	for _, i := range r.Items {
		want[i.SKU] += i.Quantity
	}
	net := f.e.Network()
	for _, o := range resp.Options {
		ctx := fmt.Sprintf("option %s (%s/%s)", o.ID, o.DeliveryMode, o.Strategy)
		// 1-3. nothing forgotten, nothing duplicated, allocations == basket
		inPkgs := map[string]int{}
		for _, p := range o.Packages {
			for _, i := range p.Items {
				inPkgs[i.SKU] += i.Quantity
			}
		}
		alloc := map[string]int{}
		for _, a := range o.Allocations {
			alloc[a.SKU] += a.Quantity
			// 4. no allocation above the snapshot stock
			var avail int
			if stockAt != nil {
				avail = stockAt(resp.Stats.StockVersion, a.StockPointID, a.SKU)
			} else {
				l, err := f.s.Stock.Line(a.StockPointID, a.SKU)
				if err != nil {
					t.Fatalf("%s: %v", ctx, err)
				}
				avail = l.Promisable
			}
			if a.Quantity > avail {
				t.Errorf("%s: allocation %s/%s=%d exceeds promisable stock %d", ctx, a.StockPointID, a.SKU, a.Quantity, avail)
			}
		}
		for sku, q := range want {
			if inPkgs[sku] != q {
				t.Errorf("%s: packages carry %d x %s, basket wants %d", ctx, inPkgs[sku], sku, q)
			}
			if alloc[sku] != q {
				t.Errorf("%s: allocations %d x %s, basket wants %d", ctx, alloc[sku], sku, q)
			}
		}
		for sku := range inPkgs {
			if _, ok := want[sku]; !ok {
				t.Errorf("%s: unexpected sku %s in packages", ctx, sku)
			}
		}
		if o.TotalPackages != len(o.Packages) {
			t.Errorf("%s: totalPackages %d != %d packages", ctx, o.TotalPackages, len(o.Packages))
		}
		// 5. route constraints, 7. promise never before the last leg
		var latest time.Time
		for _, sh := range o.Shipments {
			var prev time.Time
			for li, lr := range sh.Legs {
				leg := net.LegByID[lr.LegID]
				if leg == nil {
					t.Fatalf("%s: unknown leg %s", ctx, lr.LegID)
				}
				if li > 0 && lr.From != sh.Legs[li-1].To {
					t.Errorf("%s: discontinuous route at %s", ctx, lr.LegID)
				}
				if lr.EstimatedDeparture.Before(prev) {
					t.Errorf("%s: leg %s departs %v before previous arrival %v", ctx, lr.LegID, lr.EstimatedDeparture, prev)
				}
				if !leg.Plan(r.Destination.PostalCode[:2]).PickupCal.IsWorking(calendar.DayOf(lr.EstimatedDeparture.In(paris))) {
					t.Errorf("%s: leg %s departs on a non-working day %v", ctx, lr.LegID, lr.EstimatedDeparture)
				}
				dep := model.TimeOfDay(lr.EstimatedDeparture.In(paris).Hour()*60 + lr.EstimatedDeparture.In(paris).Minute())
				found := false
				for _, d := range leg.Plan(r.Destination.PostalCode[:2]).Departures {
					if d == dep {
						found = true
					}
				}
				if !found {
					t.Errorf("%s: leg %s departs at %v which is not a scheduled departure", ctx, lr.LegID, dep)
				}
				if !lr.EstimatedArrival.After(lr.EstimatedDeparture) {
					t.Errorf("%s: leg %s arrives before it departs", ctx, lr.LegID)
				}
				if leg.Final {
					if !leg.Plan(r.Destination.PostalCode[:2]).DeliveryCal.IsWorking(calendar.DayOf(lr.EstimatedArrival.In(paris))) {
						t.Errorf("%s: delivery on a non-delivery day %v", ctx, lr.EstimatedArrival)
					}
					if !leg.ServesDept(r.Destination.PostalCode[:2]) {
						t.Errorf("%s: leg %s does not serve %s", ctx, lr.LegID, r.Destination.PostalCode)
					}
				}
				prev = lr.EstimatedArrival
			}
			if sh.Kind != "INBOUND" && prev.After(latest) {
				latest = prev
			}
		}
		if o.EstimatedDelivery.To.Before(latest) {
			t.Errorf("%s: promise %v before the end of the last leg %v", ctx, o.EstimatedDelivery.To, latest)
		}
		if o.EstimatedDelivery.From.After(o.EstimatedDelivery.To) {
			t.Errorf("%s: window from > to", ctx)
		}
		for _, p := range o.Packages {
			lastTo := p.Route[len(p.Route)-1].EstimatedArrival
			if o.EstimatedDelivery.To.Before(lastTo) {
				t.Errorf("%s: package %s arrives after the promise", ctx, p.PackageID)
			}
			for _, lr := range p.Route {
				leg := net.LegByID[lr.LegID]
				if leg.MaxWeightKg > 0 && p.WeightKg > leg.MaxWeightKg+1e-6 && !isInbound(o, lr.LegID) {
					t.Errorf("%s: package %s weighs %.2f kg on leg %s limited to %.2f", ctx, p.PackageID, p.WeightKg, lr.LegID, leg.MaxWeightKg)
				}
			}
		}
		// 6. consolidation after the arrival of every component
		for _, c := range o.Consolidations {
			for _, sid := range c.InboundShipments {
				for _, sh := range o.Shipments {
					if sh.ID == sid {
						arr := sh.Legs[len(sh.Legs)-1].EstimatedArrival
						if c.ReadyAt.Before(arr) || c.LastArrival.Before(arr) {
							t.Errorf("%s: consolidation ready %v before inbound %s arrival %v", ctx, c.ReadyAt, sid, arr)
						}
					}
				}
			}
			for _, sh := range o.Shipments {
				if sh.Kind == "OUTBOUND" && sh.Legs[0].EstimatedDeparture.Before(c.ReadyAt) {
					t.Errorf("%s: outbound leaves %v before consolidation ready %v", ctx, sh.Legs[0].EstimatedDeparture, c.ReadyAt)
				}
			}
		}
	}
}

func isInbound(o model.PromiseOption, legID string) bool {
	for _, sh := range o.Shipments {
		if sh.Kind != "INBOUND" {
			continue
		}
		for _, l := range sh.Legs {
			if l.LegID == legID {
				return true
			}
		}
	}
	return false
}

func sources(o model.PromiseOption) map[string]bool {
	m := map[string]bool{}
	for _, a := range o.Allocations {
		m[a.StockPointID] = true
	}
	return m
}

var _ = network.Dept
