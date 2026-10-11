package network

import (
	"strings"

	"github.com/onestock/dp100ms/pkg/geo"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/pricing"
	"github.com/onestock/dp100ms/pkg/store"
)

// StockView is a compiled stock view.
type StockView struct {
	model.StockView
	ids, excluded, types map[string]bool
}

// AllowsNode reports whether a stock point belongs to the view.
func (v *StockView) AllowsNode(n *Node) bool {
	if v == nil {
		return true
	}
	if n.StockPoint == nil || v.excluded[n.ID] {
		return false
	}
	if v.ids != nil && !v.ids[n.ID] {
		return false
	}
	if v.types != nil && !v.types[string(n.StockPoint.Type)] {
		return false
	}
	if len(v.Departments) > 0 {
		ok := false
		for _, d := range v.Departments {
			if strings.HasPrefix(n.StockPoint.Address.PostalCode, d) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// AllowsSKU reports whether an article belongs to the view.
func (v *StockView) AllowsSKU(s *model.SKU) bool {
	return v == nil || pricing.MatchAll(v.ArticleRules, s)
}

// default emission factors (g CO2e per kg·km) when a service has none
var defaultCarbon = map[model.ServiceKind]float64{
	model.KindLinehaul: 0.10, model.KindShuttle: 0.20, model.KindStandard: 0.25, model.KindHome: 0.25,
	model.KindRelay: 0.18, model.KindExpress: 0.60, model.KindSameDay: 0.40, model.KindStore: 0.30, model.KindLastMile: 0.03,
}

// attachPricing compiles rate cards, restrictions, additional services and
// stock views, and attaches them to legs and modes.
func (n *Network) attachPricing(s *store.Store) {
	n.Registry = pricing.NewRegistry()
	n.RateCards = map[string]*pricing.Card{}
	for _, rc := range s.RateCards.All() {
		rc := rc
		if !rc.Active {
			continue
		}
		c, errs := pricing.Compile(&rc, n.Registry)
		if len(errs) > 0 {
			n.Warnings = append(n.Warnings, "rate card "+rc.ID+": "+strings.Join(errs, "; "))
			continue
		}
		n.RateCards[rc.ID] = c
	}
	n.AddServices = map[string]*model.AdditionalService{}
	for _, as := range s.AdditionalServices.All() {
		as := as
		if as.Active {
			n.AddServices[as.ID] = &as
			for out := range as.Outputs {
				n.Registry.Index(out)
			}
		}
	}
	n.StockViews = map[string]*StockView{}
	for _, v := range s.StockViews.All() {
		if !v.Active {
			continue
		}
		cv := &StockView{StockView: v, ids: setOf(v.PointIDs), excluded: setOf(v.ExcludePointIDs), types: setOf(v.PointTypes)}
		if cv.excluded == nil {
			cv.excluded = map[string]bool{}
		}
		n.StockViews[v.ID] = cv
	}
	n.ModePriceCards = map[string][]*pricing.Card{}
	for id, m := range n.Modes {
		for _, cid := range m.PriceRateCardIDs {
			if c := n.RateCards[cid]; c != nil {
				n.ModePriceCards[id] = append(n.ModePriceCards[id], c)
			}
		}
		for _, cr := range m.Criteria {
			n.Registry.Index(cr.Metric) // custom metrics get a slot (0 if never produced)
		}
	}
	for _, l := range n.Legs {
		ids := l.Service.RateCardIDs
		if len(l.Leg.RateCardIDs) > 0 {
			ids = l.Leg.RateCardIDs
		}
		for _, cid := range ids {
			if c := n.RateCards[cid]; c != nil {
				l.Cards = append(l.Cards, c)
			}
		}
		l.Restrictions = append(append([]model.Restriction(nil), l.Service.Restrictions...), l.Leg.Restrictions...)
		l.CarbonFactor = l.Service.CarbonGramsPerKgKm
		if l.CarbonFactor == 0 {
			l.CarbonFactor = defaultCarbon[l.Service.Kind]
		}
		from := n.Nodes[l.From]
		l.FromNode = from
		if !l.Final && l.ToNode != nil && from != nil {
			l.DistanceKm = roadKm(from.Lat, from.Lon, l.ToNode.Lat, l.ToNode.Lon)
		}
		if l.Final {
			for _, sid := range l.Service.AdditionalServiceIDs {
				if as := n.AddServices[sid]; as != nil {
					l.Offers = append(l.Offers, as)
				}
			}
		}
	}
}

// roadKm approximates a road distance from the great-circle distance.
func roadKm(lat1, lon1, lat2, lon2 float64) float64 {
	return geo.HaversineKm(lat1, lon1, lat2, lon2) * 1.25
}

// FinalDistanceKm is the distance of a final leg to a department centroid.
func (l *Leg) FinalDistanceKm(dept string) float64 {
	lat, lon, ok := geo.DeptCentroid(dept)
	if !ok || l.FromNode == nil {
		return 0
	}
	d := roadKm(l.FromNode.Lat, l.FromNode.Lon, lat, lon)
	if d < 5 {
		d = 5 // urban delivery round minimum
	}
	return d
}

// Offers reports whether a final leg offers an additional service.
func (l *Leg) OffersService(id string) bool {
	for _, o := range l.Offers {
		if o.ID == id {
			return true
		}
	}
	return false
}
