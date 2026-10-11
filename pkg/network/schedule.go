package network

import (
	"sort"

	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/pricing"
)

// LegPlan is the effective planning of a leg for a destination: calendars,
// departures, delivery transit and window, and cost grids, after layering
// the carrier schedules on the service values.
type LegPlan struct {
	ScheduleIDs  []string // layers applied, from general to specific
	PickupCal    *calendar.Cal
	DeliveryCal  *calendar.Cal
	PickupDays   []int
	DeliveryDays []int
	Departures   []model.TimeOfDay
	CutoffBefore int
	Cutoff       model.TimeOfDay
	TransitDays  int
	WindowStart  model.TimeOfDay
	WindowEnd    model.TimeOfDay
	Cards        []*pricing.Card
	CardIDs      []string
	// carrier route applied last (empty = none)
	RouteID string
	// Weekly replaces Departures and the window per weekday (route planning).
	Weekly *Weekly
	// TransitMinSec / TransitMaxSec > 0: transit in elapsed time (route).
	TransitMinSec int64
	TransitMaxSec int64
	// Restrictions of the leg for this destination (nil = Leg.Restrictions).
	Restrictions []model.Restriction
}

// Plan returns the planning of a leg for a destination department.
func (l *Leg) Plan(dept string) *LegPlan {
	if l.Final && l.byDept != nil {
		if p, ok := l.byDept[dept]; ok {
			return p
		}
	}
	return l.DefaultPlan
}

func hasString(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// attachSchedules builds the plannings of every leg.
func (n *Network) attachSchedules(carriers map[string]*model.Carrier) {
	for _, l := range n.Legs {
		car := carriers[l.CarrierID]
		var general, service, zone, serviceZone []*model.DeliverySchedule
		if car != nil {
			for i := range car.Schedules {
				sc := &car.Schedules[i]
				if !sc.Active {
					continue
				}
				forService := len(sc.ServiceIDs) > 0
				if forService && !hasString(sc.ServiceIDs, l.ServiceID) {
					continue
				}
				switch {
				case forService && len(sc.Zones) > 0:
					serviceZone = append(serviceZone, sc)
				case forService:
					service = append(service, sc)
				case len(sc.Zones) > 0:
					zone = append(zone, sc)
				default:
					general = append(general, sc)
				}
			}
		}
		base := append(append([]*model.DeliverySchedule(nil), general...), service...)
		l.DefaultPlan = n.buildPlan(l, car, base)
		if !l.Final || len(zone)+len(serviceZone) == 0 {
			continue
		}
		depts := map[string]bool{}
		for _, sc := range append(append([]*model.DeliverySchedule(nil), zone...), serviceZone...) {
			for _, z := range sc.Zones {
				depts[z] = true
			}
		}
		keys := make([]string, 0, len(depts))
		for d := range depts {
			keys = append(keys, d)
		}
		sort.Strings(keys)
		l.byDept = map[string]*LegPlan{}
		for _, d := range keys {
			layers := append([]*model.DeliverySchedule(nil), base...)
			for _, sc := range zone {
				if hasString(sc.Zones, d) {
					layers = append(layers, sc)
				}
			}
			for _, sc := range serviceZone {
				if hasString(sc.Zones, d) {
					layers = append(layers, sc)
				}
			}
			l.byDept[d] = n.buildPlan(l, car, layers)
		}
	}
	for _, l := range n.Legs {
		n.attachRoutes(l)
	}
}

func (n *Network) buildPlan(l *Leg, car *model.Carrier, layers []*model.DeliverySchedule) *LegPlan {
	svc := l.Service
	p := &LegPlan{TransitDays: svc.TransitDays, WindowStart: svc.WindowStart, WindowEnd: svc.WindowEnd, CutoffBefore: l.CutoffMinutesBefore}
	pickup := svc.PickupCalendar
	if l.Leg.Calendar != nil {
		pickup = *l.Leg.Calendar
	}
	delivery := svc.DeliveryCalendar
	var cutoff *model.TimeOfDay
	var scheduleCards []string
	for _, sc := range layers {
		p.ScheduleIDs = append(p.ScheduleIDs, sc.ID)
		if len(sc.PickupDays) > 0 && l.Leg.Calendar == nil {
			pickup = model.Calendar{WorkingDays: sc.PickupDays, HonorHolidays: sc.HonorHolidays, ClosedDates: sc.ClosedDates}
		}
		if len(sc.DeliveryDays) > 0 {
			delivery = model.Calendar{WorkingDays: sc.DeliveryDays, HonorHolidays: sc.HonorHolidays, ClosedDates: sc.ClosedDates}
		}
		if sc.Cutoff != nil {
			c := *sc.Cutoff
			cutoff = &c
		}
		if sc.TransitDays != nil {
			p.TransitDays = *sc.TransitDays
		}
		if sc.WindowStart != nil {
			p.WindowStart = *sc.WindowStart
		}
		if sc.WindowEnd != nil {
			p.WindowEnd = *sc.WindowEnd
		}
		if len(sc.RateCardIDs) > 0 {
			scheduleCards = sc.RateCardIDs
		}
	}
	p.PickupCal = calendar.Compile(pickup)
	p.DeliveryCal = calendar.Compile(delivery)
	p.PickupDays = pickup.WorkingDays
	p.DeliveryDays = delivery.WorkingDays
	// departures: the leg pickup times, capped by the schedule cut-off
	deps := append([]model.TimeOfDay(nil), l.Leg.Departures...)
	if len(deps) == 0 {
		c := svc.Cutoff
		if cutoff != nil {
			c = *cutoff
		}
		deps = []model.TimeOfDay{c}
		if cutoff != nil {
			p.CutoffBefore = 0
		}
	} else if cutoff != nil {
		var kept []model.TimeOfDay
		for _, d := range deps {
			if d <= *cutoff {
				kept = append(kept, d)
			}
		}
		if len(kept) == 0 {
			kept = []model.TimeOfDay{*cutoff}
			p.CutoffBefore = 0
		}
		deps = kept
	}
	sort.Slice(deps, func(i, j int) bool { return deps[i] < deps[j] })
	p.Departures = deps
	if cutoff != nil {
		p.Cutoff = *cutoff
	} else {
		p.Cutoff = deps[len(deps)-1]
	}
	// cost grids: leg > schedule > service > carrier
	ids := l.Leg.RateCardIDs
	if len(ids) == 0 {
		ids = scheduleCards
	}
	if len(ids) == 0 {
		ids = svc.RateCardIDs
	}
	if len(ids) == 0 && car != nil {
		ids = car.RateCardIDs
	}
	for _, id := range ids {
		if c := n.RateCards[id]; c != nil {
			p.Cards = append(p.Cards, c)
			p.CardIDs = append(p.CardIDs, id)
		}
	}
	return p
}
