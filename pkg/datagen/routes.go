package datagen

import (
	"fmt"
	"sort"
	"strings"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

var metroNames = map[string]string{
	"PARIS": "Paris", "PARIS_SUD": "Paris Sud", "LYON": "Lyon", "MARSEILLE": "Marseille", "BORDEAUX": "Bordeaux",
	"LILLE": "Lille", "TOULOUSE": "Toulouse", "NANTES": "Nantes", "STRASBOURG": "Strasbourg", "NICE": "Nice", "RENNES": "Rennes",
}

var regionNames = map[string]string{
	"IDF": "Île-de-France et Nord-Ouest", "RHONE": "Rhône-Alpes et Centre-Est", "SUDOUEST": "Sud-Ouest",
	"OUEST": "Ouest", "NORD": "Nord-Est", "SUD": "Sud-Est",
}

var typeNames = map[model.StockPointType]string{
	model.StockPointStore: "Magasins", model.StockPointWarehouse: "Entrepôts", model.StockPointLastMileHub: "Hubs dernier kilomètre",
}

// routeSpec is the delivery promise of a service: transit in hours, pickup
// and delivery days, delivery slot and cost grid.
type routeSpec struct {
	minH, maxH            int
	pickupDays, delivDays []int
	start, end            string
	grid                  string
	dest                  string // national destination zone (services without zones)
	meta                  map[string]string
}

// generateRoutes turns the direct deliveries of the network into zones and
// carrier routes: origin zone -> destination zone per service, with a cost
// grid, a transit time, a weekly planning (pickup times, delivery slots)
// and metadata.
func generateRoutes(s *store.Store, finals []model.Leg) {
	monFri, monSat, tueSat := []int{1, 2, 3, 4, 5}, []int{1, 2, 3, 4, 5, 6}, []int{2, 3, 4, 5, 6}
	specs := map[string]routeSpec{
		"COLIVIA-STD":  {24, 48, monFri, monSat, "09:00", "18:00", "RC-COLIVIA-STD", "FR", map[string]string{"codeProduit": "DOM", "contrat": "COL-2026-01"}},
		"COLIVIA-REG":  {12, 24, monSat, monSat, "09:00", "18:00", "RC-COLIVIA-REG", "", map[string]string{"codeProduit": "REG"}},
		"EXPRESSO-EXP": {12, 18, monFri, monFri, "08:00", "13:00", "RC-EXPRESSO", "FR-EXPRESS", map[string]string{"codeProduit": "E13"}},
		"EXPRESSO-HUB": {2, 4, monFri, monFri, "09:00", "13:00", "RC-EXPRESSO", "", map[string]string{"codeProduit": "E13-PF"}},
		"RELAIS-STD":   {36, 48, monFri, tueSat, "10:00", "19:00", "RC-RELAIS", "FR-HORS-CORSE", map[string]string{"codeProduit": "PR48", "reseau": "Relais Plus"}},
		"URBIKE-AM":    {1, 2, monSat, monSat, "09:00", "13:00", "RC-URBIKE", "", map[string]string{"vehicule": "vélo-cargo", "tournee": "matin"}},
		"URBIKE-PM":    {1, 2, monSat, monSat, "14:00", "20:00", "RC-URBIKE", "", map[string]string{"vehicule": "vélo-cargo", "tournee": "après-midi"}},
		"URBIKE-SD":    {1, 2, monSat, monSat, "17:00", "21:00", "RC-URBIKE-SD", "", map[string]string{"vehicule": "vélo-cargo", "tournee": "soir"}},
		"URBIKE-SFS":   {1, 2, monSat, monSat, "17:00", "21:00", "RC-URBIKE-SD", "", map[string]string{"vehicule": "vélo-cargo", "depart": "magasin"}},
	}
	zones := map[string]model.Zone{}
	addZone := func(z model.Zone) string {
		z.Active = true
		if _, ok := zones[z.ID]; !ok {
			zones[z.ID] = z
		}
		return z.ID
	}
	addZone(model.Zone{ID: "FR", Name: "France métropolitaine", Departments: []string{"*"}})
	addZone(model.Zone{ID: "FR-HORS-CORSE", Name: "France continentale", Departments: []string{"*"}, ExcludedDepartments: []string{"20"}})
	addZone(model.Zone{ID: "FR-EXPRESS", Name: "France continentale hors montagne", Description: "Zone desservie en express", Departments: []string{"*"}, ExcludedDepartments: []string{"20", "04", "05", "15", "48"}})
	addZone(model.Zone{ID: "CORSE", Name: "Corse", Departments: []string{"20"}})
	addZone(model.Zone{ID: "MONTAGNE", Name: "Zones de montagne", Description: "Alpes du Sud, Cantal, Lozère, Savoie", Departments: []string{"04", "05", "15", "48", "73"}})
	addZone(model.Zone{ID: "ELOIGNE", Name: "Départements éloignés", Departments: []string{"29", "64", "65", "66", "09"}})

	services := map[string]model.CarrierService{}
	for _, sv := range s.Services.All() {
		services[sv.ID] = sv
	}
	pointType := map[string]model.StockPointType{}
	pointName := map[string]string{}
	typeCount := map[model.StockPointType]int{}
	for _, sp := range s.StockPoints.All() {
		pointType[sp.ID], pointName[sp.ID] = sp.Type, sp.Name
		typeCount[sp.Type]++
	}
	for _, h := range s.Hubs.All() {
		pointName[h.ID] = h.Name
	}
	sameSet := func(a, b []string) bool {
		if len(a) != len(b) {
			return false
		}
		m := map[string]bool{}
		for _, x := range a {
			m[x] = true
		}
		for _, x := range b {
			if !m[x] {
				return false
			}
		}
		return true
	}
	// destination zone of a leg restricted to some departments
	destZone := func(svc model.CarrierService, depts []string) string {
		key, name := "", ""
		for k, ds := range MetroDepts {
			if sameSet(ds, depts) {
				key, name = "METRO-"+strings.ReplaceAll(k, "_", "-"), "Agglomération de "+metroNames[k]
			}
		}
		for k, ds := range RegionDepts {
			if sameSet(ds, depts) {
				key, name = "REGION-"+k, "Région "+regionNames[k]
			}
		}
		if key == "" {
			key, name = "ZONE-"+strings.Join(depts, "-"), "Départements "+strings.Join(depts, ", ")
		}
		var kept, excluded []string
		for _, d := range depts {
			if hasString(svc.ExcludedCoverage, d) {
				excluded = append(excluded, d)
			} else {
				kept = append(kept, d)
			}
		}
		if len(excluded) > 0 {
			key += "-EXPRESS"
			name += " (hors " + strings.Join(excluded, ", ") + ")"
		}
		return addZone(model.Zone{ID: key, Name: name, Departments: kept})
	}
	week := func(sp routeSpec, start, end string, pickups []model.TimeOfDay) *model.RoutePlanning {
		pl := &model.RoutePlanning{Timezone: "Europe/Paris", HonorHolidays: true}
		for wd := 1; wd <= 7; wd++ {
			d := model.RouteDay{Weekday: wd}
			if hasInt(sp.pickupDays, wd) {
				d.Pickups = append(d.Pickups, pickups...)
			}
			if hasInt(sp.delivDays, wd) {
				d.DeliveryStart, d.DeliveryEnd = tp(start), tp(end)
			}
			if len(d.Pickups) > 0 || d.DeliveryStart != nil {
				pl.Days = append(pl.Days, d)
			}
		}
		return pl
	}
	grid := func(id string) *model.RateCard {
		rc, ok := s.RateCards.Get(id)
		if !ok {
			return nil
		}
		rc.ID, rc.Name, rc.CarrierID, rc.Description = "", "", "", ""
		return &rc
	}
	// group the direct deliveries: service -> origin group -> points
	type group struct {
		svc, origin, dest, name, id string
		points                      []string
		pickups                     []model.TimeOfDay
	}
	groups := map[string]*group{}
	var order []string
	for _, l := range finals {
		svc := services[l.ServiceID]
		sp, ok := specs[l.ServiceID]
		if !ok {
			continue
		}
		var gk, oname, dest, rid string
		if len(l.DestinationZones) > 0 {
			dest = destZone(svc, l.DestinationZones)
			gk = svc.ID + "|" + dest
			rid = svc.ID + "-" + dest
			oname = "Sites expéditeurs — " + zones[dest].Name
		} else {
			typ := pointType[l.From]
			dest = sp.dest
			if dest == "" {
				continue // no national destination for this service
			}
			gk = svc.ID + "|" + string(typ)
			rid = svc.ID + "-" + strings.ReplaceAll(string(typ), "_", "-") + "-" + dest
			oname = typeNames[typ] + " expéditeurs " + svc.Name
		}
		g := groups[gk]
		if g == nil {
			g = &group{svc: svc.ID, dest: dest, name: oname, id: rid, origin: "ORIG-" + strings.ReplaceAll(strings.ReplaceAll(gk, "|", "-"), "_", "-")}
			groups[gk] = g
			order = append(order, gk)
		}
		if !hasString(g.points, l.From) {
			g.points = append(g.points, l.From)
		}
		for _, d := range l.Departures {
			if !hasTOD(g.pickups, d) {
				g.pickups = append(g.pickups, d)
			}
		}
	}
	originByPoints := map[string]string{}
	var routes []model.CarrierRoute
	all := map[string][]string{} // service -> every origin point
	for _, gk := range order {
		g := groups[gk]
		sort.Strings(g.points)
		sort.Slice(g.pickups, func(i, j int) bool { return g.pickups[i] < g.pickups[j] })
		pk := strings.Join(g.points, ",")
		if id, ok := originByPoints[pk]; ok {
			g.origin = id // same shipping points: share the zone
		} else {
			if len(g.points) == 1 {
				g.origin, g.name = "SITE-"+g.points[0], "Site "+pointName[g.points[0]]
			} else if typ := pointType[g.points[0]]; len(g.points) == typeCount[typ] {
				g.origin, g.name = "ALL-"+strings.ReplaceAll(string(typ), "_", "-"), "Tous les "+strings.ToLower(typeNames[typ])
			}
			originByPoints[pk] = addZone(model.Zone{ID: g.origin, Name: g.name, StockPointIDs: g.points})
		}
		all[g.svc] = append(all[g.svc], g.points...)
		svc, sp := services[g.svc], specs[g.svc]
		routes = append(routes, model.CarrierRoute{
			ID: g.id, Name: svc.Name + " — " + zones[g.dest].Name,
			CarrierID: svc.CarrierID, ServiceID: svc.ID, OriginZoneID: g.origin, DestinationZoneID: g.dest,
			Costs: grid(sp.grid), TransitMinHours: sp.minH, TransitMaxHours: sp.maxH, Planning: week(sp, sp.start, sp.end, g.pickups),
			Metadata: sp.meta, Active: true})
	}
	// specific destinations, from every shipping point of the service
	special := func(svcID, id, name, dest string, minH, maxH int, delivDays []int, start, end, gridID string, pickups ...string) {
		pts := all[svcID]
		if len(pts) == 0 {
			return
		}
		sort.Strings(pts)
		origin := addZone(model.Zone{ID: "ORIG-" + svcID, Name: "Tous les sites expéditeurs " + services[svcID].Name, StockPointIDs: pts})
		sp := specs[svcID]
		sp.delivDays = delivDays
		var ps []model.TimeOfDay
		for _, p := range pickups {
			ps = append(ps, model.MustTOD(p))
		}
		svc := services[svcID]
		routes = append(routes, model.CarrierRoute{ID: id, Name: name, CarrierID: svc.CarrierID, ServiceID: svcID, OriginZoneID: origin, DestinationZoneID: dest,
			Costs: grid(gridID), TransitMinHours: minH, TransitMaxHours: maxH, Planning: week(sp, start, end, ps), Metadata: sp.meta, Active: true})
	}
	special("COLIVIA-STD", "COLIVIA-STD-CORSE", "Colivia Domicile — Corse", "CORSE", 72, 96, monFri, "09:00", "18:00", "RC-COLIVIA-CORSE", "16:00")
	special("COLIVIA-STD", "COLIVIA-STD-MONTAGNE", "Colivia Domicile — zones de montagne", "MONTAGNE", 48, 72, monSat, "10:00", "17:00", "RC-COLIVIA-STD", "16:00", "19:00")
	special("EXPRESSO-EXP", "EXPRESSO-EXP-ELOIGNE", "Expresso — départements éloignés (après-midi)", "ELOIGNE", 18, 22, monFri, "13:00", "18:00", "RC-EXPRESSO", "17:30", "19:00")

	ids := make([]string, 0, len(zones))
	for id := range zones {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		s.Zones.LoadRaw(zones[id])
	}
	for _, r := range routes {
		if r.Costs != nil {
			s.CarrierRoutes.LoadRaw(r)
		}
	}
	// routed carriers: the routes replace their schedules
	for _, c := range s.Carriers.All() {
		switch c.ID {
		case "COLIVIA", "EXPRESSO", "RELAISPLUS", "URBIKE":
			c.Schedules = nil
			s.Carriers.LoadRaw(c)
		}
	}
	// delivery modes list the services they compare
	for _, m := range s.Modes.All() {
		m.ServiceIDs = nil
		for _, sv := range s.Services.All() {
			if hasString(sv.Modes, m.ID) && deliversCustomer(sv.Kind) {
				m.ServiceIDs = append(m.ServiceIDs, sv.ID)
			}
		}
		sort.Strings(m.ServiceIDs)
		m.Operations = modeOperations[m.ID]
		s.Modes.LoadRaw(m)
	}
}

var modeOperations = map[string][]model.ModeOperation{
	"STANDARD": {{Kind: model.OpPayment, Name: "Autorisation de paiement", Minutes: 15}},
	"EXPRESS":  {{Kind: model.OpPayment, Name: "Autorisation de paiement", Minutes: 5}, {Kind: model.OpPacking, Name: "Emballage express", Minutes: 10}},
	"SAME_DAY": {{Kind: model.OpValidation, Name: "Contrôle anti-fraude", Minutes: 10}, {Kind: model.OpPreparation, Name: "Préparation prioritaire", Minutes: 30}},
	"RELAY":    {{Kind: model.OpPayment, Name: "Autorisation de paiement", Minutes: 15}, {Kind: model.OpReception, Name: "Réception au point relais", Minutes: 120}},
	"ECO":      {{Kind: model.OpPayment, Name: "Autorisation de paiement", Minutes: 15}},
}

func deliversCustomer(k model.ServiceKind) bool {
	return k != model.KindLinehaul && k != model.KindShuttle
}

func hasString(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func hasTOD(xs []model.TimeOfDay, x model.TimeOfDay) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// generateSiteRoutes turns the transports between sites (line-haul to the
// platforms and hubs, shuttles to the last-mile hubs) into carrier routes:
// one route per service, destination hub, pickup times and transit (hours,
// rounded up), from the zone of the sites sharing them.
func generateSiteRoutes(s *store.Store, legs []model.Leg) {
	services := map[string]model.CarrierService{}
	for _, sv := range s.Services.All() {
		services[sv.ID] = sv
	}
	names := map[string]string{}
	for _, sp := range s.StockPoints.All() {
		names[sp.ID] = sp.Name
	}
	for _, h := range s.Hubs.All() {
		names[h.ID] = h.Name
	}
	zoneByPoints := map[string]string{}
	for _, z := range s.Zones.All() {
		if len(z.StockPointIDs) > 0 && len(z.Departments) == 0 {
			pts := append([]string(nil), z.StockPointIDs...)
			sort.Strings(pts)
			zoneByPoints[strings.Join(pts, ",")] = z.ID
		}
	}
	zoneFor := func(points []string, id, name string) string {
		sort.Strings(points)
		k := strings.Join(points, ",")
		if z, ok := zoneByPoints[k]; ok {
			return z
		}
		if len(points) == 1 {
			id, name = "SITE-"+points[0], "Site "+names[points[0]]
		}
		s.Zones.LoadRaw(model.Zone{ID: id, Name: name, StockPointIDs: points, Active: true})
		zoneByPoints[k] = id
		return id
	}
	type group struct {
		svc, to string
		hours   int
		deps    []model.TimeOfDay
		points  []string
	}
	groups := map[string]*group{}
	var order []string
	for _, l := range legs {
		tm := l.TransitMinutes
		if tm == 0 {
			tm = services[l.ServiceID].TransitMinutes
		}
		// transit rounded up to the hour (shuttles) or to 4 h (line-haul) so
		// that sites at similar distances share a route
		step := 1
		if services[l.ServiceID].Kind == model.KindLinehaul {
			step = 4
		}
		hours := ((tm+59)/60 + step - 1) / step * step
		deps := append([]model.TimeOfDay(nil), l.Departures...)
		sort.Slice(deps, func(i, j int) bool { return deps[i] < deps[j] })
		var dk []string
		for _, d := range deps {
			dk = append(dk, d.String())
		}
		key := fmt.Sprintf("%s|%s|%d|%s", l.ServiceID, l.To, hours, strings.Join(dk, ","))
		g := groups[key]
		if g == nil {
			g = &group{svc: l.ServiceID, to: l.To, hours: hours, deps: deps}
			groups[key] = g
			order = append(order, key)
		}
		if !hasString(g.points, l.From) {
			g.points = append(g.points, l.From)
		}
	}
	sort.Strings(order)
	grids := map[string]string{"TRANSALP-LH": "RC-TRANSALP", "NAVETTE-REG": "RC-NAVETTE"}
	vehicles := map[string]string{"TRANSALP-LH": "semi-remorque", "NAVETTE-REG": "fourgon"}
	seq := map[string]int{}
	for _, key := range order {
		g := groups[key]
		svc := services[g.svc]
		seq[g.svc+g.to]++
		dest := zoneFor([]string{g.to}, "SITE-"+g.to, "Site "+names[g.to])
		origin := zoneFor(append([]string(nil), g.points...), fmt.Sprintf("ORIG-%s-%s-%d", g.svc, g.to, seq[g.svc+g.to]),
			fmt.Sprintf("Sites desservis par %s vers %s (%d h)", svc.Name, names[g.to], g.hours))
		pl := &model.RoutePlanning{Timezone: "Europe/Paris", HonorHolidays: svc.PickupCalendar.HonorHolidays}
		for _, wd := range svc.PickupCalendar.WorkingDays {
			pl.Days = append(pl.Days, model.RouteDay{Weekday: wd, Pickups: g.deps})
		}
		var costs *model.RateCard
		if rc, ok := s.RateCards.Get(grids[g.svc]); ok {
			rc.ID, rc.Name, rc.CarrierID, rc.Description = "", "", "", ""
			costs = &rc
		}
		s.CarrierRoutes.LoadRaw(model.CarrierRoute{
			ID: fmt.Sprintf("%s-%s-%d", g.svc, g.to, seq[g.svc+g.to]), Name: fmt.Sprintf("%s — vers %s", svc.Name, names[g.to]),
			CarrierID: svc.CarrierID, ServiceID: svc.ID, OriginZoneID: origin, DestinationZoneID: dest,
			Costs: costs, TransitMinHours: g.hours, TransitMaxHours: g.hours, Planning: pl,
			Metadata: map[string]string{"vehicule": vehicles[g.svc]}, Active: true})
	}
}
