package engine

import (
	"math/bits"
	"sort"

	"github.com/onestock/dp100ms/pkg/geo"
	"github.com/onestock/dp100ms/pkg/network"
)

// candidate is a stock point eligible for a mode with its heuristic data.
type candidate struct {
	col      int // snapshot column
	node     *network.Node
	ready    int64
	etaHours float64 // best direct delivery estimate (or via hub + penalty)
	direct   bool
	viaHub   bool
}

// allocation assigns quantities of every basket item to sources.
type allocation struct {
	sources []int   // candidate indexes
	qty     [][]int // [source][item]
	sig     uint64  // order-independent hash of (source, quantities)
	h       float64 // heuristic rank (lower is better)
}

// mix is a 64-bit finaliser (splitmix64) used to build hash keys.
func mix(x uint64) uint64 {
	x += 0x9e3779b97f4a7c15
	x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9
	x = (x ^ (x >> 27)) * 0x94d049bb133111eb
	return x ^ (x >> 31)
}

// signature hashes the allocation independently of the source order.
func (a *allocation) signature(cands []candidate) uint64 {
	var sum uint64
	for si, ci := range a.sources {
		h := mix(uint64(cands[ci].node.Idx) + 1)
		for _, q := range a.qty[si] {
			h = mix(h ^ uint64(q))
		}
		sum += h // commutative combination
	}
	return mix(sum)
}

// findCandidates prefilters stock points with the availability bitmaps:
// only points holding at least one basket SKU and connected to the
// destination for the mode are kept.
func (c *reqCtx) findCandidates(mode string, dr *network.DestRoutes) []candidate {
	sn := c.sn
	words := (sn.NPoints + 63) / 64
	union := make([]uint64, words)
	for i := range c.items {
		bm := sn.Avail[i]
		for w := 0; w < words && w < len(bm); w++ {
			union[w] |= bm[w]
		}
	}
	consolidation := c.allowConsolidation(mode)
	// 1. cheap prefilter: coverage of the basket and distance to the
	// destination. Only the maxEval most promising points get their route
	// timings evaluated (bounded work whatever the basket).
	type pre struct {
		col   int
		node  *network.Node
		cover int
		dist  float64
	}
	dlat, dlon, hasCentroid := geo.DeptCentroid(c.dept)
	var pres []pre
	for w, word := range union {
		for word != 0 {
			b := bits.TrailingZeros64(word)
			word &= word - 1
			col := w*64 + b
			if col >= sn.NPoints {
				continue
			}
			node := c.colNodes[col]
			if node == nil || node.StockPoint == nil || !node.AllowsMode(mode) {
				continue
			}
			if len(dr.ByIdx[node.Idx]) == 0 && !(consolidation && c.reachesHub(node, dr)) {
				continue
			}
			cover := 0
			for i, it := range c.items {
				q := int(sn.Q(i, col))
				if q > it.qty {
					q = it.qty
				}
				cover += q
			}
			pr := pre{col: col, node: node, cover: cover}
			if hasCentroid {
				pr.dist = geo.HaversineKm(node.Lat, node.Lon, dlat, dlon)
			}
			pres = append(pres, pr)
		}
	}
	maxEval := c.net.Settings.MaxCandidates
	if maxEval <= 0 {
		maxEval = defaultMaxCandidates
	}
	if len(pres) > maxEval {
		sort.Slice(pres, func(a, b int) bool {
			if pres[a].cover != pres[b].cover {
				return pres[a].cover > pres[b].cover
			}
			return pres[a].dist < pres[b].dist
		})
		pres = pres[:maxEval]
	}
	// 2. route timings of the retained points
	out := make([]candidate, 0, len(pres))
	for _, pr := range pres {
		node := pr.node
		ready, ok := c.prepReady(node)
		if !ok {
			continue
		}
		cd := candidate{col: pr.col, node: node, ready: ready, etaHours: 1e9}
		for _, p := range dr.ByIdx[node.Idx] {
			c.stats.PathsConsidered++
			pt := c.traverse(p, ready)
			if !pt.ok {
				continue
			}
			h := float64(pt.window.To-c.orderU) / 3600
			if h < cd.etaHours {
				cd.etaHours = h
			}
			cd.direct = true
		}
		if !cd.direct && consolidation && c.reachesHub(node, dr) {
			cd.viaHub = true
			cd.etaHours = 72 // unknown until consolidation is planned
		}
		if cd.direct || cd.viaHub {
			out = append(out, cd)
		}
	}
	return out
}

// defaultMaxCandidates bounds the number of stock points whose routes are
// timed for one mode (EngineSettings.MaxCandidates overrides it).
const defaultMaxCandidates = 48

// reachesHub reports whether a point can feed a consolidation hub that
// serves the destination.
func (c *reqCtx) reachesHub(node *network.Node, dr *network.DestRoutes) bool {
	for _, hub := range c.net.ConsolidationHubs {
		if len(dr.ByIdx[hub.Idx]) == 0 {
			continue
		}
		if hub == node || len(hub.Inbound[node.Idx]) > 0 {
			return true
		}
	}
	return false
}

type beamState struct {
	remaining []int
	sources   []int
	qty       [][]int
	score     float64
	used      uint64 // small bloom of used candidates
}

// searchAllocations runs a beam search over sourcing decisions. Each step
// adds one source taking as much remaining demand as it can; states are
// ranked by covered units, delivery estimate and number of sources. Full
// single-source covers are always enumerated.
func (c *reqCtx) searchAllocations(mode string, cands []candidate) []*allocation {
	k := len(c.items)
	totalUnits := 0
	for _, it := range c.items {
		totalUnits += it.qty
	}
	split := c.allowSplit(mode)
	maxSources := c.maxSources(mode)
	beamWidth := c.net.Settings.BeamWidth
	if beamWidth <= 0 {
		beamWidth = 6
	}
	maxAlloc := c.net.Settings.MaxAllocations
	if maxAlloc <= 0 {
		maxAlloc = 12
	}
	// Per-item quantities by candidate.
	q := func(ci, item int) int { return int(c.sn.Q(item, cands[ci].col)) }

	results := map[uint64]*allocation{}
	addResult := func(st *beamState) {
		a := &allocation{sources: st.sources, qty: st.qty}
		a.sig = a.signature(cands)
		if _, ok := results[a.sig]; ok {
			return
		}
		worst := 0.0
		for _, ci := range st.sources {
			if cands[ci].etaHours > worst {
				worst = cands[ci].etaHours
			}
		}
		a.h = worst + 18*float64(len(st.sources)-1)
		results[a.sig] = a
	}

	// 1. single-source full covers (only the best maxAlloc by ETA are kept)
	var singles []int
	for ci := range cands {
		full := true
		for i := 0; i < k; i++ {
			if q(ci, i) < c.items[i].qty {
				full = false
				break
			}
		}
		if full {
			singles = append(singles, ci)
		}
	}
	sort.Slice(singles, func(a, b int) bool { return cands[singles[a]].etaHours < cands[singles[b]].etaHours })
	if len(singles) > maxAlloc {
		singles = singles[:maxAlloc]
	}
	for _, ci := range singles {
		qty := make([]int, k)
		for i := range qty {
			qty[i] = c.items[i].qty
		}
		addResult(&beamState{sources: []int{ci}, qty: [][]int{qty}})
	}
	// 2. beam search for multi-source allocations. Candidate scoring is
	// allocation-free; only the beamWidth best children are materialised.
	init := &beamState{remaining: make([]int, k)}
	for i := range c.items {
		init.remaining[i] = c.items[i].qty
	}
	beam := []*beamState{init}
	type pick struct {
		ci    int
		score float64
	}
	local := make([]pick, 0, beamWidth+1)
	for depth := 0; depth < maxSources && len(beam) > 0; depth++ {
		var children []*beamState
		for _, st := range beam {
			local = local[:0]
			for ci := range cands {
				if usedIn(st.sources, ci) {
					continue
				}
				covered := 0
				for i := 0; i < k; i++ {
					r := st.remaining[i]
					if r == 0 {
						continue
					}
					avail := q(ci, i)
					if avail <= 0 || (!split && avail < r) {
						continue
					}
					if avail < r {
						covered += avail
					} else {
						covered += r
					}
				}
				if covered == 0 {
					continue
				}
				eta := cands[ci].etaHours
				if eta > 240 {
					eta = 240
				}
				sc := float64(covered)/float64(totalUnits) - eta/240*0.35
				// keep the beamWidth best (insertion into a small sorted slice)
				if len(local) == beamWidth && sc <= local[len(local)-1].score {
					continue
				}
				pos := len(local)
				for pos > 0 && local[pos-1].score < sc {
					pos--
				}
				local = append(local, pick{})
				copy(local[pos+1:], local[pos:])
				local[pos] = pick{ci, sc}
				if len(local) > beamWidth {
					local = local[:beamWidth]
				}
			}
			for _, lc := range local {
				take := make([]int, k)
				for i := 0; i < k; i++ {
					r := st.remaining[i]
					avail := q(lc.ci, i)
					if r == 0 || avail <= 0 || (!split && avail < r) {
						continue
					}
					if avail < r {
						take[i] = avail
					} else {
						take[i] = r
					}
				}
				ns := &beamState{remaining: append([]int(nil), st.remaining...), score: st.score + lc.score - 0.08}
				ns.sources = append(append([]int(nil), st.sources...), lc.ci)
				ns.qty = append(append([][]int(nil), st.qty...), take)
				done := true
				for i := 0; i < k; i++ {
					ns.remaining[i] -= take[i]
					if ns.remaining[i] > 0 {
						done = false
					}
				}
				if done {
					addResult(ns)
				} else {
					children = append(children, ns)
				}
			}
		}
		sort.Slice(children, func(a, b int) bool { return children[a].score > children[b].score })
		// dedupe on source sets
		seen := map[uint64]bool{}
		beam = beam[:0]
		for _, ch := range children {
			key := sourceKey(ch.sources)
			if seen[key] {
				continue
			}
			seen[key] = true
			beam = append(beam, ch)
			if len(beam) >= beamWidth {
				break
			}
		}
		if len(results) >= maxAlloc*2 {
			break
		}
	}
	out := make([]*allocation, 0, len(results))
	for _, a := range results {
		out = append(out, a)
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].h != out[b].h {
			return out[a].h < out[b].h
		}
		return out[a].sig < out[b].sig // deterministic tie-break
	})
	// keep diversity: best single-source and best multi-source always kept
	if len(out) > maxAlloc {
		keep := out[:maxAlloc]
		hasMulti := false
		for _, a := range keep {
			if len(a.sources) > 1 {
				hasMulti = true
			}
		}
		if !hasMulti {
			for _, a := range out[maxAlloc:] {
				if len(a.sources) > 1 {
					keep[len(keep)-1] = a
					break
				}
			}
		}
		out = keep
	}
	return out
}

func usedIn(xs []int, x int) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func sourceKey(xs []int) uint64 {
	var sum uint64
	for _, v := range xs {
		sum += mix(uint64(v) + 1)
	}
	return sum
}
