package engine

import "sort"

// group is a quantity of one basket item coming from one source.
type group struct {
	item   int // index in reqCtx.items
	source string
	qty    int
}

// parcel is a physical package: quantities per group index.
type parcel struct {
	qty    []int // aligned with the groups slice given to pack
	weight float64
	volume float64
	units  int
}

type packLimits struct {
	maxW     float64
	maxV     float64
	maxItems int
}

func (l packLimits) tighten(maxW float64, maxItems int) packLimits {
	if maxW > 0 && (l.maxW <= 0 || maxW < l.maxW) {
		l.maxW = maxW
	}
	if maxItems > 0 && (l.maxItems <= 0 || maxItems < l.maxItems) {
		l.maxItems = maxItems
	}
	return l
}

// pack distributes units into parcels with first-fit decreasing on weight.
// It returns false when a single unit exceeds the limits.
func (c *reqCtx) pack(groups []group, lim packLimits) ([]parcel, bool) {
	order := make([]int, len(groups))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		return c.items[groups[order[a]].item].weight > c.items[groups[order[b]].item].weight
	})
	var parcels []parcel
	for _, gi := range order {
		g := groups[gi]
		it := c.items[g.item]
		if (lim.maxW > 0 && it.weight > lim.maxW) || (lim.maxV > 0 && it.volume > lim.maxV) {
			return nil, false
		}
		for u := 0; u < g.qty; u++ {
			placed := false
			for pi := range parcels {
				p := &parcels[pi]
				if lim.maxW > 0 && p.weight+it.weight > lim.maxW+1e-9 {
					continue
				}
				if lim.maxV > 0 && p.volume+it.volume > lim.maxV+1e-9 {
					continue
				}
				if lim.maxItems > 0 && p.units+1 > lim.maxItems {
					continue
				}
				p.qty[gi]++
				p.weight += it.weight
				p.volume += it.volume
				p.units++
				placed = true
				break
			}
			if !placed {
				np := parcel{qty: make([]int, len(groups)), weight: it.weight, volume: it.volume, units: 1}
				np.qty[gi] = 1
				parcels = append(parcels, np)
			}
		}
	}
	return parcels, true
}
