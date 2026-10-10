package engine

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
)

const (
	StrategySingle       = "SINGLE_SOURCE"
	StrategyMultiDirect  = "MULTI_SOURCE_DIRECT"
	StrategyConsolidated = "CONSOLIDATED"
)

// shipPlan is a set of parcels travelling together on one path.
type shipPlan struct {
	kind    string // DIRECT | INBOUND | OUTBOUND
	origin  string
	path    *network.Path
	timing  *pathTiming
	groups  []group
	parcels []parcel
	cost    float64
	ready   int64
}

type consPlan struct {
	hub         *network.Node
	inbound     []int // indexes into plan.ships
	firstArr    int64
	lastArrival int64
	ready       int64
	outbound    int
	cost        float64
}

type plan struct {
	mode           string
	strategy       string
	alloc          *allocation
	cands          []candidate
	ships          []*shipPlan
	cons           *consPlan
	window         win
	cost           float64
	packagesFinal  int
	packagesBefore int
	legs           int
	sources        int
	score          float64
}

func (p *plan) signature() uint64 {
	h := mix(p.alloc.sig)
	for _, str := range [2]string{p.mode, p.strategy} {
		for i := 0; i < len(str); i++ {
			h = mix(h ^ uint64(str[i]))
		}
		h = mix(h ^ 0xff)
	}
	for _, s := range p.ships {
		h = mix(h ^ uint64(s.path.ID))
	}
	return h
}

func (c *reqCtx) groupsFor(a *allocation, si int, cands []candidate) []group {
	var gs []group
	for i, q := range a.qty[si] {
		if q > 0 {
			gs = append(gs, group{item: i, source: cands[a.sources[si]].node.ID, qty: q})
		}
	}
	return gs
}

func (c *reqCtx) limits(p *network.Path) packLimits {
	lim := packLimits{maxW: p.MaxW, maxV: p.MaxV, maxItems: p.MaxItems}
	if cs := c.req.Constraints; cs != nil {
		lim = lim.tighten(cs.MaxWeightKg, cs.MaxItems)
	}
	return lim
}

// pathCost is the transport cost of parcels on a path.
func pathCost(p *network.Path, parcels []parcel) float64 {
	cost := 0.0
	for _, l := range p.Legs {
		for _, pc := range parcels {
			cost += l.Service.BaseCost + l.ExtraCost + l.Service.CostPerKg*pc.weight
		}
	}
	return cost
}

// bestShipment picks the best path from an origin for a set of groups.
func (c *reqCtx) bestShipment(kind, origin string, paths []*network.Path, ready int64, groups []group, cheapest bool) *shipPlan {
	var best *shipPlan
	better := func(a, b *shipPlan) bool {
		ta, tb := a.timing.window.To, b.timing.window.To
		if cheapest {
			if math.Abs(a.cost-b.cost) > 0.005 {
				return a.cost < b.cost
			}
			return ta < tb
		}
		if ta != tb {
			return ta < tb
		}
		return a.cost < b.cost
	}
	type packed struct {
		lim     packLimits
		parcels []parcel
		ok      bool
	}
	var memo []packed // paths often share the same parcel limits
	for _, p := range paths {
		if !c.postalOK(p) {
			continue
		}
		pt := c.traverse(p, ready)
		if !pt.ok {
			continue
		}
		// a slower path cannot win in fastest mode: skip packing it
		if !cheapest && best != nil && pt.window.To > best.timing.window.To {
			continue
		}
		lim := c.limits(p)
		var parcels []parcel
		ok, found := false, false
		for _, m := range memo {
			if m.lim == lim {
				parcels, ok, found = m.parcels, m.ok, true
				break
			}
		}
		if !found {
			parcels, ok = c.pack(groups, lim)
			memo = append(memo, packed{lim, parcels, ok})
		}
		if !ok {
			continue
		}
		sp := &shipPlan{kind: kind, origin: origin, path: p, timing: pt, groups: groups, parcels: parcels, ready: ready}
		sp.cost = pathCost(p, parcels)
		if best == nil || better(sp, best) {
			best = sp
		}
	}
	return best
}

func (c *reqCtx) postalOK(p *network.Path) bool {
	last := p.Legs[len(p.Legs)-1]
	if !last.Final {
		return true
	}
	return last.ServesPostalCode(c.postal)
}

func prepCost(node *network.Node, parcels int) float64 {
	if node.StockPoint == nil {
		return 0
	}
	return node.StockPoint.PrepCostPerParcel * float64(parcels)
}

// planDirect ships every source's goods directly (possibly through transit
// hubs) to the customer, without consolidation.
func (c *reqCtx) planDirect(mode string, dr *network.DestRoutes, cands []candidate, a *allocation, cheapest bool) *plan {
	p := &plan{mode: mode, alloc: a, cands: cands, sources: len(a.sources)}
	if len(a.sources) == 1 {
		p.strategy = StrategySingle
	} else {
		p.strategy = StrategyMultiDirect
	}
	for si, ci := range a.sources {
		cd := cands[ci]
		groups := c.groupsFor(a, si, cands)
		sp := c.bestShipment("DIRECT", cd.node.ID, dr.ByIdx[cd.node.Idx], cd.ready, groups, cheapest)
		if sp == nil {
			return nil
		}
		p.ships = append(p.ships, sp)
		p.cost += sp.cost + prepCost(cd.node, len(sp.parcels))
		p.packagesFinal += len(sp.parcels)
		p.legs += len(sp.path.Legs)
		if sp.timing.window.To > p.window.To {
			p.window.To = sp.timing.window.To
		}
		if sp.timing.window.From > p.window.From {
			p.window.From = sp.timing.window.From
		}
	}
	p.packagesBefore = p.packagesFinal
	if p.window.From > p.window.To {
		p.window.From = p.window.To
	}
	return p
}

// planConsolidated evaluates every consolidation hub: each source ships to
// the hub, goods are consolidated once the last component has arrived
// (+ consolidation time), then repacked and shipped on the hub's best path.
func (c *reqCtx) planConsolidated(mode string, dr *network.DestRoutes, cands []candidate, a *allocation) []*plan {
	type scored struct {
		p   *plan
		eta int64
	}
	var out []scored
	for _, hub := range c.net.ConsolidationHubs {
		outPaths := dr.ByIdx[hub.Idx]
		if len(outPaths) == 0 {
			continue
		}
		h := hub.Hub
		p := &plan{mode: mode, strategy: StrategyConsolidated, alloc: a, cands: cands, sources: len(a.sources)}
		cons := &consPlan{hub: hub}
		var allGroups []group
		ok := true
		for si, ci := range a.sources {
			cd := cands[ci]
			groups := c.groupsFor(a, si, cands)
			allGroups = append(allGroups, groups...)
			var arrival int64
			if cd.node.ID == hub.ID {
				arrival = cd.ready // hub is itself a stock point
				p.cost += prepCost(cd.node, 0)
			} else {
				sp := c.bestShipment("INBOUND", cd.node.ID, hub.Inbound[cd.node.Idx], cd.ready, groups, false)
				if sp == nil {
					ok = false
					break
				}
				arrival = sp.timing.window.To // reception time at the hub
				cons.inbound = append(cons.inbound, len(p.ships))
				p.ships = append(p.ships, sp)
				p.cost += sp.cost + prepCost(cd.node, len(sp.parcels))
				p.packagesBefore += len(sp.parcels)
				p.legs += len(sp.path.Legs)
			}
			if arrival > cons.lastArrival {
				cons.lastArrival = arrival
			}
			if cons.firstArr == 0 || arrival < cons.firstArr {
				cons.firstArr = arrival
			}
		}
		if !ok || len(cons.inbound) == 0 {
			continue
		}
		if h.MaxConsolidationWaitHours > 0 && cons.lastArrival-cons.firstArr > int64(h.MaxConsolidationWaitHours)*3600 {
			continue
		}
		recv, okr := c.hubReception(h, cons.lastArrival)
		if !okr {
			continue
		}
		cons.ready = recv + int64(h.ConsolidationMinutes)*60
		outbound := c.bestShipment("OUTBOUND", hub.ID, outPaths, cons.ready, allGroups, false)
		if outbound == nil {
			continue
		}
		cons.outbound = len(p.ships)
		p.ships = append(p.ships, outbound)
		cons.cost = h.ConsolidationCost * float64(p.packagesBefore)
		p.cost += outbound.cost + cons.cost
		p.packagesFinal = len(outbound.parcels)
		// a hub that is also a source prepares its own items into the
		// consolidated parcels
		p.legs += len(outbound.path.Legs)
		p.window = outbound.timing.window
		p.cons = cons
		out = append(out, scored{p, p.window.To})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].eta != out[j].eta {
			return out[i].eta < out[j].eta
		}
		return out[i].p.cost < out[j].p.cost
	})
	maxHubs := c.net.Settings.MaxHubsPerPlan
	if maxHubs <= 0 {
		maxHubs = 3
	}
	var plans []*plan
	for i := 0; i < len(out) && i < maxHubs; i++ {
		plans = append(plans, out[i].p)
	}
	return plans
}

// scorePlans normalises the criteria within a mode (min-max) and computes
// score = 1 - weighted normalised penalty, then sorts best first.
func scorePlans(plans []*plan, w model.ScoringWeights) {
	if len(plans) == 0 {
		return
	}
	type crit struct{ v [5]float64 }
	vals := make([]crit, len(plans))
	var mn, mx [5]float64
	for i := range mn {
		mn[i] = math.Inf(1)
		mx[i] = math.Inf(-1)
	}
	for i, p := range plans {
		v := [5]float64{float64(p.window.To) / 3600, float64(p.packagesFinal), p.cost, float64(p.legs), float64(p.sources)}
		vals[i].v = v
		for j := range v {
			mn[j] = math.Min(mn[j], v[j])
			mx[j] = math.Max(mx[j], v[j])
		}
	}
	ws := [5]float64{w.DeliveryTime, w.Packages, w.Cost, w.Legs, w.Sources}
	total := 0.0
	for _, x := range ws {
		total += x
	}
	if total <= 0 {
		total = 1
		ws = [5]float64{1, 0, 0, 0, 0}
	}
	for i, p := range plans {
		pen := 0.0
		for j := range ws {
			if mx[j] > mn[j] {
				pen += ws[j] * (vals[i].v[j] - mn[j]) / (mx[j] - mn[j])
			}
		}
		p.score = math.Round((1-pen/total)*1000) / 1000
	}
	sort.SliceStable(plans, func(a, b int) bool {
		if plans[a].score != plans[b].score {
			return plans[a].score > plans[b].score
		}
		if plans[a].window.To != plans[b].window.To {
			return plans[a].window.To < plans[b].window.To
		}
		return plans[a].cost < plans[b].cost
	})
}

// ---------------------------------------------------------------------------
// Response building

func round2(x float64) float64 { return math.Round(x*100) / 100 }

func (c *reqCtx) legResults(lts []legTime, parcels []parcel) []model.LegResult {
	out := make([]model.LegResult, len(lts))
	for i, lt := range lts {
		cost := 0.0
		for _, pc := range parcels {
			cost += lt.leg.Service.BaseCost + lt.leg.ExtraCost + lt.leg.Service.CostPerKg*pc.weight
		}
		out[i] = model.LegResult{
			LegID: lt.leg.ID, From: lt.leg.From, To: lt.leg.To, Carrier: lt.leg.Carrier.ID, CarrierName: lt.leg.Carrier.Name,
			Service: lt.leg.Service.ID, ServiceKind: lt.leg.Service.Kind,
			EstimatedDeparture: c.clk.Time(lt.dep), EstimatedArrival: c.clk.Time(lt.arr), Cost: round2(cost),
		}
	}
	return out
}

func (c *reqCtx) parcelItems(groups []group, pc parcel) ([]model.BasketItem, []string) {
	qty := map[int]int{}
	var order []int
	srcSet := map[string]bool{}
	var srcs []string
	for gi, q := range pc.qty {
		if q == 0 {
			continue
		}
		g := groups[gi]
		if _, ok := qty[g.item]; !ok {
			order = append(order, g.item)
		}
		qty[g.item] += q
		if !srcSet[g.source] {
			srcSet[g.source] = true
			srcs = append(srcs, g.source)
		}
	}
	sort.Ints(order)
	items := make([]model.BasketItem, len(order))
	for i, it := range order {
		items[i] = model.BasketItem{SKU: c.items[it].code, Quantity: qty[it]}
	}
	sort.Strings(srcs)
	return items, srcs
}

func groupsItems(c *reqCtx, groups []group) []model.BasketItem {
	pc := parcel{qty: make([]int, len(groups))}
	for i, g := range groups {
		pc.qty[i] = g.qty
	}
	items, _ := c.parcelItems(groups, pc)
	return items
}

func (c *reqCtx) buildOption(p *plan, n int) model.PromiseOption {
	loc := c.net.Loc
	opt := model.PromiseOption{
		ID: fmt.Sprintf("option-%d", n), DeliveryMode: p.mode, Strategy: p.strategy,
		EstimatedDelivery: model.TimeWindow{From: c.clk.Time(p.window.From), To: c.clk.Time(p.window.To)},
		TotalPackages:     p.packagesFinal, PackagesBeforeConsolidation: p.packagesBefore,
		TotalCost: round2(p.cost), Currency: "EUR", Score: p.score,
		Packages: []model.PackageResult{}, Shipments: []model.Shipment{}, Consolidations: []model.ConsolidationResult{},
	}
	opt.Criteria = model.ScoreBreakdown{
		DeliveryHours: math.Round(float64(p.window.To-c.orderU)/360) / 10,
		Packages:      p.packagesFinal, Cost: round2(p.cost), Legs: p.legs, Sources: p.sources,
	}
	// allocations & preparation groups
	for si, ci := range p.alloc.sources {
		cd := p.cands[ci]
		groups := c.groupsFor(p.alloc, si, p.cands)
		for _, g := range groups {
			opt.Allocations = append(opt.Allocations, model.Allocation{StockPointID: cd.node.ID, SKU: c.items[g.item].code, Quantity: g.qty})
		}
		parcels := 0
		for _, s := range p.ships {
			if s.origin == cd.node.ID && s.kind != "OUTBOUND" {
				parcels += len(s.parcels)
			}
		}
		if p.cons != nil && p.cons.hub.ID == cd.node.ID {
			parcels = 0 // prepared directly into the consolidated parcels
		}
		opt.PreparationGroups = append(opt.PreparationGroups, model.PreparationGroup{
			ID: fmt.Sprintf("PREP-%03d", si+1), StockPointID: cd.node.ID, Items: groupsItems(c, groups),
			ReadyAt: c.clk.Time(cd.ready), Parcels: parcels,
		})
	}
	opt.Timeline = append(opt.Timeline, model.TimelineEvent{At: c.order, Type: "ORDER", Node: model.CustomerNode, Description: "Order placed"})
	for _, pg := range opt.PreparationGroups {
		opt.Timeline = append(opt.Timeline, model.TimelineEvent{At: pg.ReadyAt, Type: "PREPARATION_READY", Node: pg.StockPointID, Description: "Preparation ready at " + c.nodeName(pg.StockPointID)})
	}
	pkgSeq, shipSeq := 0, 0
	inboundLegs := map[string][]model.LegResult{} // source -> inbound legs
	inboundShipIDs := []string{}
	for _, s := range p.ships {
		shipSeq++
		shipID := fmt.Sprintf("SHP-%03d", shipSeq)
		legs := c.legResults(s.timing.legs, s.parcels)
		sh := model.Shipment{ID: shipID, Kind: s.kind, Origin: s.origin, Destination: s.path.Legs[len(s.path.Legs)-1].To, Items: groupsItems(c, s.groups), Legs: legs}
		for _, lr := range legs {
			opt.Timeline = append(opt.Timeline,
				model.TimelineEvent{At: lr.EstimatedDeparture, Type: "DEPARTURE", Node: lr.From, Description: fmt.Sprintf("%s departs %s (%s)", shipID, c.nodeName(lr.From), lr.CarrierName)})
			if lr.To != model.CustomerNode {
				opt.Timeline = append(opt.Timeline,
					model.TimelineEvent{At: lr.EstimatedArrival, Type: "ARRIVAL", Node: lr.To, Description: fmt.Sprintf("%s arrives at %s", shipID, c.nodeName(lr.To))})
			}
		}
		switch s.kind {
		case "INBOUND":
			inboundLegs[s.origin] = append(inboundLegs[s.origin], legs...)
			inboundShipIDs = append(inboundShipIDs, shipID)
			opt.Shipments = append(opt.Shipments, sh)
		default:
			var pkgIDs []string
			for _, pc := range s.parcels {
				pkgSeq++
				pkgID := fmt.Sprintf("PKG-%03d", pkgSeq)
				pkgIDs = append(pkgIDs, pkgID)
				items, srcs := c.parcelItems(s.groups, pc)
				route := []model.LegResult{}
				if s.kind == "OUTBOUND" {
					for _, src := range srcs {
						route = append(route, inboundLegs[src]...)
					}
				}
				route = append(route, legs...)
				pr := model.PackageResult{
					PackageID: pkgID, Items: items, SourceStockPoints: srcs, WeightKg: round2(pc.weight), VolumeL: round2(pc.volume),
					Route: route, Hubs: hubsOf(route), EstimatedDelivery: model.TimeWindow{From: c.clk.Time(s.timing.window.From), To: c.clk.Time(s.timing.window.To)},
				}
				if s.kind == "OUTBOUND" {
					pr.ConsolidationID = "CONS-001"
				}
				opt.Packages = append(opt.Packages, pr)
			}
			sh.PackageID = strings.Join(pkgIDs, ",")
			opt.Shipments = append(opt.Shipments, sh)
			opt.Timeline = append(opt.Timeline, model.TimelineEvent{At: c.clk.Time(s.timing.window.To), Type: "DELIVERY", Node: model.CustomerNode, PackageID: sh.PackageID,
				Description: fmt.Sprintf("Delivery of %s between %s and %s", sh.PackageID, c.clk.Time(s.timing.window.From).Format("02/01 15:04"), c.clk.Time(s.timing.window.To).Format("02/01 15:04"))})
		}
	}
	if p.cons != nil {
		var outPkgs []string
		for _, pk := range opt.Packages {
			if pk.ConsolidationID != "" {
				outPkgs = append(outPkgs, pk.PackageID)
			}
		}
		opt.Consolidations = append(opt.Consolidations, model.ConsolidationResult{
			ID: "CONS-001", HubID: p.cons.hub.ID, HubName: p.cons.hub.Name, InboundShipments: inboundShipIDs,
			LastArrival: c.clk.Time(p.cons.lastArrival), ReadyAt: c.clk.Time(p.cons.ready), OutboundPackages: outPkgs, Cost: round2(p.cons.cost),
		})
		opt.Timeline = append(opt.Timeline, model.TimelineEvent{At: c.clk.Time(p.cons.ready), Type: "CONSOLIDATION_READY", Node: p.cons.hub.ID,
			Description: fmt.Sprintf("Consolidation completed at %s (%d inbound parcels -> %d)", p.cons.hub.Name, p.packagesBefore, p.packagesFinal)})
	}
	sort.SliceStable(opt.Timeline, func(i, j int) bool { return opt.Timeline[i].At.Before(opt.Timeline[j].At) })
	for i := range opt.Timeline {
		opt.Timeline[i].At = opt.Timeline[i].At.In(loc)
	}
	return opt
}

func hubsOf(route []model.LegResult) []string {
	hubs := []string{}
	seen := map[string]bool{}
	for _, l := range route {
		if l.To != model.CustomerNode && !seen[l.To] {
			seen[l.To] = true
			hubs = append(hubs, l.To)
		}
	}
	return hubs
}

func (c *reqCtx) nodeName(id string) string {
	if n := c.net.Nodes[id]; n != nil {
		return n.Name
	}
	return id
}
