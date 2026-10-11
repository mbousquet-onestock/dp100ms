package engine

import (
	"math"
	"sort"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
	"github.com/onestock/dp100ms/pkg/pricing"
)

// ---------------------------------------------------------------------------
// Stock views

// qty is the promisable quantity of a basket item at a matrix column under
// the stock view of the current mode.
func (c *reqCtx) qty(item, col int) int {
	if c.view != nil {
		if !c.viewItemOK[item] {
			return 0
		}
		q := int(c.sn.Q(item, col)) - c.view.Reserve
		if q < 0 {
			return 0
		}
		return q
	}
	return int(c.sn.Q(item, col))
}

func (c *reqCtx) setView(mode string) {
	c.ops = opsOf(c.mode(mode))
	c.view = nil
	id := c.req.StockViewID
	if id == "" {
		if m := c.mode(mode); m != nil {
			id = m.StockViewID
		}
	}
	if id == "" {
		return
	}
	c.view = c.net.StockViews[id]
	if c.view == nil {
		return
	}
	c.viewItemOK = make([]bool, len(c.items))
	for i := range c.items {
		c.viewItemOK[i] = c.view.AllowsSKU(c.items[i].sku)
	}
}

// ---------------------------------------------------------------------------
// Article restrictions

// legMask returns the bitmask of basket items a leg may carry (cached).
func (c *reqCtx) legMask(l *network.Leg) uint64 {
	rs := l.Restrictions
	if pr := l.Plan(c.dept).Restrictions; pr != nil {
		rs = pr
	}
	if len(rs) == 0 {
		return math.MaxUint64
	}
	if c.legMasks == nil {
		c.legMasks = make(map[int]uint64, 16)
	}
	if m, ok := c.legMasks[l.Idx]; ok {
		return m
	}
	var m uint64
	for i := range c.items {
		if pricing.Allows(rs, c.items[i].sku) {
			m |= 1 << uint(i)
		}
	}
	c.legMasks[l.Idx] = m
	return m
}

func groupsMask(groups []group) uint64 {
	var m uint64
	for _, g := range groups {
		m |= 1 << uint(g.item)
	}
	return m
}

// pathAllows reports whether every leg of a path accepts the articles.
func (c *reqCtx) pathAllows(p *network.Path, mask uint64) bool {
	for _, l := range p.Legs {
		if c.legMask(l)&mask != mask {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Rate card evaluation

func (c *reqCtx) nOut() int { return len(c.net.Registry.Names) }

func (c *reqCtx) newMetrics() []float64 { return make([]float64, c.nOut()) }

// parcelVars measures a parcel and lists its articles.
func (c *reqCtx) parcelVars(groups []group, pc parcel) (pricing.Vars, []*model.SKU) {
	items := make([]pricing.ItemQty, 0, len(groups))
	skus := make([]*model.SKU, 0, len(groups))
	for gi, q := range pc.qty {
		if q > 0 {
			s := c.items[groups[gi].item].sku
			items = append(items, pricing.ItemQty{SKU: s, Qty: q})
			skus = append(skus, s)
		}
	}
	v := pricing.Measure(items)
	v[pricing.VOrderAmount] = c.orderAmount
	return v, skus
}

func (c *reqCtx) legDistance(l *network.Leg) float64 {
	if !l.Final {
		return l.DistanceKm
	}
	if c.finalDist == nil {
		c.finalDist = make(map[int]float64, 16)
	}
	if d, ok := c.finalDist[l.Idx]; ok {
		return d
	}
	d := l.FinalDistanceKm(c.dept)
	c.finalDist[l.Idx] = d
	return d
}

// measured is a packed shipment with the variables of every parcel.
type measured struct {
	parcels []parcel
	vars    []pricing.Vars
	skus    [][]*model.SKU
	total   pricing.Vars // shipment aggregate
	allSkus []*model.SKU
}

func (c *reqCtx) measure(groups []group, parcels []parcel) *measured {
	m := &measured{parcels: parcels, vars: make([]pricing.Vars, len(parcels)), skus: make([][]*model.SKU, len(parcels))}
	for i, pc := range parcels {
		m.vars[i], m.skus[i] = c.parcelVars(groups, pc)
		v := m.vars[i]
		for _, k := range []int{pricing.VWeight, pricing.VVolume, pricing.VItems, pricing.VGoodsValue} {
			m.total[k] += v[k]
		}
		for _, k := range []int{pricing.VLength, pricing.VWidth, pricing.VHeight, pricing.VGirth, pricing.VSumDims} {
			m.total[k] = math.Max(m.total[k], v[k])
		}
		m.allSkus = append(m.allSkus, m.skus[i]...)
	}
	m.total[pricing.VParcels] = float64(len(parcels))
	m.total[pricing.VOrderAmount] = c.orderAmount
	m.total[pricing.VChargeable] = m.total[pricing.VWeight]
	return m
}

// legMetrics adds the outputs of one leg for a measured shipment. It
// returns false when a rate card rejects the shipment.
func (c *reqCtx) legMetrics(l *network.Leg, m *measured, nLegs int, out []float64) bool {
	dist := c.legDistance(l)
	cost0, carbon0 := out[pricing.OutCost], out[pricing.OutCarbon]
	plan := l.Plan(c.dept)
	for _, card := range plan.Cards {
		if card.Scope == model.ScopeParcel {
			for i := range m.parcels {
				v := m.vars[i]
				v[pricing.VDistance] = dist
				v[pricing.VLegs] = float64(nLegs)
				v[pricing.VTransitDays] = float64(plan.TransitDays)
				if !card.Eval(v, c.dept, m.skus[i], out) {
					return false
				}
			}
		} else { // SHIPMENT (ORDER-scope cards on a leg act per shipment)
			v := m.total
			v[pricing.VDistance] = dist
			v[pricing.VLegs] = float64(nLegs)
			v[pricing.VTransitDays] = float64(plan.TransitDays)
			if !card.Eval(v, c.dept, m.allSkus, out) {
				return false
			}
		}
	}
	n := float64(len(m.parcels))
	if out[pricing.OutCost] == cost0 { // no card produced a cost: legacy tariff
		out[pricing.OutCost] += n*l.Service.BaseCost + l.Service.CostPerKg*m.total[pricing.VWeight]
	}
	out[pricing.OutCost] += n * l.ExtraCost
	if out[pricing.OutCarbon] == carbon0 { // fallback emission factor
		out[pricing.OutCarbon] += l.CarbonFactor / 1000 * m.total[pricing.VWeight] * dist
	}
	return true
}

// pathMetrics evaluates every leg of a path for a measured shipment.
func (c *reqCtx) pathMetrics(p *network.Path, m *measured) ([]float64, bool) {
	out := c.newMetrics()
	for _, l := range p.Legs {
		if !c.legMetrics(l, m, len(p.Legs), out) {
			return nil, false
		}
	}
	return out, true
}

// ---------------------------------------------------------------------------
// Order-level outputs: customer price and additional services

// finalizePlan adds order-level outputs (customer price, additional
// services) and their delays. It returns false when a requested additional
// service cannot be provided.
func (c *reqCtx) finalizePlan(p *plan) bool {
	mode := c.mode(p.mode)
	// delivered parcels
	var ov pricing.Vars
	var skus []*model.SKU
	maxDist := 0.0
	for _, s := range p.ships {
		if s.kind == "INBOUND" {
			continue
		}
		mt := s.m
		for _, k := range []int{pricing.VWeight, pricing.VVolume, pricing.VItems} {
			ov[k] += mt.total[k]
		}
		for _, k := range []int{pricing.VLength, pricing.VWidth, pricing.VHeight, pricing.VGirth, pricing.VSumDims} {
			ov[k] = math.Max(ov[k], mt.total[k])
		}
		skus = append(skus, mt.allSkus...)
		d := 0.0
		for _, l := range s.path.Legs {
			d += c.legDistance(l)
		}
		maxDist = math.Max(maxDist, d)
	}
	ov[pricing.VParcels] = float64(p.packagesFinal)
	ov[pricing.VOrderAmount] = c.orderAmount
	ov[pricing.VGoodsValue] = c.orderAmount
	ov[pricing.VDistance] = maxDist
	ov[pricing.VLegs] = float64(p.legs)
	ov[pricing.VTransitDays] = float64(c.clk.BusinessDaysBetween(c.orderU, p.window.To))
	ov[pricing.VChargeable] = ov[pricing.VWeight]
	cards := c.net.ModePriceCards[p.mode]
	if len(cards) > 0 {
		for _, card := range cards {
			if !card.Eval(ov, c.dept, skus, p.metrics) {
				return false
			}
		}
	} else if mode != nil {
		p.metrics[pricing.OutPrice] += mode.Price
	}
	// requested additional services
	for _, sid := range c.req.AdditionalServices {
		as := c.net.AddServices[sid]
		if as == nil {
			return false
		}
		applied := false
		units, value := 0.0, 0.0
		for si, s := range p.ships {
			if s.kind == "INBOUND" {
				continue
			}
			final := s.path.Legs[len(s.path.Legs)-1]
			concerned := false
			for _, g := range s.groups {
				it := c.items[g.item]
				if pricing.MatchAll(as.AppliesTo, it.sku) {
					concerned = true
					units += float64(g.qty)
					value += float64(g.qty) * it.sku.PriceEur
				}
			}
			if !concerned {
				continue
			}
			if !final.OffersService(sid) {
				return false // the delivering carrier cannot provide it
			}
			applied = true
			if as.ExtraDays > 0 {
				if p.shift == nil {
					p.shift = map[int]int{}
				}
				if as.ExtraDays > p.shift[si] {
					p.shift[si] = as.ExtraDays
				}
			}
		}
		if !applied {
			continue // no article concerned: nothing to do
		}
		var sv pricing.Vars
		sv[pricing.VItems] = units
		sv[pricing.VGoodsValue] = value
		sv[pricing.VOrderAmount] = c.orderAmount
		sv[pricing.VParcels] = 1
		for out, comp := range as.Outputs {
			idx := c.net.Registry.Lookup(out)
			if idx < 0 {
				continue
			}
			x := comp.Fixed + comp.PerItem*units + comp.PercentOfValue/100*value
			if comp.Min != nil && x < *comp.Min {
				x = *comp.Min
			}
			if comp.Max != nil && x > *comp.Max {
				x = *comp.Max
			}
			p.metrics[idx] += x
		}
	}
	if len(p.shift) > 0 || c.ops.reception > 0 {
		p.window = win{}
		for si, s := range p.ships {
			if s.kind == "INBOUND" {
				continue
			}
			w := c.shipWindow(p, si)
			if w.To > p.window.To {
				p.window.To = w.To
			}
			if w.From > p.window.From {
				p.window.From = w.From
			}
		}
	}
	p.cost = p.metrics[pricing.OutCost]
	return true
}

// shipWindow returns the delivery window of a delivering shipment, delayed
// by its additional services.
func (c *reqCtx) shipWindow(p *plan, si int) win {
	s := p.ships[si]
	w := s.timing.window
	days := p.shift[si]
	if r := c.ops.reception; r > 0 {
		w = win{From: w.From + r, To: w.To + r}
	}
	if days == 0 {
		return w
	}
	final := s.path.Legs[len(s.path.Legs)-1]
	day, toSecs := c.clk.Split(w.To)
	_, fromSecs := c.clk.Split(w.From)
	nd, ok := c.clk.AddWorkingDays(final.Plan(c.dept).DeliveryCal, day+1, days-1)
	if !ok {
		return w
	}
	return win{From: c.clk.At(nd, model.TimeOfDay(fromSecs/60)), To: c.clk.At(nd, model.TimeOfDay(toSecs/60))}
}

// offeredServices lists the additional services the delivering carriers of
// a plan can provide for its articles.
func (c *reqCtx) offeredServices(p *plan) []model.AdditionalServiceResult {
	requested := map[string]bool{}
	for _, id := range c.req.AdditionalServices {
		requested[id] = true
	}
	type acc struct {
		as    *model.AdditionalService
		qty   map[int]int
		units float64
		value float64
		all   bool
	}
	found := map[string]*acc{}
	var order []string
	for _, s := range p.ships {
		if s.kind == "INBOUND" {
			continue
		}
		final := s.path.Legs[len(s.path.Legs)-1]
		for _, as := range final.Offers {
			a := found[as.ID]
			if a == nil {
				a = &acc{as: as, qty: map[int]int{}}
				found[as.ID] = a
				order = append(order, as.ID)
			}
			for _, g := range s.groups {
				it := c.items[g.item]
				if pricing.MatchAll(as.AppliesTo, it.sku) {
					a.qty[g.item] += g.qty
					a.units += float64(g.qty)
					a.value += float64(g.qty) * it.sku.PriceEur
				}
			}
		}
	}
	out := []model.AdditionalServiceResult{}
	for _, id := range order {
		a := found[id]
		if a.units == 0 {
			continue
		}
		r := model.AdditionalServiceResult{ID: id, Name: a.as.Name, Kind: a.as.Kind, Requested: requested[id], ExtraDays: a.as.ExtraDays, Metrics: map[string]float64{}}
		var keys []int
		for k := range a.qty {
			keys = append(keys, k)
		}
		sort.Ints(keys)
		for _, k := range keys {
			r.Items = append(r.Items, model.BasketItem{SKU: c.items[k].code, Quantity: a.qty[k]})
		}
		for out, comp := range a.as.Outputs {
			x := comp.Fixed + comp.PerItem*a.units + comp.PercentOfValue/100*a.value
			if comp.Min != nil && x < *comp.Min {
				x = *comp.Min
			}
			if comp.Max != nil && x > *comp.Max {
				x = *comp.Max
			}
			r.Metrics[out] = round2(x)
		}
		out = append(out, r)
	}
	return out
}

// ---------------------------------------------------------------------------
// Criteria

// criteria returns the ranking criteria of a mode: request override, mode
// configuration, or the legacy global weights.
func (c *reqCtx) criteria(mode string) ([]model.Criterion, string) {
	if len(c.req.Criteria) > 0 {
		return c.req.Criteria, c.req.Selection
	}
	if m := c.mode(mode); m != nil && len(m.Criteria) > 0 && c.req.Weights == nil {
		return m.Criteria, m.Selection
	}
	w := c.weights
	return []model.Criterion{
		{Metric: "deliveryHours", Weight: w.DeliveryTime, Priority: 1},
		{Metric: "cost", Weight: w.Cost, Priority: 2},
		{Metric: "packages", Weight: w.Packages, Priority: 3},
		{Metric: "sources", Weight: w.Sources, Priority: 4},
		{Metric: "legs", Weight: w.Legs, Priority: 5},
	}, model.SelectWeighted
}

// metricValue returns a plan metric by name (NaN when unknown).
func (c *reqCtx) metricValue(p *plan, name string) float64 {
	switch name {
	case "deliveryHours", "deliveryTime":
		return float64(p.window.To-c.orderU) / 3600
	case "packages":
		return float64(p.packagesFinal)
	case "legs":
		return float64(p.legs)
	case "sources":
		return float64(p.sources)
	}
	if i := c.net.Registry.Lookup(name); i >= 0 {
		return p.metrics[i]
	}
	return math.NaN()
}

// withinLimits checks the hard Max of the criteria.
func (c *reqCtx) withinLimits(p *plan) bool {
	crits, _ := c.criteria(p.mode)
	for _, cr := range crits {
		if cr.Max != nil {
			if v := c.metricValue(p, cr.Metric); !math.IsNaN(v) && v > *cr.Max+1e-9 {
				return false
			}
		}
	}
	return true
}

// scorePlans computes score = 1 - weighted min-max normalised penalty
// within the mode, then sorts (by score, or lexicographically by priority).
func (c *reqCtx) scorePlans(mode string, plans []*plan) {
	if len(plans) == 0 {
		return
	}
	crits, selection := c.criteria(mode)
	n := len(crits)
	vals := make([][]float64, len(plans))
	mn := make([]float64, n)
	mx := make([]float64, n)
	for j := range mn {
		mn[j], mx[j] = math.Inf(1), math.Inf(-1)
	}
	for i, p := range plans {
		vals[i] = make([]float64, n)
		for j, cr := range crits {
			v := c.metricValue(p, cr.Metric)
			if math.IsNaN(v) {
				v = 0
			}
			if cr.Direction == "MAX" {
				v = -v
			}
			vals[i][j] = v
			mn[j] = math.Min(mn[j], v)
			mx[j] = math.Max(mx[j], v)
		}
	}
	total := 0.0
	for _, cr := range crits {
		total += math.Max(cr.Weight, 0)
	}
	for i, p := range plans {
		pen := 0.0
		for j, cr := range crits {
			if mx[j] > mn[j] && cr.Weight > 0 {
				pen += cr.Weight * (vals[i][j] - mn[j]) / (mx[j] - mn[j])
			}
		}
		if total > 0 {
			p.score = math.Round((1-pen/total)*1000) / 1000
		} else {
			p.score = 1
		}
		p.critVals = vals[i]
	}
	if selection == model.SelectLexicographic {
		order := make([]int, n)
		for j := range order {
			order[j] = j
		}
		sort.SliceStable(order, func(a, b int) bool { return crits[order[a]].Priority < crits[order[b]].Priority })
		sort.SliceStable(plans, func(a, b int) bool {
			for _, j := range order {
				d := plans[a].critVals[j] - plans[b].critVals[j]
				if math.Abs(d) > crits[j].Tolerance+1e-9 {
					return d < 0
				}
			}
			return plans[a].score > plans[b].score
		})
		return
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

// selectors are the per-shipment path choices explored for a mode: fastest,
// cheapest, lowest carbon, and the custom outputs used by its criteria.
func (c *reqCtx) selectors(mode string) []int {
	sel := []int{-1, pricing.OutCost, pricing.OutCarbon} // -1 = fastest
	crits, _ := c.criteria(mode)
	for _, cr := range crits {
		if i := c.net.Registry.Lookup(cr.Metric); i > pricing.OutCarbon {
			dup := false
			for _, s := range sel {
				if s == i {
					dup = true
				}
			}
			if !dup {
				sel = append(sel, i)
			}
		}
	}
	return sel
}

// ---------------------------------------------------------------------------
// Package alternatives

// alternatives lists the stock points able to ship the content of a parcel
// directly for the plan's mode, with their best route (by the requested
// sort metric), sorted and limited. The current origin is flagged.
func (c *reqCtx) alternatives(p *plan, s *shipPlan, pc parcel) []model.PackageAlternative {
	limit := c.req.Alternatives.Limit
	if limit <= 0 {
		limit = 5
	}
	sortBy := c.req.Alternatives.SortBy
	if sortBy == "" {
		sortBy = "deliveryHours"
	}
	sel := -1
	switch sortBy {
	case "deliveryHours", "distanceKm":
	default:
		if i := c.net.Registry.Lookup(sortBy); i >= 0 {
			sel = i
		}
	}
	// parcel content per basket item
	need := map[int]int{}
	for gi, q := range pc.qty {
		if q > 0 {
			need[s.groups[gi].item] += q
		}
	}
	dr, _ := c.net.Routes(c.dept, p.mode)
	type alt struct {
		model.PackageAlternative
		key float64
	}
	var alts []alt
	for _, cd := range c.modeCands[p.mode] {
		ok := true
		groups := make([]group, 0, len(need))
		for it, q := range need {
			if c.qty(it, cd.col) < q {
				ok = false
				break
			}
			groups = append(groups, group{item: it, source: cd.node.ID, qty: q})
		}
		if !ok {
			continue
		}
		sort.Slice(groups, func(a, b int) bool { return groups[a].item < groups[b].item })
		best := c.bestShipments("DIRECT", cd.node.ID, dr.ByIdx[cd.node.Idx], cd.ready, groups, []int{sel})[0]
		if best == nil {
			continue
		}
		a := alt{PackageAlternative: model.PackageAlternative{
			StockPointID: cd.node.ID, Name: cd.node.Name, Type: string(cd.node.Kind), City: cd.node.StockPoint.Address.City,
			EstimatedDelivery: model.TimeWindow{From: c.clk.Time(best.timing.window.From), To: c.clk.Time(best.timing.window.To)},
			DeliveryHours:     math.Round(float64(best.timing.window.To-c.orderU)/360) / 10,
			Parcels:           len(best.parcels), Metrics: c.net.Registry.Map(best.metrics),
			Current: cd.node.ID == s.origin && s.kind == "DIRECT",
		}}
		d := 0.0
		for _, l := range best.path.Legs {
			d += c.legDistance(l)
			a.Carriers = append(a.Carriers, l.Carrier.ID)
			a.Route = append(a.Route, l.To)
		}
		a.DistanceKm = math.Round(d*10) / 10
		switch {
		case sortBy == "distanceKm":
			a.key = d
		case sel < 0:
			a.key = float64(best.timing.window.To)
		default:
			a.key = best.metrics[sel]
		}
		alts = append(alts, a)
	}
	sort.SliceStable(alts, func(i, j int) bool {
		if alts[i].key != alts[j].key {
			return alts[i].key < alts[j].key
		}
		return alts[i].StockPointID < alts[j].StockPointID
	})
	out := make([]model.PackageAlternative, 0, limit)
	for i := 0; i < len(alts) && len(out) < limit; i++ {
		out = append(out, alts[i].PackageAlternative)
	}
	return out
}
