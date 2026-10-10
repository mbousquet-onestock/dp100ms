package engine_test

import (
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

var std = []string{"STANDARD"}

func requireOptions(t *testing.T, resp *model.PromiseResponse) {
	t.Helper()
	if len(resp.Options) == 0 {
		t.Fatalf("no option returned, unavailable=%+v", resp.Unavailable)
	}
}

// 1. A SKU available in one store.
func TestSKUInOneStore(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 3)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, resp)
	for _, o := range resp.Options {
		if !sources(o)["STORE-A"] || len(sources(o)) != 1 {
			t.Fatalf("expected STORE-A only, got %v", sources(o))
		}
	}
	// the fastest option uses the shuttle + last mile and is delivered the same day
	best := resp.Options[0]
	if best.EstimatedDelivery.To.Day() != 12 {
		t.Errorf("expected same-day last-mile delivery, got %v", best.EstimatedDelivery)
	}
}

// 2. A SKU available in several stores.
func TestSKUInSeveralStores(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 3)
	f.stock(t, "STORE-B", "SKU-A", 3)
	f.stock(t, "WH-C", "SKU-A", 50)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, resp)
	if resp.Stats.CandidateStockPoints < 3 {
		t.Errorf("expected 3 candidate stock points, got %d", resp.Stats.CandidateStockPoints)
	}
	seen := map[string]bool{}
	for _, o := range resp.Options {
		for s := range sources(o) {
			seen[s] = true
		}
	}
	if len(seen) < 2 {
		t.Errorf("expected alternatives from several stock points, got %v", seen)
	}
}

// 3. Several SKUs in a single store.
func TestBasketSingleStore(t *testing.T) {
	f := newFixture(t)
	for _, s := range []string{"SKU-A", "SKU-B", "SKU-C"} {
		f.stock(t, "STORE-A", s, 5)
	}
	f.stock(t, "STORE-B", "SKU-A", 5)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 2), it("SKU-B", 1), it("SKU-C", 1)))
	requireOptions(t, resp)
	best := resp.Options[0]
	if best.Strategy != "SINGLE_SOURCE" || !sources(best)["STORE-A"] {
		t.Fatalf("expected a single-source option from STORE-A, got %s %v", best.Strategy, sources(best))
	}
	if best.TotalPackages != 1 {
		t.Errorf("expected one package, got %d", best.TotalPackages)
	}
}

// 4. A basket requiring several stores.
func TestBasketRequiresSeveralStores(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 2)
	f.stock(t, "STORE-B", "SKU-B", 1)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 2), it("SKU-B", 1)))
	requireOptions(t, resp)
	for _, o := range resp.Options {
		if len(sources(o)) != 2 {
			t.Fatalf("every option must use STORE-A and STORE-B, got %v", sources(o))
		}
	}
}

// 5. Several packages from the same store.
func TestSeveralPackagesSameStore(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-D", 5) // 8 kg each
	f.disableLeg(t, "A-SH")           // force the standard carrier (30 kg)
	f.disableLeg(t, "A-LH")
	resp := f.promise(t, req("69003", monday, std, it("SKU-D", 5))) // 40 kg
	requireOptions(t, resp)
	o := resp.Options[0]
	if o.TotalPackages < 2 {
		t.Fatalf("40 kg on a 30 kg service needs 2 packages, got %d", o.TotalPackages)
	}
	for _, p := range o.Packages {
		if len(p.SourceStockPoints) != 1 || p.SourceStockPoints[0] != "STORE-A" {
			t.Errorf("package %s should come from STORE-A, got %v", p.PackageID, p.SourceStockPoints)
		}
	}
}

// 6. Consolidation of several sources.
func TestConsolidationOfSeveralSources(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 2)
	f.stock(t, "STORE-B", "SKU-B", 1)
	f.stock(t, "WH-C", "SKU-C", 3)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 2), it("SKU-B", 1), it("SKU-C", 3)))
	requireOptions(t, resp)
	var cons *model.PromiseOption
	for i := range resp.Options {
		if resp.Options[i].Strategy == "CONSOLIDATED" {
			cons = &resp.Options[i]
			break
		}
	}
	if cons == nil {
		t.Fatalf("expected a consolidated option, got %d options", len(resp.Options))
	}
	if len(cons.Consolidations) != 1 {
		t.Fatalf("expected one consolidation, got %d", len(cons.Consolidations))
	}
	if cons.PackagesBeforeConsolidation < 2 {
		t.Errorf("expected >= 2 inbound parcels, got %d", cons.PackagesBeforeConsolidation)
	}
	multi := false
	for _, p := range cons.Packages {
		if len(p.SourceStockPoints) > 1 {
			multi = true
		}
	}
	if !multi {
		t.Errorf("a consolidated package should mix several sources")
	}
	if cons.TotalPackages >= cons.PackagesBeforeConsolidation {
		t.Errorf("consolidation should reduce parcels: %d -> %d", cons.PackagesBeforeConsolidation, cons.TotalPackages)
	}
}

// 7. A three-leg journey.
func TestThreeLegRoute(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 1)
	f.disableLeg(t, "A-STD")
	f.disableLeg(t, "A-SH")
	f.disableLeg(t, "R-REG")
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, resp)
	route := resp.Options[0].Packages[0].Route
	if len(route) != 3 {
		t.Fatalf("expected STORE-A -> HUB-R -> LMH-L -> CUSTOMER, got %d legs", len(route))
	}
	if route[0].To != "HUB-R" || route[1].To != "LMH-L" || route[2].To != model.CustomerNode {
		t.Errorf("unexpected path %s>%s>%s", route[0].To, route[1].To, route[2].To)
	}
}

// 8. A journey using several carriers.
func TestSeveralCarriers(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 1)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, resp)
	for _, o := range resp.Options {
		for _, p := range o.Packages {
			carriers := map[string]bool{}
			for _, l := range p.Route {
				carriers[l.Carrier] = true
			}
			if len(carriers) >= 2 {
				return
			}
		}
	}
	t.Fatal("expected an option combining at least two carriers")
}

// 9. An order after the cut-off.
func TestOrderAfterCutoff(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 1)
	f.disableLeg(t, "A-SH") // isolate the standard carrier route
	f.disableLeg(t, "A-LH")
	before := f.promise(t, req("69003", at(2026, 10, 12, 15, 0), std, it("SKU-A", 1)))
	after := f.promise(t, req("69003", at(2026, 10, 12, 16, 30), std, it("SKU-A", 1)))
	requireOptions(t, before)
	requireOptions(t, after)
	pb, pa := before.Options[0].PreparationGroups[0].ReadyAt, after.Options[0].PreparationGroups[0].ReadyAt
	if pb.Day() != 12 || pa.Day() != 13 {
		t.Errorf("preparation ready before cut-off %v (want 12th), after cut-off %v (want 13th)", pb, pa)
	}
	// before: picked up Mon 17:00 -> Wed 14; after: picked up Tue 17:00 -> Thu 15
	if before.Options[0].EstimatedDelivery.To.Day() != 14 || after.Options[0].EstimatedDelivery.To.Day() != 15 {
		t.Errorf("expected delivery on the 14th before the cut-off and the 15th after, got %v / %v",
			before.Options[0].EstimatedDelivery.To, after.Options[0].EstimatedDelivery.To)
	}
}

// 10. A delivery crossing a weekend.
func TestWeekendCrossing(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "WH-C", "SKU-A", 10)
	friday := at(2026, 10, 16, 16, 0) // after the warehouse cut-off (15:00)
	resp := f.promise(t, req("75011", friday, std, it("SKU-A", 1)))
	requireOptions(t, resp)
	d := resp.Options[0].EstimatedDelivery.To
	if d.Weekday() == time.Sunday {
		t.Fatalf("no delivery on Sunday: %v", d)
	}
	// prepared Monday (warehouse works Mon-Fri), picked up Monday 19:00, +2 days -> Wednesday
	if d.Weekday() != time.Wednesday || d.Day() != 21 {
		t.Errorf("expected Wednesday 21/10, got %v", d)
	}
}

// 11. A delivery crossing a public holiday (Armistice, Wed 11/11/2026).
func TestHolidayCrossing(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "WH-C", "SKU-A", 10)
	resp := f.promise(t, req("75011", at(2026, 11, 9, 10, 0), std, it("SKU-A", 1)))
	requireOptions(t, resp)
	d := resp.Options[0].EstimatedDelivery.To
	// picked up Monday 9th 19:00; working days: Tue 10th, (11th holiday), Thu 12th
	if d.Day() != 12 {
		t.Errorf("expected delivery Thursday 12/11 (11/11 is a holiday), got %v", d)
	}
	for _, o := range resp.Options {
		if o.EstimatedDelivery.To.Day() == 11 && o.EstimatedDelivery.To.Month() == time.November {
			t.Errorf("delivery planned on a public holiday: %v", o.EstimatedDelivery.To)
		}
	}
}

// 12. Quantity above the stock of any single point.
func TestQuantityAboveSinglePoint(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 3)
	f.stock(t, "STORE-B", "SKU-A", 4)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 6)))
	requireOptions(t, resp)
	for _, o := range resp.Options {
		if len(sources(o)) != 2 {
			t.Fatalf("6 units need both stores, got %v", sources(o))
		}
	}
	// and an impossible quantity is reported
	resp2 := f.promise(t, req("69003", monday, std, it("SKU-A", 8)))
	if len(resp2.Options) != 0 || len(resp2.Unavailable) == 0 || resp2.Unavailable[0].Code != "INSUFFICIENT_STOCK" {
		t.Fatalf("expected INSUFFICIENT_STOCK, got %+v", resp2.Unavailable)
	}
}

// 13. A destination that is not served.
func TestDestinationNotServed(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 3)
	for _, pc := range []string{"20000", "97400"} {
		resp := f.promise(t, req(pc, monday, std, it("SKU-A", 1)))
		if len(resp.Options) != 0 {
			t.Fatalf("%s must not be served", pc)
		}
		if len(resp.Unavailable) != 1 || resp.Unavailable[0].Code != "DESTINATION_NOT_SERVED" {
			t.Fatalf("%s: expected DESTINATION_NOT_SERVED, got %+v", pc, resp.Unavailable)
		}
	}
	_, err := f.e.Promise(req("6900", monday, std, it("SKU-A", 1)))
	if err == nil || !strings.Contains(err.Error(), "postal code") {
		t.Fatalf("expected a validation error for a malformed postal code, got %v", err)
	}
}

// 14. A temporarily unavailable hub.
func TestHubTemporarilyUnavailable(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 1)
	f.disableLeg(t, "A-STD")
	f.disableLeg(t, "A-LH")
	base := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, base)
	// maintenance window covering the shuttle arrival (13:00): processing resumes at 18:00
	h, _ := f.s.Hubs.Get("LMH-L")
	h.Unavailability = []model.Unavailability{{From: at(2026, 10, 12, 12, 0), To: at(2026, 10, 12, 18, 0), Reason: "maintenance"}}
	if err := f.s.Hubs.Update("LMH-L", h); err != nil {
		t.Fatal(err)
	}
	delayed := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	requireOptions(t, delayed)
	if !delayed.Options[0].EstimatedDelivery.To.After(base.Options[0].EstimatedDelivery.To) {
		t.Errorf("an unavailable hub must delay the delivery: %v vs %v", delayed.Options[0].EstimatedDelivery.To, base.Options[0].EstimatedDelivery.To)
	}
	// deactivated hub: no route through it any more
	h.Active = false
	h.Unavailability = nil
	_ = f.s.Hubs.Update("LMH-L", h)
	off := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	for _, o := range off.Options {
		for _, p := range o.Packages {
			for _, l := range p.Route {
				if l.To == "LMH-L" || l.From == "LMH-L" {
					t.Fatalf("route through a deactivated hub: %+v", l)
				}
			}
		}
	}
}

// 15. Several routes giving different promises.
func TestRoutesWithDifferentPromises(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 1)
	resp := f.promise(t, req("69003", monday, std, it("SKU-A", 1)))
	windows := map[int64]bool{}
	for _, o := range resp.Options {
		windows[o.EstimatedDelivery.To.Unix()] = true
	}
	if len(windows) < 2 {
		t.Fatalf("expected several distinct promises, got %d options with %d windows", len(resp.Options), len(windows))
	}
	for i := 1; i < len(resp.Options); i++ {
		if resp.Options[i].Score > resp.Options[i-1].Score {
			t.Errorf("options must be sorted by score")
		}
	}
}

// 16. Stock modified during concurrent computations.
func TestConcurrentStockUpdates(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 5)
	f.stock(t, "STORE-B", "SKU-A", 5)
	type key struct {
		v     uint64
		point string
	}
	var mu sync.Mutex
	history := map[key]int{}
	record := func() {
		// called by the single writer right after an update: the version
		// cannot change in between
		v := f.s.Stock.Version()
		for _, p := range []string{"STORE-A", "STORE-B"} {
			l, _ := f.s.Stock.Line(p, "SKU-A")
			history[key{v, p}] = l.Promisable
		}
	}
	mu.Lock()
	record()
	mu.Unlock()
	var stop atomic.Bool
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; !stop.Load(); i++ {
			qa, qb := (i*7)%6, (i*3)%6
			mu.Lock()
			f.s.Stock.Apply([]store.StockUpdate{
				{StockPointID: "STORE-A", SKU: "SKU-A", Physical: &qa},
				{StockPointID: "STORE-B", SKU: "SKU-A", Physical: &qb},
			})
			record()
			mu.Unlock()
		}
	}()
	var responses []*model.PromiseResponse
	var rmu sync.Mutex
	var readers sync.WaitGroup
	for g := 0; g < 8; g++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for i := 0; i < 50; i++ {
				resp, err := f.e.Promise(req("69003", monday, std, it("SKU-A", 4)))
				if err != nil {
					t.Error(err)
					return
				}
				rmu.Lock()
				responses = append(responses, resp)
				rmu.Unlock()
			}
		}()
	}
	readers.Wait()
	stop.Store(true)
	wg.Wait()
	r := req("69003", monday, std, it("SKU-A", 4))
	for _, resp := range responses {
		checkInvariants(t, f, r, resp, func(v uint64, point, sku string) int {
			mu.Lock()
			defer mu.Unlock()
			q, ok := history[key{v, point}]
			if !ok {
				t.Fatalf("unknown stock version %d", v)
			}
			return q
		})
	}
}

// 17. A parcel split required by carrier constraints.
func TestParcelSplitByCarrierConstraints(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "WH-C", "SKU-B", 20) // 1 kg each
	resp := f.promise(t, req("69003", monday, []string{"EXPRESS"}, it("SKU-B", 5)))
	requireOptions(t, resp)
	o := resp.Options[0]
	// express: max 3 items and 10 kg per parcel -> 2 parcels
	if o.TotalPackages != 2 {
		t.Fatalf("expected 2 parcels (max 3 items), got %d", o.TotalPackages)
	}
	for _, p := range o.Packages {
		n := 0
		for _, i := range p.Items {
			n += i.Quantity
		}
		if n > 3 || p.WeightKg > 10 {
			t.Errorf("package %s violates express limits: %d items, %.1f kg", p.PackageID, n, p.WeightKg)
		}
	}
	// an item heavier than every parcel limit of the mode is infeasible
	f.stock(t, "WH-C", "SKU-D", 2) // 8 kg ok, but 2 units cannot share a 10 kg parcel
	resp2 := f.promise(t, req("69003", monday, []string{"EXPRESS"}, it("SKU-D", 2)))
	requireOptions(t, resp2)
	if resp2.Options[0].TotalPackages != 2 {
		t.Errorf("expected 2 parcels for 2 x 8 kg, got %d", resp2.Options[0].TotalPackages)
	}
}

// 18. Consolidation impossible before the last-mile departure.
func TestConsolidationMissesLastMileDeparture(t *testing.T) {
	f := newFixture(t)
	f.stock(t, "STORE-A", "SKU-A", 1)
	f.stock(t, "STORE-B", "SKU-B", 1)
	f.disableLeg(t, "A-LH")
	// orders at 11:00: ready 12:00, too late for the 12:00 shuttle (15 min
	// cut-off) -> 17:30 shuttle, arrival 18:30 at LMH-L, after the 13:30
	// last-mile departure: the consolidated parcel leaves the next day.
	order := at(2026, 10, 12, 11, 0)
	resp := f.promise(t, req("69003", order, std, it("SKU-A", 1), it("SKU-B", 1)))
	requireOptions(t, resp)
	var cons *model.PromiseOption
	for i := range resp.Options {
		if resp.Options[i].Strategy == "CONSOLIDATED" {
			cons = &resp.Options[i]
		}
	}
	if cons == nil {
		t.Fatal("expected a consolidated option")
	}
	c := cons.Consolidations[0]
	var out model.Shipment
	for _, sh := range cons.Shipments {
		if sh.Kind == "OUTBOUND" {
			out = sh
		}
	}
	if c.ReadyAt.Day() != 12 || out.Legs[0].EstimatedDeparture.Day() != 13 {
		t.Errorf("consolidation ready %v, outbound departure %v: the last-mile departure of the 12th must be missed", c.ReadyAt, out.Legs[0].EstimatedDeparture)
	}
	// with a 2 h maximum wait, consolidation is rejected when components
	// arrive too far apart
	h, _ := f.s.Hubs.Get("LMH-L")
	h.MaxConsolidationWaitHours = 2
	_ = f.s.Hubs.Update("LMH-L", h)
	f.stock(t, "STORE-B", "SKU-B", 0)
	f.stock(t, "LMH-L", "SKU-B", 1) // B is now already at the hub (ready 11:30)
	resp2 := f.promise(t, req("69003", order, std, it("SKU-A", 1), it("SKU-B", 1)))
	for _, o := range resp2.Options {
		for _, cc := range o.Consolidations {
			if cc.HubID == "LMH-L" {
				t.Errorf("consolidation at LMH-L should be rejected (wait > 2 h): last arrival %v", cc.LastArrival)
			}
		}
	}
}
