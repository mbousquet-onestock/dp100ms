// Package datagen generates a reproducible French logistic dataset: stock
// points spread over metropolitan France, a shared SKU catalog with
// different local assortments, stock lines (including zero, partial and
// reserved stock), carriers, services, hubs, multi-leg legs, explicit
// routes, delivery modes and scenarios. The same seed always produces the
// same dataset.
package datagen

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

type Config struct {
	Seed         int64 `json:"seed"`
	Stores       int   `json:"stores"`
	Warehouses   int   `json:"warehouses"`
	LastMileHubs int   `json:"lastMileHubs"`
	CatalogSize  int   `json:"catalogSize"`
	SKUsPerPoint int   `json:"skusPerPoint"`
	// WarehouseCatalog: warehouses only carry SKUs below this index; the
	// rest of the catalog is a store-exclusive collection (forces
	// multi-source baskets).
	WarehouseCatalog int `json:"warehouseCatalog"`
	// Probability of a zero quantity on a listed line, per point type.
	ZeroStore     float64 `json:"zeroStore"`
	ZeroWarehouse float64 `json:"zeroWarehouse"`
	ZeroLastMile  float64 `json:"zeroLastMile"`
}

func DefaultConfig() Config {
	return Config{Seed: 42, Stores: 100, Warehouses: 10, LastMileHubs: 10, CatalogSize: 12000, SKUsPerPoint: 10000, WarehouseCatalog: 10000,
		ZeroStore: 0.22, ZeroWarehouse: 0.06, ZeroLastMile: 0.45}
}

var categories = []struct {
	name       string
	minW, maxW float64
	volPerKg   float64
}{
	{"Mode", 0.15, 1.2, 4},
	{"Chaussures", 0.6, 1.8, 5},
	{"Maison", 0.5, 9, 3},
	{"Sport", 0.3, 14, 3},
	{"Beauté", 0.05, 0.8, 2},
	{"High-tech", 0.1, 6, 2.5},
	{"Jouets", 0.2, 5, 5},
	{"Bricolage", 0.5, 22, 1.5},
}

var productWords = []string{"Classic", "Urban", "Nordic", "Essential", "Premium", "Eco", "Pro", "Lite", "Max", "Studio", "Atelier", "Riviera", "Alpine", "Bretagne", "Provence"}
var productTypes = map[string][]string{
	"Mode":       {"T-shirt", "Chemise", "Pull", "Jean", "Robe", "Veste", "Manteau"},
	"Chaussures": {"Baskets", "Bottines", "Sandales", "Mocassins"},
	"Maison":     {"Lampe", "Coussin", "Plaid", "Vase", "Cafetière", "Poêle"},
	"Sport":      {"Ballon", "Raquette", "Haltères", "Tapis", "Vélo d'appartement"},
	"Beauté":     {"Crème", "Parfum", "Shampooing", "Sérum"},
	"High-tech":  {"Casque", "Enceinte", "Chargeur", "Tablette", "Écran"},
	"Jouets":     {"Puzzle", "Peluche", "Jeu de société", "Construction"},
	"Bricolage":  {"Perceuse", "Établi", "Caisse à outils", "Tondeuse", "Échelle"},
}

// Catalog builds the shared SKU catalog.
func Catalog(cfg Config) []model.SKU {
	r := rand.New(rand.NewSource(cfg.Seed))
	skus := make([]model.SKU, cfg.CatalogSize)
	for i := range skus {
		cat := categories[r.Intn(len(categories))]
		// log-uniform weight within the category range
		w := math.Exp(math.Log(cat.minW) + r.Float64()*(math.Log(cat.maxW)-math.Log(cat.minW)))
		w = math.Round(w*100) / 100
		types := productTypes[cat.name]
		skus[i] = model.SKU{
			Code:     fmt.Sprintf("SKU-%05d", i+1),
			Name:     fmt.Sprintf("%s %s %d", types[r.Intn(len(types))], productWords[r.Intn(len(productWords))], 100+r.Intn(900)),
			Category: cat.name,
			WeightKg: w,
			VolumeL:  math.Round(w*cat.volPerKg*(0.7+0.6*r.Float64())*10) / 10,
		}
	}
	return skus
}

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * R * math.Asin(math.Sqrt(a))
}

func linehaulMinutes(km float64) int {
	m := int(km/75*60) + 45
	if m < 60 {
		m = 60
	}
	return m
}

var streets = []string{"rue de la République", "avenue Jean Jaurès", "rue Victor Hugo", "boulevard Gambetta", "rue Nationale", "place du Marché", "rue de la Gare", "avenue de la Libération", "rue Pasteur", "cours Lafayette"}

func cal(days ...int) model.Calendar {
	return model.Calendar{WorkingDays: days, HonorHolidays: true}
}

var (
	monFri  = []int{1, 2, 3, 4, 5}
	monSat  = []int{1, 2, 3, 4, 5, 6}
	allWeek = []int{1, 2, 3, 4, 5, 6, 7}
)

func tod(s string) model.TimeOfDay { return model.MustTOD(s) }

func regionOf(dept string) string {
	for r, ds := range RegionDepts {
		for _, d := range ds {
			if d == dept {
				return r
			}
		}
	}
	return "IDF"
}

type warehouseSite struct {
	name, pc, dept, metro string
	lat, lon              float64
}

var warehouseSites = []warehouseSite{
	{"Entrepôt Gonesse", "95500", "95", "PARIS", 48.9866, 2.4497},
	{"Entrepôt Saint-Priest", "69800", "69", "LYON", 45.6960, 4.9440},
	{"Entrepôt Vitrolles", "13127", "13", "MARSEILLE", 43.4600, 5.2486},
	{"Entrepôt Mérignac", "33700", "33", "BORDEAUX", 44.8386, -0.6436},
	{"Entrepôt Lesquin", "59810", "59", "LILLE", 50.5890, 3.1110},
	{"Entrepôt Blagnac", "31700", "31", "TOULOUSE", 43.6370, 1.3900},
	{"Entrepôt Carquefou", "44470", "44", "NANTES", 47.2970, -1.4920},
	{"Entrepôt Hoerdt", "67720", "67", "STRASBOURG", 48.6950, 7.7830},
	{"Entrepôt Saran", "45770", "45", "", 47.9500, 1.8760},
	{"Entrepôt Montélimar", "26200", "26", "", 44.5580, 4.7500},
}

var lmhSites = []warehouseSite{
	{"Hub urbain Paris Nord", "93200", "93", "PARIS", 48.9200, 2.3600},
	{"Hub urbain Paris Sud", "94150", "94", "PARIS_SUD", 48.7580, 2.3800},
	{"Hub urbain Lyon", "69007", "69", "LYON", 45.7330, 4.8400},
	{"Hub urbain Marseille", "13014", "13", "MARSEILLE", 43.3450, 5.3900},
	{"Hub urbain Bordeaux", "33300", "33", "BORDEAUX", 44.8700, -0.5600},
	{"Hub urbain Lille", "59000", "59", "LILLE", 50.6200, 3.0400},
	{"Hub urbain Toulouse", "31200", "31", "TOULOUSE", 43.6300, 1.4500},
	{"Hub urbain Nantes", "44300", "44", "NANTES", 47.2500, -1.5200},
	{"Hub urbain Strasbourg", "67100", "67", "STRASBOURG", 48.5600, 7.7600},
	{"Hub urbain Nice", "06200", "06", "NICE", 43.6800, 7.2200},
}

type regionalHub struct {
	id, name, pc, city, region string
	lat, lon                   float64
}

var regionalHubs = []regionalHub{
	{"HUB-IDF", "Plateforme Île-de-France", "95500", "Gonesse", "IDF", 48.9800, 2.4600},
	{"HUB-RHONE", "Plateforme Rhône-Alpes", "69800", "Saint-Priest", "RHONE", 45.7000, 4.9500},
	{"HUB-SUDOUEST", "Plateforme Sud-Ouest", "47000", "Agen", "SUDOUEST", 44.2000, 0.6200},
	{"HUB-OUEST", "Plateforme Ouest", "72000", "Le Mans", "OUEST", 48.0000, 0.2000},
	{"HUB-NORD", "Plateforme Nord-Est", "57000", "Metz", "NORD", 49.1000, 6.1800},
	{"HUB-SUD", "Plateforme Méditerranée", "84000", "Avignon", "SUD", 43.9300, 4.8100},
}

// Generate builds a populated store.
func Generate(cfg Config) *store.Store {
	s := store.New()
	s.Seed = cfg.Seed
	r := rand.New(rand.NewSource(cfg.Seed * 7919))
	allModes := []string{"STANDARD", "EXPRESS", "SAME_DAY", "RELAY"}

	// ---------------- delivery modes
	for _, m := range []model.DeliveryMode{
		{ID: "STANDARD", Name: "Livraison standard", Description: "Livraison à domicile en 2 à 5 jours ouvrés", MaxLegs: 3, MaxSources: 3, AllowConsolidation: true, AllowSplit: true, MaxDeliveryDays: 6, Price: 4.9, Active: true},
		{ID: "EXPRESS", Name: "Livraison express", Description: "Livraison à domicile le lendemain avant 13h", MaxLegs: 2, MaxSources: 2, AllowConsolidation: true, AllowSplit: true, MaxDeliveryDays: 2, Price: 9.9, Active: true},
		{ID: "SAME_DAY", Name: "Livraison le jour même", Description: "Livraison le soir même dans les grandes agglomérations", MaxLegs: 2, MaxSources: 2, AllowConsolidation: true, AllowSplit: false, MaxDeliveryDays: 0, Price: 14.9, Active: true},
		{ID: "RELAY", Name: "Point relais", Description: "Retrait en point relais en 2 à 4 jours", MaxLegs: 3, MaxSources: 3, AllowConsolidation: true, AllowSplit: true, MaxDeliveryDays: 7, Price: 2.9, Active: true},
	} {
		s.Modes.LoadRaw(m)
	}

	// ---------------- carriers & services
	for _, c := range []model.Carrier{
		{ID: "COLIVIA", Name: "Colivia", Active: true},
		{ID: "EXPRESSO", Name: "Expresso Courrier", Active: true},
		{ID: "RELAISPLUS", Name: "Relais Plus", Active: true},
		{ID: "URBIKE", Name: "Urbike Logistique", Active: true},
		{ID: "TRANSALP", Name: "Transalp Messagerie", Active: true},
		{ID: "NAVETTE", Name: "Navette Régionale", Active: true},
	} {
		s.Carriers.LoadRaw(c)
	}
	services := []model.CarrierService{
		{ID: "COLIVIA-STD", CarrierID: "COLIVIA", Name: "Colivia Domicile", Kind: model.KindStandard, Modes: []string{"STANDARD"}, Coverage: []string{"*"}, TransitDays: 2,
			PickupCalendar: cal(monFri...), DeliveryCalendar: cal(monSat...), Cutoff: tod("17:00"), WindowStart: tod("09:00"), WindowEnd: tod("18:00"),
			MaxWeightKg: 30, MaxVolumeL: 150, MaxItems: 30, DailyCapacity: 100000, BaseCost: 5.9, CostPerKg: 0.45, Active: true},
		{ID: "COLIVIA-REG", CarrierID: "COLIVIA", Name: "Colivia Régional J+1", Kind: model.KindHome, Modes: []string{"STANDARD"}, Coverage: []string{"*"}, TransitDays: 1,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), Cutoff: tod("14:00"), WindowStart: tod("09:00"), WindowEnd: tod("18:00"),
			MaxWeightKg: 30, MaxVolumeL: 150, MaxItems: 30, DailyCapacity: 50000, BaseCost: 4.6, CostPerKg: 0.35, Active: true},
		{ID: "EXPRESSO-EXP", CarrierID: "EXPRESSO", Name: "Expresso 13h", Kind: model.KindExpress, Modes: []string{"EXPRESS"}, Coverage: []string{"*"}, ExcludedCoverage: []string{"20", "04", "05", "15", "48"}, TransitDays: 1,
			PickupCalendar: cal(monFri...), DeliveryCalendar: cal(monFri...), Cutoff: tod("17:30"), WindowStart: tod("08:00"), WindowEnd: tod("13:00"),
			MaxWeightKg: 25, MaxVolumeL: 100, MaxItems: 20, DailyCapacity: 30000, BaseCost: 11.5, CostPerKg: 0.8, Active: true},
		{ID: "EXPRESSO-HUB", CarrierID: "EXPRESSO", Name: "Expresso matinal depuis plateforme", Kind: model.KindExpress, Modes: []string{"EXPRESS", "STANDARD"}, Coverage: []string{"*"}, ExcludedCoverage: []string{"20", "04", "05", "15", "48"}, TransitDays: 0,
			PickupCalendar: cal(monFri...), DeliveryCalendar: cal(monFri...), Cutoff: tod("05:30"), WindowStart: tod("09:00"), WindowEnd: tod("13:00"),
			MaxWeightKg: 25, MaxVolumeL: 100, MaxItems: 20, DailyCapacity: 30000, BaseCost: 8.9, CostPerKg: 0.6, Active: true},
		{ID: "RELAIS-STD", CarrierID: "RELAISPLUS", Name: "Relais Plus 48h", Kind: model.KindRelay, Modes: []string{"RELAY"}, Coverage: []string{"*"}, ExcludedCoverage: []string{"20"}, TransitDays: 2,
			PickupCalendar: cal(monFri...), DeliveryCalendar: cal(2, 3, 4, 5, 6), Cutoff: tod("16:30"), WindowStart: tod("10:00"), WindowEnd: tod("19:00"),
			MaxWeightKg: 20, MaxVolumeL: 60, MaxItems: 15, DailyCapacity: 60000, BaseCost: 3.9, CostPerKg: 0.25, Active: true},
		{ID: "URBIKE-AM", CarrierID: "URBIKE", Name: "Urbike tournée matin", Kind: model.KindLastMile, Modes: []string{"STANDARD", "EXPRESS"}, Coverage: []string{"*"}, TransitDays: 0,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), Cutoff: tod("07:30"), WindowStart: tod("09:00"), WindowEnd: tod("13:00"),
			MaxWeightKg: 15, MaxVolumeL: 80, MaxItems: 20, DailyCapacity: 8000, BaseCost: 4.9, CostPerKg: 0.2, Active: true},
		{ID: "URBIKE-PM", CarrierID: "URBIKE", Name: "Urbike tournée après-midi", Kind: model.KindLastMile, Modes: []string{"STANDARD", "EXPRESS"}, Coverage: []string{"*"}, TransitDays: 0,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), Cutoff: tod("13:30"), WindowStart: tod("14:00"), WindowEnd: tod("20:00"),
			MaxWeightKg: 15, MaxVolumeL: 80, MaxItems: 20, DailyCapacity: 8000, BaseCost: 4.9, CostPerKg: 0.2, Active: true},
		{ID: "URBIKE-SD", CarrierID: "URBIKE", Name: "Urbike jour même", Kind: model.KindSameDay, Modes: []string{"SAME_DAY"}, Coverage: []string{"*"}, TransitDays: 0,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), Cutoff: tod("15:30"), WindowStart: tod("17:00"), WindowEnd: tod("21:00"),
			MaxWeightKg: 12, MaxVolumeL: 60, MaxItems: 15, DailyCapacity: 3000, BaseCost: 12.9, CostPerKg: 0.3, Active: true},
		{ID: "URBIKE-SFS", CarrierID: "URBIKE", Name: "Urbike livraison depuis magasin", Kind: model.KindStore, Modes: []string{"SAME_DAY", "EXPRESS"}, Coverage: []string{"*"}, TransitDays: 0,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), Cutoff: tod("15:00"), WindowStart: tod("17:00"), WindowEnd: tod("21:00"),
			MaxWeightKg: 12, MaxVolumeL: 60, MaxItems: 15, DailyCapacity: 2000, BaseCost: 9.9, CostPerKg: 0.3, Active: true},
		{ID: "TRANSALP-LH", CarrierID: "TRANSALP", Name: "Transalp traction de nuit", Kind: model.KindLinehaul, Coverage: []string{"*"}, TransitMinutes: 360,
			PickupCalendar: cal(monFri...), DeliveryCalendar: cal(allWeek...), Cutoff: tod("21:00"),
			MaxWeightKg: 30, MaxVolumeL: 200, DailyCapacity: 200000, BaseCost: 1.1, CostPerKg: 0.08, Active: true},
		{ID: "NAVETTE-REG", CarrierID: "NAVETTE", Name: "Navette inter-sites", Kind: model.KindShuttle, Coverage: []string{"*"}, TransitMinutes: 90,
			PickupCalendar: cal(monSat...), DeliveryCalendar: cal(monSat...), Cutoff: tod("17:30"),
			MaxWeightKg: 30, MaxVolumeL: 200, DailyCapacity: 20000, BaseCost: 0.7, CostPerKg: 0.02, Active: true},
	}
	for _, sv := range services {
		s.Services.LoadRaw(sv)
	}

	// ---------------- stock points
	type site struct {
		id, metro, dept, region string
		lat, lon                float64
		typ                     model.StockPointType
	}
	var sites []site
	storeCities := expandCities(cfg.Stores)
	for i, c := range storeCities {
		id := fmt.Sprintf("STORE-%03d", i+1)
		lat := c.Lat + (r.Float64()-0.5)*0.04
		lon := c.Lon + (r.Float64()-0.5)*0.05
		open := tod("10:00")
		close := tod("19:30")
		prepDays := monSat
		switch r.Intn(6) {
		case 0:
			open, close = tod("09:00"), tod("20:00")
		case 1:
			prepDays = []int{2, 3, 4, 5, 6} // closed on Monday
		case 2:
			if c.Metro == "PARIS" {
				prepDays = allWeek
			}
		}
		cutoffs := []string{"15:00", "16:00", "17:00", "18:00"}
		sp := model.StockPoint{
			ID: id, Name: fmt.Sprintf("Magasin %s %d", c.Name, countCity(storeCities[:i+1], c.Name)), Type: model.StockPointStore,
			Address: model.Address{Line1: fmt.Sprintf("%d %s", 1+r.Intn(120), streets[r.Intn(len(streets))]), PostalCode: c.PostalCode, City: c.Name, Country: "FR"},
			Lat:     round5(lat), Lon: round5(lon), Timezone: "Europe/Paris", OpeningTime: open, ClosingTime: close,
			PrepCalendar: cal(prepDays...), PrepTimeMinutes: 60 + 30*r.Intn(5), Cutoff: tod(cutoffs[r.Intn(len(cutoffs))]),
			DailyCapacity: 50 + 25*r.Intn(10), SafetyStock: 1, AllowedModes: allModes, PrepCostPerParcel: 2.5, Active: true,
		}
		s.StockPoints.LoadRaw(sp)
		sites = append(sites, site{id, c.Metro, c.Dept, regionOf(c.Dept), sp.Lat, sp.Lon, sp.Type})
	}
	for i := 0; i < cfg.Warehouses; i++ {
		w := warehouseSites[i%len(warehouseSites)]
		id := fmt.Sprintf("WH-%02d", i+1)
		days := monFri
		if i%3 == 0 {
			days = monSat
		}
		sp := model.StockPoint{
			ID: id, Name: w.name, Type: model.StockPointWarehouse,
			Address: model.Address{Line1: fmt.Sprintf("ZAC des Entrepôts, lot %d", 10+i), PostalCode: w.pc, City: strings.TrimPrefix(w.name, "Entrepôt "), Country: "FR"},
			Lat:     w.lat, Lon: w.lon, Timezone: "Europe/Paris", OpeningTime: tod("06:00"), ClosingTime: tod("22:00"),
			PrepCalendar: cal(days...), PrepTimeMinutes: 120, Cutoff: tod([]string{"14:00", "15:00", "16:00"}[i%3]),
			DailyCapacity: 20000, SafetyStock: 0, AllowedModes: []string{"STANDARD", "EXPRESS", "RELAY"}, PrepCostPerParcel: 0.9, Active: true,
		}
		s.StockPoints.LoadRaw(sp)
		sites = append(sites, site{id, w.metro, w.dept, regionOf(w.dept), w.lat, w.lon, sp.Type})
	}
	for i := 0; i < cfg.LastMileHubs; i++ {
		l := lmhSites[i%len(lmhSites)]
		id := fmt.Sprintf("LMH-%02d", i+1)
		sp := model.StockPoint{
			ID: id, Name: l.name, Type: model.StockPointLastMileHub,
			Address: model.Address{Line1: fmt.Sprintf("%d quai de la Logistique", 1+i), PostalCode: l.pc, City: strings.TrimPrefix(l.name, "Hub urbain "), Country: "FR"},
			Lat:     l.lat, Lon: l.lon, Timezone: "Europe/Paris", OpeningTime: tod("05:00"), ClosingTime: tod("23:00"),
			PrepCalendar: cal(monSat...), PrepTimeMinutes: 45, Cutoff: tod("20:00"),
			DailyCapacity: 3000, SafetyStock: 0, AllowedModes: allModes, PrepCostPerParcel: 1.2, Active: true,
		}
		s.StockPoints.LoadRaw(sp)
		sites = append(sites, site{id, l.metro, l.dept, regionOf(l.dept), l.lat, l.lon, sp.Type})
		s.Hubs.LoadRaw(model.Hub{
			ID: id, Name: l.name, Kind: model.HubLastMile, StockPointID: id, PostalCode: l.pc, City: sp.Address.City, Lat: l.lat, Lon: l.lon,
			Calendar: cal(monSat...), OpeningTime: tod("04:00"), ClosingTime: tod("23:00"), SortingMinutes: 45,
			ConsolidationEnabled: true, ConsolidationMinutes: 60, MaxConsolidationWaitHours: 36, ConsolidationCost: 0.6, Active: true,
		})
	}
	for _, h := range regionalHubs {
		s.Hubs.LoadRaw(model.Hub{
			ID: h.id, Name: h.name, Kind: model.HubConsolidation, PostalCode: h.pc, City: h.city, Lat: h.lat, Lon: h.lon,
			Calendar: model.Calendar{WorkingDays: monFri, HonorHolidays: true}, OpeningTime: tod("00:00"), ClosingTime: tod("24:00"), SortingMinutes: 60,
			ConsolidationEnabled: true, ConsolidationMinutes: 120, MaxConsolidationWaitHours: 48, ConsolidationCost: 0.8, Active: true,
		})
	}

	// ---------------- legs
	legSeq := 0
	addLeg := func(l model.Leg) string {
		legSeq++
		l.ID = fmt.Sprintf("LEG-%04d", legSeq)
		l.Active = true
		s.Legs.LoadRaw(l)
		return l.ID
	}
	lmhByMetro := map[string]site{}
	for _, st := range sites {
		if st.typ == model.StockPointLastMileHub {
			lmhByMetro[st.metro] = st
		}
	}
	hubByRegion := map[string]regionalHub{}
	for _, h := range regionalHubs {
		hubByRegion[h.region] = h
	}
	type routeSeed struct {
		legs []string
		name string
	}
	var routeSeeds []routeSeed
	lmhFinalAM := map[string]string{}
	hubToLMH := map[string]string{}
	for _, st := range sites {
		switch st.typ {
		case model.StockPointStore:
			if r.Float64() < 0.85 {
				addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", Departures: []model.TimeOfDay{tod([]string{"16:00", "17:00"}[r.Intn(2)])}, CutoffMinutesBefore: 30})
			}
			if r.Float64() < 0.7 {
				addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "RELAISPLUS", ServiceID: "RELAIS-STD", Departures: []model.TimeOfDay{tod("16:30")}, CutoffMinutesBefore: 15})
			}
			if st.metro != "" && r.Float64() < 0.6 || st.metro == "" && r.Float64() < 0.25 {
				addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "EXPRESSO", ServiceID: "EXPRESSO-EXP", Departures: []model.TimeOfDay{tod("17:30")}, CutoffMinutesBefore: 30})
			}
			if st.metro != "" {
				if lmh, ok := lmhByMetro[st.metro]; ok {
					km := haversineKm(st.lat, st.lon, lmh.lat, lmh.lon)
					addLeg(model.Leg{From: st.id, To: lmh.id, CarrierID: "NAVETTE", ServiceID: "NAVETTE-REG", Departures: []model.TimeOfDay{tod("12:00"), tod("17:30")}, CutoffMinutesBefore: 15, TransitMinutes: 30 + int(km*2)})
				}
				if r.Float64() < 0.6 {
					addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "URBIKE", ServiceID: "URBIKE-SFS", DestinationZones: MetroDepts[st.metro], Departures: []model.TimeOfDay{tod("15:00")}, CutoffMinutesBefore: 15})
				}
			}
			if st.metro == "" || r.Float64() < 0.5 {
				h := hubByRegion[st.region]
				km := haversineKm(st.lat, st.lon, h.lat, h.lon)
				addLeg(model.Leg{From: st.id, To: h.id, CarrierID: "TRANSALP", ServiceID: "TRANSALP-LH", Departures: []model.TimeOfDay{tod("18:30")}, CutoffMinutesBefore: 30, TransitMinutes: linehaulMinutes(km)})
			}
		case model.StockPointWarehouse:
			addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", Departures: []model.TimeOfDay{tod("20:00")}, CutoffMinutesBefore: 60})
			addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "EXPRESSO", ServiceID: "EXPRESSO-EXP", Departures: []model.TimeOfDay{tod("19:00")}, CutoffMinutesBefore: 60})
			addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "RELAISPLUS", ServiceID: "RELAIS-STD", Departures: []model.TimeOfDay{tod("19:30")}, CutoffMinutesBefore: 60})
			for _, l := range sites {
				if l.typ != model.StockPointLastMileHub {
					continue
				}
				km := haversineKm(st.lat, st.lon, l.lat, l.lon)
				if km > 700 {
					continue
				}
				addLeg(model.Leg{From: st.id, To: l.id, CarrierID: "TRANSALP", ServiceID: "TRANSALP-LH", Departures: []model.TimeOfDay{tod("21:00")}, CutoffMinutesBefore: 60, TransitMinutes: linehaulMinutes(km)})
			}
			h := hubByRegion[st.region]
			km := haversineKm(st.lat, st.lon, h.lat, h.lon)
			addLeg(model.Leg{From: st.id, To: h.id, CarrierID: "TRANSALP", ServiceID: "TRANSALP-LH", Departures: []model.TimeOfDay{tod("22:00")}, CutoffMinutesBefore: 60, TransitMinutes: linehaulMinutes(km)})
		case model.StockPointLastMileHub:
			zones := MetroDepts[st.metro]
			lmhFinalAM[st.id] = addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "URBIKE", ServiceID: "URBIKE-AM", DestinationZones: zones, Departures: []model.TimeOfDay{tod("07:30")}, CutoffMinutesBefore: 30})
			addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "URBIKE", ServiceID: "URBIKE-PM", DestinationZones: zones, Departures: []model.TimeOfDay{tod("13:30")}, CutoffMinutesBefore: 30})
			addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "URBIKE", ServiceID: "URBIKE-SD", DestinationZones: zones, Departures: []model.TimeOfDay{tod("15:30")}, CutoffMinutesBefore: 30})
			addLeg(model.Leg{From: st.id, To: model.CustomerNode, CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", Departures: []model.TimeOfDay{tod("19:00")}, CutoffMinutesBefore: 30})
		}
	}
	for _, h := range regionalHubs {
		addLeg(model.Leg{From: h.id, To: model.CustomerNode, CarrierID: "COLIVIA", ServiceID: "COLIVIA-REG", DestinationZones: RegionDepts[h.region], Departures: []model.TimeOfDay{tod("06:00"), tod("14:00")}, CutoffMinutesBefore: 30})
		addLeg(model.Leg{From: h.id, To: model.CustomerNode, CarrierID: "EXPRESSO", ServiceID: "EXPRESSO-HUB", DestinationZones: RegionDepts[h.region], Departures: []model.TimeOfDay{tod("05:30")}, CutoffMinutesBefore: 30})
		for _, l := range sites {
			if l.typ != model.StockPointLastMileHub || l.region != h.region {
				continue
			}
			km := haversineKm(h.lat, h.lon, l.lat, l.lon)
			hubToLMH[h.id+">"+l.id] = addLeg(model.Leg{From: h.id, To: l.id, CarrierID: "TRANSALP", ServiceID: "TRANSALP-LH", Departures: []model.TimeOfDay{tod("03:00")}, CutoffMinutesBefore: 30, TransitMinutes: linehaulMinutes(km)})
		}
	}
	// Explicit named 3-leg routes: store -> regional hub -> LMH -> customer.
	for _, lg := range s.Legs.All() {
		if !strings.HasPrefix(lg.From, "STORE-") || !strings.HasPrefix(lg.To, "HUB-") {
			continue
		}
		keys := make([]string, 0, len(hubToLMH))
		for k := range hubToLMH {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, key := range keys {
			h2l := hubToLMH[key]
			parts := strings.Split(key, ">")
			if parts[0] != lg.To {
				continue
			}
			if am, ok := lmhFinalAM[parts[1]]; ok && len(routeSeeds) < 12 {
				routeSeeds = append(routeSeeds, routeSeed{[]string{lg.ID, h2l, am}, fmt.Sprintf("%s → %s → %s → Client", lg.From, parts[0], parts[1])})
			}
		}
	}
	sort.Slice(routeSeeds, func(i, j int) bool { return routeSeeds[i].name < routeSeeds[j].name })
	for i, rs := range routeSeeds {
		s.Routes.LoadRaw(model.Route{ID: fmt.Sprintf("ROUTE-%03d", i+1), Name: rs.name, LegIDs: rs.legs, Modes: []string{"STANDARD", "EXPRESS"},
			Description: "Route multi-leg magasin → plateforme régionale → hub dernier kilomètre → client", Active: true})
	}

	// ---------------- catalog & stock
	skus := Catalog(cfg)
	s.InitStock(skus)
	generateStock(s, cfg)
	s.LoadSettingsRaw(model.DefaultSettings())
	generateScenarios(s)
	s.BumpConfig()
	return s
}

func round5(x float64) float64 { return math.Round(x*1e5) / 1e5 }

func countCity(cs []City, name string) int {
	n := 0
	for _, c := range cs {
		if c.Name == name {
			n++
		}
	}
	return n
}

// expandCities places n stores according to city weights.
func expandCities(n int) []City {
	var out []City
	for len(out) < n {
		for _, c := range Cities {
			for w := 0; w < c.Weight && len(out) < n; w++ {
				out = append(out, c)
			}
		}
	}
	return out[:n]
}

// generateStock fills the matrix. Quantities are drawn in parallel (one RNG
// per stock point derived from the seed, so the result does not depend on
// scheduling) and written serially: bitmap words are shared by 64 points.
func generateStock(s *store.Store, cfg Config) {
	st := s.Stock
	pts := s.StockPoints.All()
	n := len(st.SKUs())
	per := cfg.SKUsPerPoint
	if per > n {
		per = n
	}
	type column struct {
		col  int
		skus []int
		phys []int32
		res  []int32
	}
	cols := make([]column, len(pts))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, sp := range pts {
		col, ok := st.PointIndex(sp.ID)
		if !ok {
			cols[i].col = -1
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, sp model.StockPoint, col int) {
			defer wg.Done()
			defer func() { <-sem }()
			r := rand.New(rand.NewSource(cfg.Seed*1_000_003 + int64(col)*7_919 + 17))
			universe := n
			if sp.Type == model.StockPointWarehouse && cfg.WarehouseCatalog >= per && cfg.WarehouseCatalog < n {
				universe = cfg.WarehouseCatalog
			}
			perm := r.Perm(universe)[:per]
			zero := cfg.ZeroStore
			switch sp.Type {
			case model.StockPointWarehouse:
				zero = cfg.ZeroWarehouse
			case model.StockPointLastMileHub:
				zero = cfg.ZeroLastMile
			}
			c := column{col: col, skus: perm, phys: make([]int32, per), res: make([]int32, per)}
			for j := range perm {
				var phys int32
				if r.Float64() >= zero {
					switch sp.Type {
					case model.StockPointWarehouse:
						phys = int32(10 + r.Intn(390))
					case model.StockPointLastMileHub:
						phys = int32(1 + r.Intn(25))
					default:
						phys = int32(1 + int(r.ExpFloat64()*3))
						if phys > 25 {
							phys = 25
						}
					}
				}
				var res int32
				if phys > 0 && r.Float64() < 0.15 {
					res = int32(r.Intn(int(phys) + 1))
				}
				c.phys[j], c.res[j] = phys, res
			}
			cols[i] = c
		}(i, sp, col)
	}
	wg.Wait()
	st.Lock()
	defer st.Unlock()
	for _, c := range cols {
		if c.col < 0 {
			continue
		}
		for j, k := range c.skus {
			st.SetRaw(k, c.col, c.phys[j], c.res[j], true)
		}
	}
}

// generateScenarios stores reference baskets derived from the real stock.
func generateScenarios(s *store.Store) {
	st := s.Stock
	created := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	ref := time.Date(2026, 10, 12, 10, 0, 0, 0, time.FixedZone("CEST", 2*3600))
	// find SKUs available in a Lyon store but not in the others, etc.
	lyonStores := []string{}
	for _, p := range s.StockPoints.All() {
		if p.Type == model.StockPointStore && p.Address.City == "Lyon" {
			lyonStores = append(lyonStores, p.ID)
		}
	}
	pick := func(filter func(code string) bool, n int) []string {
		var out []string
		for _, k := range st.SKUs() {
			if k.WeightKg > 6 {
				continue
			}
			if filter(k.Code) {
				out = append(out, k.Code)
				if len(out) == n {
					break
				}
			}
		}
		return out
	}
	prom := func(point, code string) int {
		l, err := st.Line(point, code)
		if err != nil {
			return 0
		}
		return l.Promisable
	}
	var single, multi []string
	if len(lyonStores) >= 2 {
		single = pick(func(c string) bool { return prom(lyonStores[0], c) >= 2 }, 3)
		a := pick(func(c string) bool { return prom(lyonStores[0], c) >= 2 && prom(lyonStores[1], c) == 0 }, 1)
		b := pick(func(c string) bool { return prom(lyonStores[1], c) >= 1 && prom(lyonStores[0], c) == 0 }, 2)
		multi = append(a, b...)
	}
	mk := func(id, name, desc, pc string, at time.Time, items []string, qty []int, modes []string, tags ...string) {
		var bi []model.BasketItem
		for i, it := range items {
			q := 1
			if i < len(qty) {
				q = qty[i]
			}
			bi = append(bi, model.BasketItem{SKU: it, Quantity: q})
		}
		if len(bi) == 0 {
			return
		}
		s.Scenarios.LoadRaw(model.Scenario{ID: id, Name: name, Description: desc, Tags: tags, CreatedAt: created,
			Request: model.PromiseRequest{Destination: model.Destination{Country: "FR", PostalCode: pc}, OrderDate: at, Items: bi, DeliveryModes: modes, MaxOptions: 6}})
	}
	all := []string{"STANDARD", "EXPRESS", "SAME_DAY", "RELAY"}
	mk("SCN-001", "Mono-article Bordeaux", "Un article, livraison standard et express vers Bordeaux", "33000", ref, single[:min(1, len(single))], []int{1}, []string{"STANDARD", "EXPRESS"}, "mono")
	mk("SCN-002", "Panier mono-magasin Lyon", "Trois articles disponibles dans un même magasin lyonnais", "69002", ref, single, []int{2, 1, 1}, all, "multi-articles")
	mk("SCN-003", "Multi-sources Lyon", "Articles répartis entre deux magasins lyonnais : expéditions directes ou consolidation", "69003", ref, multi, []int{2, 1, 1}, all, "multi-sources", "consolidation")
	mk("SCN-004", "Commande après cut-off du vendredi", "Commande passée vendredi soir : traverse le week-end", "75011", time.Date(2026, 10, 16, 21, 30, 0, 0, time.FixedZone("CEST", 2*3600)), single, []int{1, 1, 1}, all, "cut-off", "week-end")
	mk("SCN-005", "Veille de la Toussaint", "Commande la veille du 1er novembre (dimanche) et de l'Armistice", "31000", time.Date(2026, 11, 10, 15, 0, 0, 0, time.FixedZone("CET", 3600)), single, []int{1, 1, 1}, all, "jour férié")
	mk("SCN-006", "Corse", "Destination en Corse : pas d'express ni de relais", "20000", ref, single, []int{1, 1, 1}, all, "zone restreinte")
	mk("SCN-007", "DOM non desservi", "Destination outre-mer non desservie", "97400", ref, single, []int{1}, all, "non desservi")
	mk("SCN-008", "Grosse quantité", "Quantité supérieure au stock d'un magasin", "13001", ref, single[:min(1, len(single))], []int{40}, all, "split")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
