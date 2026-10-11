package network

import (
	"sort"
	"strings"

	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/pricing"
	"github.com/onestock/dp100ms/pkg/store"
)

// Zone is a compiled zone.
type Zone struct {
	model.Zone
	all    bool
	depts  map[string]bool
	points map[string]bool
}

// ContainsNode reports whether a stock point or hub belongs to the zone.
func (z *Zone) ContainsNode(n *Node) bool {
	if z == nil || n == nil {
		return false
	}
	if z.points[n.ID] || (n.StockPoint != nil && z.points[n.StockPoint.ID]) {
		return true
	}
	return z.ContainsPostalCode(n.PostalCode)
}

// ContainsPostalCode reports whether a postal code belongs to the zone.
func (z *Zone) ContainsPostalCode(pc string) bool {
	if z == nil || pc == "" {
		return false
	}
	if z.all && !overseas(pc) {
		return true
	}
	if len(pc) >= 2 && z.depts[deptOf(pc)] {
		return true
	}
	for _, p := range z.PostalCodes {
		if strings.HasPrefix(pc, p) {
			return true
		}
	}
	return false
}

// containsDept reports whether a destination department belongs to the zone
// explicitly (2) or through "*" (1). Postal code prefixes are matched at
// department level for destinations.
func (z *Zone) containsDept(d string) int {
	if z.depts[d] {
		return 2
	}
	for _, p := range z.PostalCodes {
		if len(p) >= 2 && deptOf(p) == d {
			return 2
		}
	}
	if z.all && !overseas(d) {
		return 1
	}
	return 0
}

// explicitDepts lists the departments named by the zone.
func (z *Zone) explicitDepts() []string {
	var out []string
	for d := range z.depts {
		out = append(out, d)
	}
	for _, p := range z.PostalCodes {
		if len(p) >= 2 {
			out = append(out, deptOf(p))
		}
	}
	return out
}

func (z *Zone) size() int {
	if z.all {
		return 1 << 20
	}
	return len(z.depts) + len(z.PostalCodes) + len(z.points)
}

func deptOf(pc string) string {
	if len(pc) < 2 {
		return pc
	}
	if pc[:2] == "97" && len(pc) >= 3 {
		return pc[:3]
	}
	return pc[:2]
}

func overseas(pc string) bool { return strings.HasPrefix(pc, "97") || strings.HasPrefix(pc, "98") }

// CompileZone compiles a zone.
func CompileZone(z model.Zone) *Zone {
	cz := &Zone{Zone: z, depts: map[string]bool{}, points: map[string]bool{}}
	for _, d := range z.Departments {
		if d == "*" {
			cz.all = true
			continue
		}
		cz.depts[d] = true
	}
	for _, p := range z.StockPointIDs {
		cz.points[p] = true
	}
	return cz
}

// Route is a compiled carrier route.
type Route struct {
	model.CarrierRoute
	Origin, Dest *Zone
	Card         *pricing.Card
	weekly       *Weekly
	pickup       *calendar.Cal
	delivery     *calendar.Cal
	pickupDays   []int
	deliveryDays []int
	departures   []model.TimeOfDay
}

// Weekly is a per-weekday planning: pickup times and delivery slots.
type Weekly struct {
	Departures [7][]model.TimeOfDay
	WinStart   [7]model.TimeOfDay
	WinEnd     [7]model.TimeOfDay
}

// Window returns the delivery slot of a weekday for a plan.
func (p *LegPlan) Window(wd int) (model.TimeOfDay, model.TimeOfDay) {
	start, end := p.WindowStart, p.WindowEnd
	if p.Weekly != nil {
		start, end = p.Weekly.WinStart[wd], p.Weekly.WinEnd[wd]
	}
	if end == 0 {
		end = 24*60 - 1
	}
	return start, end
}

// attachZonesAndRoutes compiles zones and carrier routes.
func (n *Network) attachZonesAndRoutes(s *store.Store) {
	n.Zones = map[string]*Zone{}
	for _, z := range s.Zones.All() {
		if z.Active {
			n.Zones[z.ID] = CompileZone(z)
		}
	}
	n.routesBySvc = map[string][]*Route{}
	n.RouteByID = map[string]*Route{}
	for _, r := range s.CarrierRoutes.All() {
		if !r.Active {
			continue
		}
		cr := &Route{CarrierRoute: r, Origin: n.Zones[r.OriginZoneID], Dest: n.Zones[r.DestinationZoneID]}
		if cr.Origin == nil || cr.Dest == nil {
			n.Warnings = append(n.Warnings, "carrier route "+r.ID+": unknown or inactive zone")
			continue
		}
		if r.Costs != nil {
			rc := *r.Costs
			rc.ID = "ROUTE:" + r.ID
			if rc.Scope == "" {
				rc.Scope = model.ScopeParcel
			}
			c, errs := pricing.Compile(&rc, n.Registry)
			if len(errs) > 0 {
				n.Warnings = append(n.Warnings, "carrier route "+r.ID+": "+strings.Join(errs, "; "))
				continue
			}
			cr.Card = c
		}
		if pl := r.Planning; pl != nil && len(pl.Days) > 0 {
			w := &Weekly{}
			var deps []model.TimeOfDay
			seen := map[model.TimeOfDay]bool{}
			for _, d := range pl.Days {
				if d.Weekday < 0 || d.Weekday > 7 {
					continue
				}
				wd := d.Weekday % 7
				if len(d.Pickups) > 0 {
					ps := append([]model.TimeOfDay(nil), d.Pickups...)
					sort.Slice(ps, func(i, j int) bool { return ps[i] < ps[j] })
					w.Departures[wd] = ps
					cr.pickupDays = append(cr.pickupDays, d.Weekday)
					for _, t := range ps {
						if !seen[t] {
							seen[t] = true
							deps = append(deps, t)
						}
					}
				}
				if d.DeliveryStart != nil || d.DeliveryEnd != nil {
					if d.DeliveryStart != nil {
						w.WinStart[wd] = *d.DeliveryStart
					}
					if d.DeliveryEnd != nil {
						w.WinEnd[wd] = *d.DeliveryEnd
					}
					cr.deliveryDays = append(cr.deliveryDays, d.Weekday)
				}
			}
			sort.Ints(cr.pickupDays)
			sort.Ints(cr.deliveryDays)
			sort.Slice(deps, func(i, j int) bool { return deps[i] < deps[j] })
			cr.departures = deps
			cr.weekly = w
			cr.pickup = calendar.Compile(model.Calendar{WorkingDays: cr.pickupDays, HonorHolidays: pl.HonorHolidays, ClosedDates: pl.ClosedDates})
			cr.delivery = calendar.Compile(model.Calendar{WorkingDays: cr.deliveryDays, HonorHolidays: pl.HonorHolidays, ClosedDates: pl.ClosedDates})
		}
		n.routesBySvc[r.ServiceID] = append(n.routesBySvc[r.ServiceID], cr)
		n.RouteByID[r.ID] = cr
	}
}

// better reports whether route a beats route b for a destination match.
func better(a *Route, am int, b *Route, bm int) bool {
	if b == nil {
		return true
	}
	if a.Priority != b.Priority {
		return a.Priority > b.Priority
	}
	if am != bm {
		return am > bm
	}
	if a.Dest.size() != b.Dest.size() {
		return a.Dest.size() < b.Dest.size()
	}
	return a.ID < b.ID
}

// attachRoutes layers the matching carrier routes on the plannings of a leg
// (after the carrier schedules).
func (n *Network) attachRoutes(l *Leg) {
	var routes []*Route
	for _, r := range n.routesBySvc[l.ServiceID] {
		if r.CarrierID == l.CarrierID && r.Origin.ContainsNode(l.FromNode) {
			routes = append(routes, r)
		}
	}
	if len(routes) == 0 {
		return
	}
	if !l.Final {
		var best *Route
		for _, r := range routes {
			if r.Dest.ContainsNode(l.ToNode) && better(r, 2, best, 2) {
				best = r
			}
		}
		if best != nil {
			l.DefaultPlan = n.applyRoute(l, l.DefaultPlan, best)
		}
		return
	}
	pick := func(d string) *Route {
		var best *Route
		bm := 0
		for _, r := range routes {
			if m := r.Dest.containsDept(d); m > 0 && better(r, m, best, bm) {
				best, bm = r, m
			}
		}
		return best
	}
	var star *Route
	depts := map[string]bool{}
	for _, r := range routes {
		if r.Dest.all && better(r, 1, star, 1) {
			star = r
		}
		for _, d := range r.Dest.explicitDepts() {
			depts[d] = true
		}
	}
	base := l.DefaultPlan
	if star != nil {
		l.DefaultPlan = n.applyRoute(l, base, star)
	}
	if len(depts) == 0 && l.byDept == nil {
		return
	}
	if l.byDept == nil {
		l.byDept = map[string]*LegPlan{}
	}
	for d, p := range l.byDept { // schedule zones
		if !depts[d] {
			if r := pick(d); r != nil {
				l.byDept[d] = n.applyRoute(l, p, r)
			}
		}
	}
	for d := range depts {
		p := l.byDept[d]
		if p == nil {
			p = base
		}
		if r := pick(d); r != nil {
			l.byDept[d] = n.applyRoute(l, p, r)
		}
	}
}

// applyRoute returns a copy of a plan with a route applied: planning,
// transit, cost grid and restrictions.
func (n *Network) applyRoute(l *Leg, base *LegPlan, r *Route) *LegPlan {
	p := *base
	p.ScheduleIDs = append([]string(nil), base.ScheduleIDs...)
	p.RouteID = r.ID
	if r.weekly != nil {
		p.Weekly = r.weekly
		p.PickupCal, p.DeliveryCal = r.pickup, r.delivery
		p.PickupDays, p.DeliveryDays = r.pickupDays, r.deliveryDays
		if len(r.departures) > 0 {
			p.Departures = r.departures
			p.Cutoff = r.departures[len(r.departures)-1]
		}
		if len(r.deliveryDays) > 0 {
			wd := r.deliveryDays[0] % 7
			p.WindowStart, p.WindowEnd = r.weekly.WinStart[wd], r.weekly.WinEnd[wd]
		}
	}
	if r.TransitMaxHours > 0 {
		p.TransitMinSec = int64(r.TransitMinHours) * 3600
		p.TransitMaxSec = int64(r.TransitMaxHours) * 3600
		p.TransitDays = (r.TransitMaxHours + 23) / 24
	}
	if r.Card != nil && len(l.Leg.RateCardIDs) == 0 {
		p.Cards = []*pricing.Card{r.Card}
		p.CardIDs = []string{r.Card.ID}
	}
	if len(r.Restrictions) > 0 {
		p.Restrictions = append(append([]model.Restriction(nil), l.Restrictions...), r.Restrictions...)
	}
	return &p
}

// NextDeparture returns the first departure of the plan for goods ready at
// ready: weekly pickups (route planning) or departures on pickup days.
func (p *LegPlan) NextDeparture(clk *calendar.Clock, ready int64) (int64, bool) {
	if p.Weekly == nil {
		return clk.NextDeparture(p.PickupCal, ready, p.Departures, p.CutoffBefore)
	}
	day, secs := clk.Split(ready)
	mod := (secs + 59) / 60
	for i := 0; i < 21; i++ {
		d := day + calendar.Day(i)
		if !clk.Working(p.PickupCal, d) {
			continue
		}
		for _, dep := range p.Weekly.Departures[d.Weekday()] {
			if i == 0 && int64(dep)-int64(p.CutoffBefore) < mod {
				continue
			}
			return clk.At(d, dep), true
		}
	}
	return 0, false
}

// Delivery returns the delivery slot of a final leg departing at dep.
// With a transit in hours, it is the first slot of a delivery day ending
// after the maximum transit, starting no earlier than the minimum transit.
// Otherwise the transit is counted in delivery working days and minTransit
// (seconds) is the earliest arrival after departure.
func (p *LegPlan) Delivery(clk *calendar.Clock, dep, minTransit int64) (int64, int64, bool) {
	if p.TransitMaxSec > 0 {
		earliest, latest := dep+p.TransitMinSec, dep+p.TransitMaxSec
		day, _ := clk.Split(latest)
		for i := 0; i < 21; i++ {
			d := day + calendar.Day(i)
			if !clk.Working(p.DeliveryCal, d) {
				continue
			}
			ws, we := p.Window(int(d.Weekday()))
			to := clk.At(d, we)
			if to < latest {
				continue
			}
			from := clk.At(d, ws)
			if from < earliest {
				from = earliest
			}
			return from, to, true
		}
		return 0, 0, false
	}
	day, _ := clk.Split(dep)
	dd, ok := clk.AddWorkingDays(p.DeliveryCal, day, p.TransitDays)
	if !ok {
		return 0, 0, false
	}
	ws, we := p.Window(int(dd.Weekday()))
	from, to := clk.At(dd, ws), clk.At(dd, we)
	minArrival := dep + minTransit
	if to <= minArrival {
		// window already over when the van leaves: next delivery day
		dd, ok = clk.AddWorkingDays(p.DeliveryCal, dd+1, 0)
		if !ok {
			return 0, 0, false
		}
		ws, we = p.Window(int(dd.Weekday()))
		from, to = clk.At(dd, ws), clk.At(dd, we)
	}
	if from < minArrival {
		from = minArrival
	}
	return from, to, true
}
