package bench

import (
	"math/rand"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

// BasketProfile drives the basket generator used by load tests.
type BasketProfile struct {
	Count            int       `json:"count"`
	Seed             int64     `json:"seed"`
	SkusMin          int       `json:"skusMin"`
	SkusMax          int       `json:"skusMax"`
	QtyMin           int       `json:"qtyMin"`
	QtyMax           int       `json:"qtyMax"`
	PostalCodes      []string  `json:"postalCodes"`
	Modes            []string  `json:"modes"`
	PctMono          float64   `json:"pctMono"`
	PctMulti         float64   `json:"pctMulti"`
	PctMultiSource   float64   `json:"pctMultiSource"`
	PctConsolidation float64   `json:"pctConsolidation"`
	OrderDate        time.Time `json:"orderDate"`
	// SpreadOrderDates varies order times over a week (cut-offs, weekends).
	SpreadOrderDates bool `json:"spreadOrderDates"`
}

// Basket categories.
const (
	CatMono          = "mono"
	CatMulti         = "multi"
	CatMultiSource   = "multi-source"
	CatConsolidation = "consolidation"
)

type Basket struct {
	Category string               `json:"category"`
	Request  model.PromiseRequest `json:"request"`
}

// DefaultPostalCodes covers the big agglomerations, regional cities, rural
// areas and Corsica.
var DefaultPostalCodes = []string{
	"75011", "75015", "92100", "93200", "94000", "69003", "69100", "13008", "33000", "33700", "59000", "59100",
	"31000", "44000", "67000", "06000", "35000", "34000", "38000", "21000", "37000", "63000", "87000", "29200",
	"76000", "14000", "51100", "57000", "45000", "49000", "66000", "83000", "64000", "86000", "25000", "80000",
	"42000", "74000", "23000", "48000", "05000", "20000", "15000", "12000", "46000", "09000",
}

var metroPostalCodes = []string{"75011", "75015", "92100", "93200", "69003", "13008", "33000", "59000", "31000", "44000", "67000", "06000"}

func (p *BasketProfile) normalize() {
	if p.Count <= 0 {
		p.Count = 1000
	}
	if p.Count > 20000 {
		p.Count = 20000
	}
	if p.SkusMin <= 0 {
		p.SkusMin = 2
	}
	if p.SkusMax < p.SkusMin {
		p.SkusMax = p.SkusMin + 3
	}
	if p.QtyMin <= 0 {
		p.QtyMin = 1
	}
	if p.QtyMax < p.QtyMin {
		p.QtyMax = p.QtyMin + 1
	}
	if len(p.PostalCodes) == 0 {
		p.PostalCodes = DefaultPostalCodes
	}
	if p.PctMono+p.PctMulti+p.PctMultiSource+p.PctConsolidation <= 0 {
		p.PctMono, p.PctMulti, p.PctMultiSource, p.PctConsolidation = 30, 40, 20, 10
	}
	if p.OrderDate.IsZero() {
		p.OrderDate = time.Date(2026, 10, 12, 10, 0, 0, 0, time.FixedZone("CEST", 2*3600))
	}
}

// GenerateBaskets builds a reproducible, varied basket pool from the
// current stock. Multi-source baskets are verified: no single stock point
// can serve them alone.
func GenerateBaskets(s *store.Store, p BasketProfile) []Basket {
	p.normalize()
	r := rand.New(rand.NewSource(p.Seed + 1))
	st := s.Stock
	skus := st.SKUs()
	n := len(skus)
	points := s.StockPoints.All()
	total := p.PctMono + p.PctMulti + p.PctMultiSource + p.PctConsolidation
	qty := func() int { return p.QtyMin + r.Intn(p.QtyMax-p.QtyMin+1) }
	light := func() int32 {
		for {
			k := r.Intn(n)
			if skus[k].WeightKg <= 8 {
				return int32(k)
			}
		}
	}
	covers := func(idx []int32, q []int) bool {
		sn := st.Snapshot(idx)
		for col := 0; col < sn.NPoints; col++ {
			all := true
			for i := range idx {
				if int(sn.Q(i, col)) < q[i] {
					all = false
					break
				}
			}
			if all {
				return true
			}
		}
		return false
	}
	available := func(k int32, q int) bool {
		sn := st.Snapshot([]int32{k})
		for col := 0; col < sn.NPoints; col++ {
			if int(sn.Q(0, col)) >= q {
				return true
			}
		}
		return false
	}
	out := make([]Basket, 0, p.Count)
	for len(out) < p.Count {
		x := r.Float64() * total
		cat := CatConsolidation
		switch {
		case x < p.PctMono:
			cat = CatMono
		case x < p.PctMono+p.PctMulti:
			cat = CatMulti
		case x < p.PctMono+p.PctMulti+p.PctMultiSource:
			cat = CatMultiSource
		}
		pc := p.PostalCodes[r.Intn(len(p.PostalCodes))]
		var items []model.BasketItem
		switch cat {
		case CatMono:
			for tries := 0; tries < 50; tries++ {
				k, q := light(), qty()
				if available(k, q) {
					items = []model.BasketItem{{SKU: skus[k].Code, Quantity: q}}
					break
				}
			}
		case CatMulti:
			// single-source feasible: pick SKUs in stock at one random point
			sp := points[r.Intn(len(points))]
			col, ok := st.PointIndex(sp.ID)
			if !ok {
				continue
			}
			want := p.SkusMin + r.Intn(p.SkusMax-p.SkusMin+1)
			seen := map[int32]bool{}
			for tries := 0; tries < 400 && len(items) < want; tries++ {
				k := light()
				if seen[k] {
					continue
				}
				q := qty()
				sn := st.Snapshot([]int32{k})
				if int(sn.Q(0, col)) >= q {
					seen[k] = true
					items = append(items, model.BasketItem{SKU: skus[k].Code, Quantity: q})
				}
			}
		default:
			// store-exclusive collection SKUs (top of the catalog) with
			// rejection sampling until no single point covers the basket
			if cat == CatConsolidation {
				pc = metroPostalCodes[r.Intn(len(metroPostalCodes))]
			}
			want := p.SkusMin + r.Intn(p.SkusMax-p.SkusMin+1)
			if want < 2 {
				want = 2
			}
			lo := n * 5 / 6
			for tries := 0; tries < 200; tries++ {
				idx := make([]int32, 0, want)
				q := make([]int, 0, want)
				seen := map[int32]bool{}
				for len(idx) < want {
					k := int32(lo + r.Intn(n-lo))
					if seen[k] || skus[k].WeightKg > 8 {
						continue
					}
					seen[k] = true
					idx = append(idx, k)
					q = append(q, 1+r.Intn(3))
				}
				ok := true
				for i, k := range idx {
					if !available(k, q[i]) {
						ok = false
						break
					}
				}
				if ok && !covers(idx, q) {
					for i, k := range idx {
						items = append(items, model.BasketItem{SKU: skus[k].Code, Quantity: q[i]})
					}
					break
				}
			}
		}
		if len(items) == 0 {
			continue
		}
		od := p.OrderDate
		if p.SpreadOrderDates {
			od = od.Add(time.Duration(r.Intn(7*24*60)) * time.Minute)
		}
		modes := p.Modes
		if cat == CatConsolidation {
			modes = []string{"STANDARD"}
		}
		out = append(out, Basket{Category: cat, Request: model.PromiseRequest{
			Destination: model.Destination{Country: "FR", PostalCode: pc}, OrderDate: od, Items: items, DeliveryModes: modes, MaxOptions: 5,
		}})
	}
	return out
}
