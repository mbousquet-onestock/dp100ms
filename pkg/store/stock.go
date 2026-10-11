package store

import (
	"errors"
	"math/bits"
	"sync"
	"sync/atomic"

	"github.com/onestock/dp100ms/pkg/model"
)

// Stock is a dense, SKU-major stock matrix: for each SKU index the
// quantities of every stock point are contiguous, so reading a basket touches
// a few cache lines only. An availability bitmap (promisable > 0) per SKU
// gives the inverted index SKU -> stock points in a handful of words.
//
// Concurrency: readers take a consistent snapshot of the basket SKUs under a
// read lock (Snapshot); writers update quantities and the bitmap under the
// write lock and bump Version. Promise computations never block writers for
// longer than the copy of k * nPoints integers.
type Stock struct {
	mu      sync.RWMutex
	version atomic.Uint64

	stride   int // allocated point slots (multiple of 64)
	words    int // stride / 64
	nPoints  int
	pointIDs []string
	pointIdx map[string]int
	safety   []int32

	skus     []model.SKU
	skuIdx   map[string]int32
	physical []int32 // [sku*stride + p]
	reserved []int32
	listed   []uint64 // [sku*words + w]
	avail    []uint64 // promisable > 0
}

var ErrUnknownSKU = errors.New("unknown sku")
var ErrUnknownStockPoint = errors.New("unknown stock point")

func roundStride(n int) int {
	if n < 64 {
		return 64
	}
	return (n + 63) / 64 * 64
}

// NewStock allocates a matrix for the given catalog and stock points.
func NewStock(skus []model.SKU, points []string, safety []int) *Stock {
	s := &Stock{skus: skus}
	s.skuIdx = make(map[string]int32, len(skus))
	for i, k := range skus {
		s.skuIdx[k.Code] = int32(i)
	}
	s.resize(points, safety)
	return s
}

func (s *Stock) resize(points []string, safety []int) {
	stride := roundStride(len(points) + 8)
	words := stride / 64
	n := len(s.skus)
	phys := make([]int32, n*stride)
	res := make([]int32, n*stride)
	listed := make([]uint64, n*words)
	avail := make([]uint64, n*words)
	newIdx := make(map[string]int, len(points))
	for i, id := range points {
		newIdx[id] = i
	}
	// carry over existing quantities
	if s.physical != nil {
		for oldP, id := range s.pointIDs {
			np, ok := newIdx[id]
			if !ok {
				continue
			}
			for k := 0; k < n; k++ {
				phys[k*stride+np] = s.physical[k*s.stride+oldP]
				res[k*stride+np] = s.reserved[k*s.stride+oldP]
				if s.listed[k*s.words+oldP/64]&(1<<uint(oldP%64)) != 0 {
					listed[k*words+np/64] |= 1 << uint(np%64)
				}
			}
		}
	}
	s.stride, s.words = stride, words
	s.pointIDs = append([]string(nil), points...)
	s.pointIdx = newIdx
	s.nPoints = len(points)
	s.safety = make([]int32, len(points))
	for i := range points {
		if i < len(safety) {
			s.safety[i] = int32(safety[i])
		}
	}
	s.physical, s.reserved, s.listed, s.avail = phys, res, listed, avail
	for k := 0; k < n; k++ {
		for p := 0; p < s.nPoints; p++ {
			s.refreshBit(k, p)
		}
	}
}

// SetPoints redefines the stock point set (after a CRUD operation). Existing
// quantities of retained points are kept.
func (s *Stock) SetPoints(points []string, safety []int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(points) <= s.stride && sameOrderPrefix(s.pointIDs, points) {
		for i := s.nPoints; i < len(points); i++ {
			s.pointIdx[points[i]] = i
		}
		s.pointIDs = append([]string(nil), points...)
		s.nPoints = len(points)
		s.safety = make([]int32, len(points))
		for i := range points {
			if i < len(safety) {
				s.safety[i] = int32(safety[i])
			}
		}
		for k := range s.skus {
			for p := 0; p < s.nPoints; p++ {
				s.refreshBit(k, p)
			}
		}
	} else {
		s.resize(points, safety)
	}
	s.version.Add(1)
}

func sameOrderPrefix(old, nw []string) bool {
	if len(nw) < len(old) {
		return false
	}
	for i := range old {
		if old[i] != nw[i] {
			return false
		}
	}
	return true
}

func (s *Stock) refreshBit(k, p int) {
	i := k*s.stride + p
	w := k*s.words + p/64
	bit := uint64(1) << uint(p%64)
	listed := s.listed[w]&bit != 0
	prom := s.physical[i] - s.reserved[i] - s.safety[p]
	if listed && prom > 0 {
		s.avail[w] |= bit
	} else {
		s.avail[w] &^= bit
	}
}

func (s *Stock) Version() uint64 { return s.version.Load() }

func (s *Stock) SKUs() []model.SKU {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.skus
}

func (s *Stock) SKUIndex(code string) (int32, bool) {
	i, ok := s.skuIdx[code]
	return i, ok
}

func (s *Stock) SKU(i int32) model.SKU {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.skus[i]
}

func (s *Stock) PointIDs() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.pointIDs...)
}

// LineCount returns the number of listed stock lines.
func (s *Stock) LineCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := 0
	for _, w := range s.listed {
		c += bits.OnesCount64(w)
	}
	return c
}

// Set writes one stock line (bulk loaders call SetUnlocked under Lock).
func (s *Stock) Set(pointID, sku string, physical, reserved int, listed bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.setLocked(pointID, sku, physical, reserved, listed); err != nil {
		return err
	}
	s.version.Add(1)
	return nil
}

func (s *Stock) setLocked(pointID, sku string, physical, reserved int, listed bool) error {
	p, ok := s.pointIdx[pointID]
	if !ok {
		return ErrUnknownStockPoint
	}
	k, ok := s.skuIdx[sku]
	if !ok {
		return ErrUnknownSKU
	}
	s.SetRaw(int(k), p, int32(physical), int32(reserved), listed)
	return nil
}

// SetRaw writes by index without locking; callers must hold the lock or own
// the matrix exclusively (generator).
func (s *Stock) SetRaw(k, p int, physical, reserved int32, listed bool) {
	i := k*s.stride + p
	s.physical[i] = physical
	s.reserved[i] = reserved
	w := k*s.words + p/64
	bit := uint64(1) << uint(p%64)
	if listed {
		s.listed[w] |= bit
	} else {
		s.listed[w] &^= bit
	}
	s.refreshBit(k, p)
}

// StockUpdate is one line of a bulk update. Nil fields are left unchanged;
// Delta adjusts the physical quantity relatively.
type StockUpdate struct {
	StockPointID string `json:"stockPointId"`
	SKU          string `json:"sku"`
	Physical     *int   `json:"physical,omitempty"`
	Reserved     *int   `json:"reserved,omitempty"`
	Delta        *int   `json:"delta,omitempty"`
	Listed       *bool  `json:"listed,omitempty"`
}

type StockUpdateError struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

// Apply applies a batch atomically with respect to readers (one write lock,
// one version bump). Invalid lines are reported and skipped.
func (s *Stock) Apply(updates []StockUpdate) (applied int, errs []StockUpdateError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, u := range updates {
		p, ok := s.pointIdx[u.StockPointID]
		if !ok {
			errs = append(errs, StockUpdateError{i, "unknown stock point " + u.StockPointID})
			continue
		}
		k, ok := s.skuIdx[u.SKU]
		if !ok {
			errs = append(errs, StockUpdateError{i, "unknown sku " + u.SKU})
			continue
		}
		idx := int(k)*s.stride + p
		phys, res := s.physical[idx], s.reserved[idx]
		listed := s.listed[int(k)*s.words+p/64]&(1<<uint(p%64)) != 0
		if u.Physical != nil {
			phys = int32(*u.Physical)
			listed = true
		}
		if u.Delta != nil {
			phys += int32(*u.Delta)
			listed = true
		}
		if u.Reserved != nil {
			res = int32(*u.Reserved)
		}
		if u.Listed != nil {
			listed = *u.Listed
		}
		if phys < 0 || res < 0 {
			errs = append(errs, StockUpdateError{i, "quantities must be >= 0"})
			continue
		}
		s.SetRaw(int(k), p, phys, res, listed)
		applied++
	}
	if applied > 0 {
		s.version.Add(1)
	}
	return
}

// Lock/Unlock expose the write lock to bulk loaders.
func (s *Stock) Lock()   { s.mu.Lock() }
func (s *Stock) Unlock() { s.version.Add(1); s.mu.Unlock() }

// PointIndex returns the matrix column of a stock point.
func (s *Stock) PointIndex(id string) (int, bool) {
	p, ok := s.pointIdx[id]
	return p, ok
}

func (s *Stock) line(k int32, p int) model.StockLine {
	i := int(k)*s.stride + p
	phys, res := int(s.physical[i]), int(s.reserved[i])
	listed := s.listed[int(k)*s.words+p/64]&(1<<uint(p%64)) != 0
	avail := phys - res
	if avail < 0 {
		avail = 0
	}
	prom := avail - int(s.safety[p])
	if prom < 0 || !listed {
		prom = 0
	}
	return model.StockLine{StockPointID: s.pointIDs[p], SKU: s.skus[k].Code, Physical: phys, Reserved: res, Available: avail, Promisable: prom, Listed: listed}
}

// Line returns one stock line.
func (s *Stock) Line(pointID, sku string) (model.StockLine, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.pointIdx[pointID]
	if !ok {
		return model.StockLine{}, ErrUnknownStockPoint
	}
	k, ok := s.skuIdx[sku]
	if !ok {
		return model.StockLine{}, ErrUnknownSKU
	}
	return s.line(k, p), nil
}

// StockQuery filters stock lines for listing.
type StockQuery struct {
	StockPointID  string
	SKU           string
	OnlyListed    bool
	OnlyAvailable bool
	Offset, Limit int
}

// Query lists lines (point-major when a point is given, else sku-major).
func (s *Stock) Query(q StockQuery) ([]model.StockLine, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var points []int
	if q.StockPointID != "" {
		p, ok := s.pointIdx[q.StockPointID]
		if !ok {
			return nil, 0, ErrUnknownStockPoint
		}
		points = []int{p}
	} else {
		points = make([]int, s.nPoints)
		for i := range points {
			points[i] = i
		}
	}
	var skus []int32
	if q.SKU != "" {
		k, ok := s.skuIdx[q.SKU]
		if !ok {
			return nil, 0, ErrUnknownSKU
		}
		skus = []int32{k}
	}
	total := 0
	out := make([]model.StockLine, 0, q.Limit)
	visit := func(k int32, p int) {
		w := int(k)*s.words + p/64
		bit := uint64(1) << uint(p%64)
		if q.OnlyListed && s.listed[w]&bit == 0 {
			return
		}
		if q.OnlyAvailable && s.avail[w]&bit == 0 {
			return
		}
		if total >= q.Offset && len(out) < q.Limit {
			out = append(out, s.line(k, p))
		}
		total++
	}
	if skus != nil {
		for _, k := range skus {
			for _, p := range points {
				visit(k, p)
			}
		}
	} else {
		for _, p := range points {
			for k := range s.skus {
				visit(int32(k), p)
			}
		}
	}
	return out, total, nil
}

// PointSummary aggregates the stock of one point.
type PointSummary struct {
	Lines         int `json:"lines"`
	Listed        int `json:"listed"`
	Available     int `json:"availableSkus"`
	OutOfStock    int `json:"outOfStockSkus"`
	TotalUnits    int `json:"totalUnits"`
	ReservedUnits int `json:"reservedUnits"`
}

func (s *Stock) Summary(pointID string) (PointSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.pointIdx[pointID]
	if !ok {
		return PointSummary{}, ErrUnknownStockPoint
	}
	var sum PointSummary
	sum.Lines = len(s.skus)
	bit := uint64(1) << uint(p%64)
	for k := range s.skus {
		w := k*s.words + p/64
		if s.listed[w]&bit == 0 {
			continue
		}
		sum.Listed++
		i := k*s.stride + p
		sum.TotalUnits += int(s.physical[i])
		sum.ReservedUnits += int(s.reserved[i])
		if s.avail[w]&bit != 0 {
			sum.Available++
		} else {
			sum.OutOfStock++
		}
	}
	return sum, nil
}

// Snapshot is a consistent copy of the promisable quantities of a basket.
type Snapshot struct {
	Version  uint64
	NPoints  int
	PointIDs []string
	SKUs     []int32
	// Qty[i*NPoints + p] is the promisable quantity of SKUs[i] at point p.
	Qty []int32
	// Avail[i] is the availability bitmap of SKUs[i].
	Avail [][]uint64
}

func (sn *Snapshot) Q(i, p int) int32 { return sn.Qty[i*sn.NPoints+p] }

// Snapshot copies the promisable quantities of the given SKU indexes.
func (s *Stock) Snapshot(skus []int32) *Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sn := &Snapshot{Version: s.version.Load(), NPoints: s.nPoints, PointIDs: s.pointIDs, SKUs: skus}
	sn.Qty = make([]int32, len(skus)*s.nPoints)
	sn.Avail = make([][]uint64, len(skus))
	for i, k := range skus {
		base := int(k) * s.stride
		wbase := int(k) * s.words
		bm := make([]uint64, s.words)
		copy(bm, s.avail[wbase:wbase+s.words])
		sn.Avail[i] = bm
		for w, word := range bm {
			for word != 0 {
				b := bits.TrailingZeros64(word)
				word &= word - 1
				p := w*64 + b
				if p >= s.nPoints {
					continue
				}
				sn.Qty[i*s.nPoints+p] = s.physical[base+p] - s.reserved[base+p] - s.safety[p]
			}
		}
	}
	return sn
}

// ForEachLine iterates over listed lines (export / persistence).
func (s *Stock) ForEachLine(fn func(l model.StockLine)) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for p := 0; p < s.nPoints; p++ {
		for k := range s.skus {
			if s.listed[k*s.words+p/64]&(1<<uint(p%64)) != 0 {
				fn(s.line(int32(k), p))
			}
		}
	}
}

// UpdateSKU replaces the description of a catalog article.
func (s *Stock) UpdateSKU(v model.SKU) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.skuIdx[v.Code]
	if !ok {
		return ErrUnknownSKU
	}
	skus := append([]model.SKU(nil), s.skus...) // copy-on-write: readers keep their slice
	skus[k] = v
	s.skus = skus
	s.version.Add(1)
	return nil
}
