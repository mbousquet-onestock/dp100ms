package datagen

import (
	"math"
	"math/rand"
	"strconv"
	"strings"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

// shapes give the length:width:height ratios of the product types.
var shapes = map[string][3]float64{
	"T-shirt": {3, 2, 0.3}, "Chemise": {3, 2, 0.3}, "Pull": {3, 2, 0.5}, "Jean": {3, 2, 0.4}, "Robe": {3, 2, 0.4},
	"Veste": {3, 2, 0.6}, "Manteau": {3, 2, 0.8}, "Baskets": {3, 2, 1.2}, "Bottines": {3, 2, 1.3}, "Sandales": {3, 2, 1},
	"Mocassins": {3, 2, 1.1}, "Lampe": {1.5, 1, 1}, "Coussin": {1, 1, 0.4}, "Plaid": {2, 1.5, 0.5}, "Vase": {1.2, 1, 1},
	"Cafetière": {1.3, 1, 1}, "Poêle": {2.5, 1.5, 0.3}, "Ballon": {1, 1, 1}, "Raquette": {3, 1, 0.3}, "Haltères": {2, 1, 1},
	"Tapis": {4, 0.6, 0.6}, "Vélo d'appartement": {2.5, 1, 2}, "Crème": {1.5, 1, 1}, "Parfum": {1.2, 1, 1.5},
	"Shampooing": {1, 1, 2.5}, "Sérum": {1, 1, 2}, "Casque": {1.2, 1, 0.8}, "Enceinte": {1.5, 1, 1}, "Chargeur": {1.5, 1, 0.5},
	"Tablette": {3, 2, 0.3}, "Écran": {6, 3.5, 0.6}, "Puzzle": {2, 1.5, 0.4}, "Peluche": {1.5, 1, 1}, "Jeu de société": {2, 2, 0.5},
	"Construction": {2, 1.5, 0.6}, "Perceuse": {2, 1, 0.8}, "Établi": {4, 2, 1}, "Caisse à outils": {2, 1, 1},
	"Tondeuse": {3, 2, 1.5}, "Échelle": {12, 1.5, 0.5},
}

var priceRange = map[string][2]float64{
	"Mode": {15, 120}, "Chaussures": {40, 180}, "Maison": {12, 250}, "Sport": {10, 400}, "Beauté": {8, 120},
	"High-tech": {20, 900}, "Jouets": {10, 90}, "Bricolage": {20, 600},
}

func productType(name string) string {
	for t := range shapes {
		if strings.HasPrefix(name, t+" ") {
			return t
		}
	}
	return ""
}

// enrichCatalog adds dimensions, prices and attributes with a dedicated RNG
// so that weights and volumes stay identical to earlier versions.
func enrichCatalog(skus []model.SKU, cfg Config) {
	r := rand.New(rand.NewSource(cfg.Seed*31 + 7))
	storeOnly := cfg.WarehouseCatalog
	for i := range skus {
		k := &skus[i]
		t := productType(k.Name)
		sh, ok := shapes[t]
		if !ok {
			sh = [3]float64{1.5, 1, 1}
		}
		// scale the shape so that L×W×H matches the volume (packaging +20 %)
		vol := math.Max(k.VolumeL, 0.2) * 1000 * 1.2
		unit := math.Cbrt(vol / (sh[0] * sh[1] * sh[2]))
		k.LengthCm = math.Round(sh[0]*unit*10) / 10
		k.WidthCm = math.Round(sh[1]*unit*10) / 10
		k.HeightCm = math.Round(sh[2]*unit*10) / 10
		pr := priceRange[k.Category]
		k.PriceEur = math.Round((pr[0]+(pr[1]-pr[0])*math.Pow(r.Float64(), 2))*100) / 100
		attrs := map[string]any{}
		switch t {
		case "Parfum":
			attrs["hazmat"] = "UN1266"
		case "Vase", "Lampe", "Écran":
			attrs["fragile"] = true
		case "Tablette", "Casque", "Enceinte", "Perceuse":
			attrs["battery"] = "lithium-ion"
		}
		switch t {
		case "Écran", "Vélo d'appartement", "Établi", "Tondeuse":
			attrs["installable"] = true
		}
		if k.LengthCm >= 100 || k.WeightKg >= 15 {
			attrs["bulky"] = true
		}
		if storeOnly > 0 && i >= storeOnly {
			attrs["collection"] = "magasin"
		}
		if len(attrs) > 0 {
			k.Attributes = attrs
		}
	}
}

func fp(x float64) *float64 { return &x }

func rng(min, max float64) model.Range {
	r := model.Range{}
	if min > 0 {
		r.Min = fp(min)
	}
	if max > 0 {
		r.Max = fp(max)
	}
	return r
}

// weightGrid builds a cost grid by chargeable weight bands with carbon.
func weightGrid(bands []float64, prices []float64, perKgAbove float64, carbonPerKgKm, carbonFixed float64) []model.RateRow {
	var rows []model.RateRow
	lo := 0.0
	for i, hi := range bands {
		rows = append(rows, model.RateRow{
			Label:      bandLabel(lo, hi),
			Conditions: map[string]model.Range{"chargeableWeightKg": rng(lo, hi)},
			Outputs: map[string]model.Components{
				model.OutCost:   {Fixed: prices[i]},
				model.OutCarbon: {Fixed: carbonFixed, PerKgKm: carbonPerKgKm},
			},
		})
		lo = hi
	}
	if perKgAbove > 0 {
		rows = append(rows, model.RateRow{
			Label:      bandLabel(lo, 0),
			Conditions: map[string]model.Range{"chargeableWeightKg": rng(lo, 0)},
			Outputs: map[string]model.Components{
				model.OutCost:   {Fixed: prices[len(prices)-1], PerKg: perKgAbove},
				model.OutCarbon: {Fixed: carbonFixed, PerKgKm: carbonPerKgKm},
			},
		})
	}
	return rows
}

func bandLabel(lo, hi float64) string {
	f := func(x float64) string { return strconv.FormatFloat(x, 'f', -1, 64) }
	if hi == 0 {
		return "≥ " + f(lo) + " kg"
	}
	return f(lo) + " – " + f(hi) + " kg"
}

// generatePricing creates rate cards, restrictions, additional services,
// stock views and mode criteria for the reference dataset.
func generatePricing(s *store.Store) {
	cards := []model.RateCard{
		{ID: "RC-COLIVIA-STD", Name: "Colivia Domicile — coût", CarrierID: "COLIVIA", Scope: model.ScopeParcel, Currency: "EUR", VolumetricDivisor: 5000, NoMatch: "REJECT",
			Derived: []model.DerivedMetric{{Key: "longueurPlusPourtour", Label: "Longueur + 2 × (largeur + hauteur)", Terms: []model.Term{{Var: "lengthCm", Coef: 1}, {Var: "widthCm", Coef: 2}, {Var: "heightCm", Coef: 2}}}},
			Rows:    weightGrid([]float64{0.5, 1, 2, 5, 10, 20, 30}, []float64{4.6, 5.2, 6.1, 7.9, 10.9, 15.5, 21.4}, 0, 0.00025, 0.08),
			Surcharges: []model.Surcharge{
				{Label: "Hors gabarit (L + pourtour > 150 cm)", Conditions: map[string]model.Range{"longueurPlusPourtour": rng(150, 0)}, Outputs: map[string]model.Components{model.OutCost: {Fixed: 12}}},
			}, Active: true},
		{ID: "RC-COLIVIA-CORSE", Name: "Colivia Corse — coût", CarrierID: "COLIVIA", Scope: model.ScopeParcel, Currency: "EUR", VolumetricDivisor: 5000, NoMatch: "REJECT",
			Description: "Grille appliquée par le planning Corse (traversée maritime)",
			Rows:        weightGrid([]float64{1, 5, 10, 30}, []float64{11.9, 15.8, 21.5, 34.0}, 0, 0.00045, 0.2), Active: true},
		{ID: "RC-COLIVIA-REG", Name: "Colivia Régional — coût", CarrierID: "COLIVIA", Scope: model.ScopeParcel, Currency: "EUR", VolumetricDivisor: 5000, NoMatch: "REJECT",
			Rows: weightGrid([]float64{1, 5, 10, 30}, []float64{3.9, 5.4, 7.8, 13.2}, 0, 0.00022, 0.06), Active: true},
		{ID: "RC-EXPRESSO", Name: "Expresso 13h — coût", CarrierID: "EXPRESSO", Scope: model.ScopeParcel, Currency: "EUR", VolumetricDivisor: 4000, NoMatch: "REJECT",
			Rows:       weightGrid([]float64{1, 3, 5, 10, 25}, []float64{11.5, 13.2, 15.4, 19.9, 29.0}, 0, 0.0009, 0.25),
			Surcharges: []model.Surcharge{{Label: "Article fragile", Rules: []model.Rule{{Field: "attributes.fragile", Op: model.OpEq, Value: true}}, Outputs: map[string]model.Components{model.OutCost: {Fixed: 3}}}},
			Active:     true},
		{ID: "RC-RELAIS", Name: "Relais Plus — coût", CarrierID: "RELAISPLUS", Scope: model.ScopeParcel, Currency: "EUR", VolumetricDivisor: 6000, NoMatch: "REJECT",
			Rows: weightGrid([]float64{1, 3, 5, 10, 20}, []float64{3.4, 3.9, 4.6, 6.2, 8.9}, 0, 0.00018, 0.03), Active: true},
		{ID: "RC-URBIKE", Name: "Urbike vélo-cargo — coût", CarrierID: "URBIKE", Scope: model.ScopeParcel, Currency: "EUR", NoMatch: "REJECT",
			Rows: []model.RateRow{
				{Label: "≤ 5 kg", Conditions: map[string]model.Range{"weightKg": rng(0, 5)}, Outputs: map[string]model.Components{model.OutCost: {Fixed: 4.9}, model.OutCarbon: {Fixed: 0.005}}},
				{Label: "5 – 15 kg", Conditions: map[string]model.Range{"weightKg": rng(5, 15)}, Outputs: map[string]model.Components{model.OutCost: {Fixed: 6.9}, model.OutCarbon: {Fixed: 0.01}}},
			}, Active: true},
		{ID: "RC-URBIKE-SD", Name: "Urbike jour même — coût", CarrierID: "URBIKE", Scope: model.ScopeShipment, Currency: "EUR",
			Rows: []model.RateRow{{Outputs: map[string]model.Components{model.OutCost: {Fixed: 11.9, PerParcel: 1, PerKm: 0.35}, model.OutCarbon: {PerKm: 0.05}}}}, Active: true},
		{ID: "RC-TRANSALP", Name: "Transalp traction — coût", CarrierID: "TRANSALP", Scope: model.ScopeParcel, Currency: "EUR",
			Rows: []model.RateRow{{Outputs: map[string]model.Components{model.OutCost: {Fixed: 0.6, PerKgKm: 0.00012}, model.OutCarbon: {PerKgKm: 0.0001}}}}, Active: true},
		{ID: "RC-NAVETTE", Name: "Navette inter-sites — coût", CarrierID: "NAVETTE", Scope: model.ScopeShipment, Currency: "EUR",
			Rows: []model.RateRow{{Outputs: map[string]model.Components{model.OutCost: {Fixed: 0.5, PerParcel: 0.3}, model.OutCarbon: {PerKgKm: 0.0002}}}}, Active: true},
		// customer prices (franco)
		{ID: "PRICE-STANDARD", Name: "Prix client standard (franco 60 €)", Scope: model.ScopeOrder, Currency: "EUR", Rows: []model.RateRow{
			{Label: "Franco ≥ 60 €", Conditions: map[string]model.Range{"orderAmount": rng(60, 0)}, Outputs: map[string]model.Components{model.OutPrice: {}}},
			{Label: "Colis lourd", Conditions: map[string]model.Range{"weightKg": rng(20, 0)}, Outputs: map[string]model.Components{model.OutPrice: {Fixed: 9.9}}},
			{Label: "Tarif de base", Outputs: map[string]model.Components{model.OutPrice: {Fixed: 4.9}}},
		}, Active: true},
		{ID: "PRICE-EXPRESS", Name: "Prix client express (franco 150 €)", Scope: model.ScopeOrder, Currency: "EUR", Rows: []model.RateRow{
			{Label: "Franco ≥ 150 €", Conditions: map[string]model.Range{"orderAmount": rng(150, 0)}, Outputs: map[string]model.Components{model.OutPrice: {}}},
			{Label: "Tarif de base", Outputs: map[string]model.Components{model.OutPrice: {Fixed: 9.9, PerParcel: 2}}},
		}, Active: true},
		{ID: "PRICE-SAMEDAY", Name: "Prix client jour même", Scope: model.ScopeOrder, Currency: "EUR", Rows: []model.RateRow{
			{Outputs: map[string]model.Components{model.OutPrice: {Fixed: 14.9}}},
		}, Active: true},
		{ID: "PRICE-RELAY", Name: "Prix client point relais (franco 40 €)", Scope: model.ScopeOrder, Currency: "EUR", Rows: []model.RateRow{
			{Conditions: map[string]model.Range{"orderAmount": rng(40, 0)}, Outputs: map[string]model.Components{model.OutPrice: {}}},
			{Outputs: map[string]model.Components{model.OutPrice: {Fixed: 2.9}}},
		}, Active: true},
		{ID: "PRICE-ECO", Name: "Prix client éco (franco 50 €)", Scope: model.ScopeOrder, Currency: "EUR", Rows: []model.RateRow{
			{Conditions: map[string]model.Range{"orderAmount": rng(50, 0)}, Outputs: map[string]model.Components{model.OutPrice: {}}},
			{Outputs: map[string]model.Components{model.OutPrice: {Fixed: 3.9}}},
		}, Active: true},
	}
	for _, c := range cards {
		s.RateCards.LoadRaw(c)
	}
	services := []model.AdditionalService{
		{ID: "INSTALLATION", Name: "Installation et mise en service", Kind: "INSTALLATION", Active: true, ExtraDays: 1,
			Description: "Installation à domicile par un technicien, sur rendez-vous",
			AppliesTo:   []model.Rule{{Field: "attributes.installable", Op: model.OpEq, Value: true}},
			Outputs:     map[string]model.Components{model.OutPrice: {PerItem: 49}, model.OutCost: {PerItem: 32}, model.OutCarbon: {PerItem: 1.2}}},
		{ID: "FLOOR_DELIVERY", Name: "Livraison dans la pièce", Kind: "DELIVERY", Active: true,
			Description: "Livraison à l'étage dans la pièce de votre choix (articles volumineux)",
			AppliesTo:   []model.Rule{{Field: "attributes.bulky", Op: model.OpEq, Value: true}},
			Outputs:     map[string]model.Components{model.OutPrice: {Fixed: 19}, model.OutCost: {Fixed: 12}}},
		{ID: "TAKE_BACK", Name: "Reprise de l'ancien appareil", Kind: "TAKE_BACK", Active: true,
			AppliesTo: []model.Rule{{Field: "attributes.installable", Op: model.OpEq, Value: true}},
			Outputs:   map[string]model.Components{model.OutPrice: {PerItem: 15}, model.OutCost: {PerItem: 10}}},
		{ID: "APPOINTMENT", Name: "Livraison sur rendez-vous", Kind: "APPOINTMENT", Active: true,
			Outputs: map[string]model.Components{model.OutPrice: {Fixed: 5}, model.OutCost: {Fixed: 2}}},
	}
	for _, a := range services {
		s.AdditionalServices.LoadRaw(a)
	}
	views := []model.StockView{
		{ID: "ALL", Name: "Tous les stocks", Description: "Tous les points de stock et tous les articles", Active: true},
		{ID: "EXPRESS-STOCK", Name: "Stock express", Description: "Entrepôts, hubs et magasins en gardant une unité en magasin", Reserve: 1, Active: true},
		{ID: "WAREHOUSES", Name: "Entrepôts uniquement", PointTypes: []string{"WAREHOUSE"}, Active: true},
		{ID: "STORES-IDF", Name: "Magasins Île-de-France", PointTypes: []string{"STORE"}, Departments: []string{"75", "77", "78", "91", "92", "93", "94", "95"}, Active: true},
		{ID: "WEB-CATALOG", Name: "Catalogue web (hors collection magasin)", ArticleRules: []model.Rule{{Field: "attributes.collection", Op: model.OpMissing}}, Active: true},
	}
	for _, v := range views {
		s.StockViews.LoadRaw(v)
	}
	// services: rate cards, restrictions, additional services, ECO mode
	noHazmat := model.Restriction{Name: "Matières dangereuses interdites", Mode: model.RestrictExclude, Rules: []model.Rule{{Field: "attributes.hazmat", Op: model.OpExists}}}
	setup := map[string]func(*model.CarrierService){
		"COLIVIA-STD": func(v *model.CarrierService) {
			v.AdditionalServiceIDs = []string{"INSTALLATION", "FLOOR_DELIVERY", "TAKE_BACK", "APPOINTMENT"}
			v.Restrictions = []model.Restriction{{Name: "Pourtour max 300 cm", Mode: model.RestrictExclude, Rules: []model.Rule{{Field: "girthCm", Op: model.OpGt, Value: 300}}}}
			v.Modes = append(v.Modes, "ECO")
		},
		"COLIVIA-REG": func(v *model.CarrierService) {
			v.RateCardIDs = []string{"RC-COLIVIA-REG"}
			v.AdditionalServiceIDs = []string{"INSTALLATION", "FLOOR_DELIVERY", "TAKE_BACK", "APPOINTMENT"}
			v.Modes = append(v.Modes, "ECO")
		},
		"EXPRESSO-EXP": func(v *model.CarrierService) {
			v.Restrictions = []model.Restriction{noHazmat, {Name: "Batteries lithium interdites en aérien", Mode: model.RestrictExclude, Rules: []model.Rule{{Field: "attributes.battery", Op: model.OpEq, Value: "lithium-ion"}}}}
		},
		"EXPRESSO-HUB": func(v *model.CarrierService) {
			v.Restrictions = []model.Restriction{noHazmat}
		},
		"RELAIS-STD": func(v *model.CarrierService) {
			v.Restrictions = []model.Restriction{noHazmat, {Name: "Format point relais", Mode: model.RestrictRequire, Rules: []model.Rule{
				{Field: "longestSideCm", Op: model.OpLte, Value: 100}, {Field: "weightKg", Op: model.OpLte, Value: 20}}}}
			v.Modes = append(v.Modes, "ECO")
		},
		"URBIKE-AM": func(v *model.CarrierService) {
			v.AdditionalServiceIDs = []string{"APPOINTMENT"}
			v.Restrictions = []model.Restriction{{Name: "Gabarit vélo-cargo", Mode: model.RestrictRequire, Rules: []model.Rule{
				{Field: "longestSideCm", Op: model.OpLte, Value: 80}, {Field: "weightKg", Op: model.OpLte, Value: 12}}}}
			v.Modes = append(v.Modes, "ECO")
		},
		"URBIKE-PM": func(v *model.CarrierService) {
			v.AdditionalServiceIDs = []string{"APPOINTMENT"}
			v.Restrictions = []model.Restriction{{Name: "Gabarit vélo-cargo", Mode: model.RestrictRequire, Rules: []model.Rule{
				{Field: "longestSideCm", Op: model.OpLte, Value: 80}, {Field: "weightKg", Op: model.OpLte, Value: 12}}}}
			v.Modes = append(v.Modes, "ECO")
		},
		"URBIKE-SD":  func(v *model.CarrierService) { v.RateCardIDs = []string{"RC-URBIKE-SD"} },
		"URBIKE-SFS": func(v *model.CarrierService) { v.RateCardIDs = []string{"RC-URBIKE-SD"} },
	}
	for _, sv := range s.Services.All() {
		if fn, ok := setup[sv.ID]; ok {
			fn(&sv)
			s.Services.LoadRaw(sv)
		}
	}
	generateCarrierPlanning(s)
	generateRoutes(s)
	// delivery modes: criteria, stock views, customer prices
	modeSetup := map[string]func(*model.DeliveryMode){
		"STANDARD": func(m *model.DeliveryMode) {
			m.Selection = model.SelectWeighted
			m.Criteria = []model.Criterion{{Metric: "deliveryHours", Weight: 0.4, Priority: 1}, {Metric: "price", Weight: 0.25, Priority: 2},
				{Metric: "cost", Weight: 0.15, Priority: 3}, {Metric: "packages", Weight: 0.1, Priority: 4}, {Metric: "carbonKg", Weight: 0.1, Priority: 5}}
			m.StockViewID = "ALL"
			m.PriceRateCardIDs = []string{"PRICE-STANDARD"}
		},
		"EXPRESS": func(m *model.DeliveryMode) {
			m.Selection = model.SelectLexicographic
			m.Criteria = []model.Criterion{{Metric: "deliveryHours", Weight: 1, Priority: 1, Tolerance: 1}, {Metric: "price", Weight: 0.3, Priority: 2}, {Metric: "cost", Weight: 0.2, Priority: 3}}
			m.StockViewID = "EXPRESS-STOCK"
			m.PriceRateCardIDs = []string{"PRICE-EXPRESS"}
		},
		"SAME_DAY": func(m *model.DeliveryMode) {
			m.Selection = model.SelectLexicographic
			m.Criteria = []model.Criterion{{Metric: "deliveryHours", Weight: 1, Priority: 1}, {Metric: "cost", Weight: 0.5, Priority: 2}}
			m.PriceRateCardIDs = []string{"PRICE-SAMEDAY"}
		},
		"RELAY": func(m *model.DeliveryMode) {
			m.Selection = model.SelectLexicographic
			m.Criteria = []model.Criterion{{Metric: "price", Weight: 0.6, Priority: 1, Tolerance: 0.5}, {Metric: "deliveryHours", Weight: 0.4, Priority: 2}}
			m.StockViewID = "WEB-CATALOG"
			m.PriceRateCardIDs = []string{"PRICE-RELAY"}
		},
	}
	for _, m := range s.Modes.All() {
		if fn, ok := modeSetup[m.ID]; ok {
			fn(&m)
			s.Modes.LoadRaw(m)
		}
	}
	for _, sp := range s.StockPoints.All() {
		sp.AllowedModes = append(append([]string(nil), sp.AllowedModes...), "ECO")
		s.StockPoints.LoadRaw(sp)
	}
	s.Modes.LoadRaw(model.DeliveryMode{ID: "ECO", Name: "Livraison éco-responsable", Description: "La route la moins émettrice, livrée en 2 à 6 jours",
		MaxLegs: 3, MaxSources: 2, AllowConsolidation: true, AllowSplit: true, MaxDeliveryDays: 6, Price: 3.9, Active: true,
		Selection: model.SelectLexicographic, StockViewID: "ALL", PriceRateCardIDs: []string{"PRICE-ECO"},
		Criteria: []model.Criterion{{Metric: "carbonKg", Weight: 0.7, Priority: 1, Tolerance: 0.05}, {Metric: "packages", Weight: 0.1, Priority: 2}, {Metric: "deliveryHours", Weight: 0.2, Priority: 3}}})
}

func tp(x string) *model.TimeOfDay { t := model.MustTOD(x); return &t }
func ip(x int) *int                { return &x }

// generateCarrierPlanning sets the carrier default cost grids and delivery
// schedules (pickup days, cut-off, delivery days, transit, window, zones).
func generateCarrierPlanning(s *store.Store) {
	monFri, monSat, tueSat := []int{1, 2, 3, 4, 5}, []int{1, 2, 3, 4, 5, 6}, []int{2, 3, 4, 5, 6}
	plans := map[string]struct {
		cards     []string
		schedules []model.DeliverySchedule
	}{
		"COLIVIA": {[]string{"RC-COLIVIA-STD"}, []model.DeliverySchedule{
			{ID: "COLIVIA-NATIONAL", Name: "National", PickupDays: monFri, Cutoff: tp("20:00"), DeliveryDays: monSat, HonorHolidays: true, Active: true},
			{ID: "COLIVIA-DOMICILE", Name: "Domicile J+2", ServiceIDs: []string{"COLIVIA-STD"}, TransitDays: ip(2), WindowStart: tp("09:00"), WindowEnd: tp("18:00"), HonorHolidays: true, Active: true},
			{ID: "COLIVIA-REGIONAL", Name: "Régional J+1", ServiceIDs: []string{"COLIVIA-REG"}, PickupDays: monSat, TransitDays: ip(1), HonorHolidays: true, Active: true},
			{ID: "COLIVIA-CORSE", Name: "Corse J+4", Zones: []string{"20"}, TransitDays: ip(4), DeliveryDays: monFri, HonorHolidays: true, RateCardIDs: []string{"RC-COLIVIA-CORSE"}, Active: true},
			{ID: "COLIVIA-MONTAGNE", Name: "Zones de montagne J+3", Zones: []string{"04", "05", "15", "48", "73"}, ServiceIDs: []string{"COLIVIA-STD"}, TransitDays: ip(3), HonorHolidays: true, Active: true},
		}},
		"EXPRESSO": {[]string{"RC-EXPRESSO"}, []model.DeliverySchedule{
			{ID: "EXPRESSO-NATIONAL", Name: "Express national", PickupDays: monFri, Cutoff: tp("19:00"), DeliveryDays: monFri, HonorHolidays: true, Active: true},
			{ID: "EXPRESSO-13H", Name: "Avant 13h J+1", ServiceIDs: []string{"EXPRESSO-EXP"}, TransitDays: ip(1), WindowStart: tp("08:00"), WindowEnd: tp("13:00"), HonorHolidays: true, Active: true},
			{ID: "EXPRESSO-ELOIGNE", Name: "Départements éloignés : après-midi", Zones: []string{"29", "64", "65", "66", "09"}, ServiceIDs: []string{"EXPRESSO-EXP"}, WindowStart: tp("13:00"), WindowEnd: tp("18:00"), HonorHolidays: true, Active: true},
		}},
		"RELAISPLUS": {[]string{"RC-RELAIS"}, []model.DeliverySchedule{
			{ID: "RELAIS-NATIONAL", Name: "Point relais J+2", PickupDays: monFri, Cutoff: tp("19:30"), DeliveryDays: tueSat, TransitDays: ip(2), WindowStart: tp("10:00"), WindowEnd: tp("19:00"), HonorHolidays: true, Active: true},
		}},
		"URBIKE": {[]string{"RC-URBIKE"}, []model.DeliverySchedule{
			{ID: "URBIKE-URBAIN", Name: "Tournées urbaines", PickupDays: monSat, DeliveryDays: monSat, HonorHolidays: true, Active: true},
		}},
		"TRANSALP": {[]string{"RC-TRANSALP"}, []model.DeliverySchedule{
			{ID: "TRANSALP-NUIT", Name: "Traction de nuit", PickupDays: monFri, HonorHolidays: true, Active: true},
		}},
		"NAVETTE": {[]string{"RC-NAVETTE"}, []model.DeliverySchedule{
			{ID: "NAVETTE-JOUR", Name: "Navettes de jour", PickupDays: monSat, HonorHolidays: true, Active: true},
		}},
	}
	for _, c := range s.Carriers.All() {
		if p, ok := plans[c.ID]; ok {
			c.RateCardIDs = p.cards
			c.Schedules = p.schedules
			s.Carriers.LoadRaw(c)
		}
	}
}

// generateRoutes creates the zones and the carrier routes: origin zone ->
// destination zone per service with a cost grid, a transit in hours, a
// weekly planning (pickups, delivery slots) and metadata.
func generateRoutes(s *store.Store) {
	zones := []model.Zone{
		{ID: "FR", Name: "France métropolitaine", Departments: []string{"*"}, Active: true},
		{ID: "CORSE", Name: "Corse", Departments: []string{"20"}, Active: true},
		{ID: "MONTAGNE", Name: "Zones de montagne", Description: "Alpes du Sud, Cantal, Lozère, Savoie", Departments: []string{"04", "05", "15", "48", "73"}, Active: true},
		{ID: "ELOIGNE", Name: "Départements éloignés", Departments: []string{"29", "64", "65", "66", "09"}, Active: true},
		{ID: "IDF", Name: "Île-de-France", Departments: []string{"75", "77", "78", "91", "92", "93", "94", "95"}, Active: true},
		{ID: "GRANDES-VILLES", Name: "Grandes agglomérations", Description: "Paris, Lyon, Marseille, Bordeaux, Lille, Toulouse, Nantes, Strasbourg, Nice, Rennes",
			Departments: []string{"75", "92", "93", "94", "69", "13", "33", "59", "31", "44", "67", "06", "35"}, Active: true},
	}
	for _, z := range zones {
		s.Zones.LoadRaw(z)
	}
	grid := func(id string) *model.RateCard {
		rc, ok := s.RateCards.Get(id)
		if !ok {
			return nil
		}
		rc.ID, rc.Name, rc.CarrierID, rc.Description = "", "", "", ""
		return &rc
	}
	week := func(pickupDays, deliveryDays []int, start, end string, pickups ...string) *model.RoutePlanning {
		pl := &model.RoutePlanning{Timezone: "Europe/Paris", HonorHolidays: true}
		for wd := 1; wd <= 7; wd++ {
			d := model.RouteDay{Weekday: wd}
			if hasInt(pickupDays, wd) {
				for _, p := range pickups {
					d.Pickups = append(d.Pickups, model.MustTOD(p))
				}
			}
			if hasInt(deliveryDays, wd) {
				d.DeliveryStart, d.DeliveryEnd = tp(start), tp(end)
			}
			if len(d.Pickups) > 0 || d.DeliveryStart != nil {
				pl.Days = append(pl.Days, d)
			}
		}
		return pl
	}
	monFri, monSat, tueSat := []int{1, 2, 3, 4, 5}, []int{1, 2, 3, 4, 5, 6}, []int{2, 3, 4, 5, 6}
	routes := []model.CarrierRoute{
		{ID: "COLIVIA-STD-FR-FR", Name: "Domicile national", CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", OriginZoneID: "FR", DestinationZoneID: "FR",
			Costs: grid("RC-COLIVIA-STD"), TransitMinHours: 24, TransitMaxHours: 48, Planning: week(monFri, monSat, "09:00", "18:00", "12:00", "19:00"),
			Metadata: map[string]string{"codeProduit": "DOM", "contrat": "COL-2026-01"}, Active: true},
		{ID: "COLIVIA-STD-FR-CORSE", Name: "Domicile Corse", CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", OriginZoneID: "FR", DestinationZoneID: "CORSE",
			Costs: grid("RC-COLIVIA-CORSE"), TransitMinHours: 72, TransitMaxHours: 96, Planning: week(monFri, monFri, "09:00", "18:00", "12:00"),
			Metadata: map[string]string{"codeProduit": "DOM-CO", "traversee": "maritime"}, Active: true},
		{ID: "COLIVIA-STD-FR-MONTAGNE", Name: "Domicile zones de montagne", CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", OriginZoneID: "FR", DestinationZoneID: "MONTAGNE",
			Costs: grid("RC-COLIVIA-STD"), TransitMinHours: 48, TransitMaxHours: 72, Planning: week(monFri, monSat, "10:00", "17:00", "12:00", "19:00"),
			Metadata: map[string]string{"codeProduit": "DOM-MT"}, Active: true},
		{ID: "COLIVIA-REG-FR-FR", Name: "Régional J+1", CarrierID: "COLIVIA", ServiceID: "COLIVIA-REG", OriginZoneID: "FR", DestinationZoneID: "FR",
			Costs: grid("RC-COLIVIA-REG"), TransitMinHours: 12, TransitMaxHours: 24, Planning: week(monSat, monSat, "08:00", "20:00", "18:00"),
			Metadata: map[string]string{"codeProduit": "REG"}, Active: true},
		{ID: "EXPRESSO-EXP-FR-FR", Name: "Express avant 13h", CarrierID: "EXPRESSO", ServiceID: "EXPRESSO-EXP", OriginZoneID: "FR", DestinationZoneID: "FR",
			Costs: grid("RC-EXPRESSO"), TransitMinHours: 12, TransitMaxHours: 18, Planning: week(monFri, monFri, "08:00", "13:00", "19:00"),
			Metadata: map[string]string{"codeProduit": "E13"}, Active: true},
		{ID: "EXPRESSO-EXP-FR-ELOIGNE", Name: "Express départements éloignés", CarrierID: "EXPRESSO", ServiceID: "EXPRESSO-EXP", OriginZoneID: "FR", DestinationZoneID: "ELOIGNE",
			Costs: grid("RC-EXPRESSO"), TransitMinHours: 18, TransitMaxHours: 24, Planning: week(monFri, monFri, "13:00", "18:00", "19:00"),
			Metadata: map[string]string{"codeProduit": "E18"}, Active: true},
		{ID: "RELAIS-STD-FR-FR", Name: "Point relais 48h", CarrierID: "RELAISPLUS", ServiceID: "RELAIS-STD", OriginZoneID: "FR", DestinationZoneID: "FR",
			Costs: grid("RC-RELAIS"), TransitMinHours: 36, TransitMaxHours: 48, Planning: week(monFri, tueSat, "10:00", "19:00", "18:30"),
			Metadata: map[string]string{"codeProduit": "PR48", "reseau": "Relais Plus"}, Active: true},
		{ID: "URBIKE-AM-VILLES", Name: "Tournée matin grandes villes", CarrierID: "URBIKE", ServiceID: "URBIKE-AM", OriginZoneID: "GRANDES-VILLES", DestinationZoneID: "GRANDES-VILLES",
			Costs: grid("RC-URBIKE"), Metadata: map[string]string{"vehicule": "vélo-cargo"}, Active: true},
		{ID: "TRANSALP-LH-FR-FR", Name: "Traction de nuit", CarrierID: "TRANSALP", ServiceID: "TRANSALP-LH", OriginZoneID: "FR", DestinationZoneID: "FR",
			Costs: grid("RC-TRANSALP"), Metadata: map[string]string{"vehicule": "semi-remorque"}, Active: true},
	}
	for _, r := range routes {
		if r.Costs == nil {
			continue
		}
		s.CarrierRoutes.LoadRaw(r)
	}
}

func hasInt(xs []int, x int) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
