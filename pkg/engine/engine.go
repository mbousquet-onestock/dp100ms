// Package engine computes delivery promises: sourcing (beam search over
// stock allocations), packaging, multi-leg routing with calendars and
// cut-offs, consolidation at hubs and multi-criteria scoring.
package engine

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
	"github.com/onestock/dp100ms/pkg/store"
)

// Engine is safe for concurrent use.
type Engine struct {
	store *store.Store
	nets  *network.Cache
	seq   atomic.Uint64

	RouteCacheHits   atomic.Uint64
	RouteCacheMisses atomic.Uint64
}

func New(s *store.Store) *Engine {
	return &Engine{store: s, nets: network.NewCache(s)}
}

// Network returns the current compiled network.
func (e *Engine) Network() *network.Network { return e.nets.Get() }

// ValidationError lists invalid request fields.
type ValidationError struct {
	Fields []FieldError
}

type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (v *ValidationError) Error() string {
	parts := make([]string, len(v.Fields))
	for i, f := range v.Fields {
		parts[i] = f.Field + ": " + f.Message
	}
	return "invalid request: " + strings.Join(parts, "; ")
}

type item struct {
	code   string
	idx    int32
	qty    int
	weight float64
	volume float64
	sku    *model.SKU
}

type reqCtx struct {
	e        *Engine
	net      *network.Network
	sn       *store.Snapshot
	req      *model.PromiseRequest
	order    time.Time
	orderU   int64
	clk      *calendar.Clock
	postal   string
	dept     string
	items    []item
	prep     []int64 // by node index, -1 = not computed
	colNodes []*network.Node
	ptPool   []pathTiming
	legPool  []legTime
	timings  map[timingKey]*pathTiming
	weights  model.ScoringWeights
	stats    model.EngineStats
	reqID    string
	// pricing
	orderAmount float64
	view        *network.StockView
	viewItemOK  []bool
	legMasks    map[int]uint64
	finalDist   map[int]float64
	modeCands   map[string][]candidate
}

const maxUnits = 500

// Validate normalises and checks a request.
func (e *Engine) Validate(req *model.PromiseRequest) ([]item, string, error) {
	var errs []FieldError
	if req.Destination.Country != "" && strings.ToUpper(req.Destination.Country) != "FR" {
		errs = append(errs, FieldError{"destination.country", "only FR is supported"})
	}
	dept, err := network.Dept(req.Destination.PostalCode)
	if err != nil {
		errs = append(errs, FieldError{"destination.postalCode", err.Error()})
	}
	if req.OrderDate.IsZero() {
		errs = append(errs, FieldError{"orderDate", "required (RFC 3339 date-time)"})
	}
	if len(req.Items) == 0 {
		errs = append(errs, FieldError{"items", "at least one item is required"})
	}
	if len(req.Items) > 50 {
		errs = append(errs, FieldError{"items", "at most 50 distinct lines"})
	}
	if req.MaxOptions < 0 || req.MaxOptions > 50 {
		errs = append(errs, FieldError{"maxOptions", "must be between 1 and 50"})
	}
	merged := map[string]int{}
	var order []string
	units := 0
	for i, it := range req.Items {
		if it.SKU == "" {
			errs = append(errs, FieldError{fmt.Sprintf("items[%d].sku", i), "required"})
			continue
		}
		if it.Quantity <= 0 {
			errs = append(errs, FieldError{fmt.Sprintf("items[%d].quantity", i), "must be > 0"})
			continue
		}
		if _, ok := e.store.Stock.SKUIndex(it.SKU); !ok {
			errs = append(errs, FieldError{fmt.Sprintf("items[%d].sku", i), "unknown sku " + it.SKU})
			continue
		}
		if _, ok := merged[it.SKU]; !ok {
			order = append(order, it.SKU)
		}
		merged[it.SKU] += it.Quantity
		units += it.Quantity
	}
	if units > maxUnits {
		errs = append(errs, FieldError{"items", fmt.Sprintf("at most %d units per basket", maxUnits)})
	}
	net := e.nets.Get()
	for i, m := range req.DeliveryModes {
		if _, ok := net.Modes[m]; !ok {
			errs = append(errs, FieldError{fmt.Sprintf("deliveryModes[%d]", i), "unknown or inactive delivery mode " + m})
		}
	}
	for i, id := range req.AdditionalServices {
		if _, ok := net.AddServices[id]; !ok {
			errs = append(errs, FieldError{fmt.Sprintf("additionalServices[%d]", i), "unknown or inactive additional service " + id})
		}
	}
	if req.StockViewID != "" {
		if _, ok := net.StockViews[req.StockViewID]; !ok {
			errs = append(errs, FieldError{"stockViewId", "unknown or inactive stock view " + req.StockViewID})
		}
	}
	if req.OrderAmount != nil && *req.OrderAmount < 0 {
		errs = append(errs, FieldError{"orderAmount", "must be >= 0"})
	}
	if a := req.Alternatives; a != nil && (a.Limit < 0 || a.Limit > 20) {
		errs = append(errs, FieldError{"alternatives.limit", "must be between 1 and 20"})
	}
	for i, cr := range req.Criteria {
		if cr.Weight < 0 {
			errs = append(errs, FieldError{fmt.Sprintf("criteria[%d].weight", i), "must be >= 0"})
		}
		if cr.Direction != "" && cr.Direction != "MIN" && cr.Direction != "MAX" {
			errs = append(errs, FieldError{fmt.Sprintf("criteria[%d].direction", i), "MIN or MAX"})
		}
	}
	if req.Weights != nil {
		w := req.Weights
		if w.DeliveryTime < 0 || w.Packages < 0 || w.Cost < 0 || w.Legs < 0 || w.Sources < 0 {
			errs = append(errs, FieldError{"weights", "weights must be >= 0"})
		}
	}
	if len(errs) > 0 {
		return nil, "", &ValidationError{errs}
	}
	items := make([]item, 0, len(order))
	for _, code := range order {
		idx, _ := e.store.Stock.SKUIndex(code)
		sku := e.store.Stock.SKU(idx)
		sk := sku
		items = append(items, item{code: code, idx: idx, qty: merged[code], weight: sku.WeightKg, volume: sku.VolumeL, sku: &sk})
	}
	return items, dept, nil
}

// ErrInvalid wraps validation failures.
var ErrInvalid = errors.New("invalid request")

// Promise computes delivery options for a basket.
func (e *Engine) Promise(req *model.PromiseRequest) (*model.PromiseResponse, error) {
	start := time.Now()
	items, dept, err := e.Validate(req)
	if err != nil {
		return nil, err
	}
	net := e.nets.Get()
	skus := make([]int32, len(items))
	for i, it := range items {
		skus[i] = it.idx
	}
	c := &reqCtx{
		e: e, net: net, sn: e.store.Stock.Snapshot(skus), req: req,
		order: req.OrderDate.In(net.Loc), postal: req.Destination.PostalCode, dept: dept, items: items,
		prep: newPrep(len(net.NodeList)), timings: make(map[timingKey]*pathTiming, 256),
		weights: net.Settings.Weights, clk: calendar.ClockFor(net.Loc), orderU: req.OrderDate.Unix(),
	}
	c.colNodes = net.NodesForColumns(c.sn.PointIDs)
	c.modeCands = map[string][]candidate{}
	if req.OrderAmount != nil {
		c.orderAmount = *req.OrderAmount
	} else {
		for _, it := range items {
			c.orderAmount += it.sku.PriceEur * float64(it.qty)
		}
	}
	if req.Weights != nil {
		c.weights = *req.Weights
	}
	c.reqID = fmt.Sprintf("req-%d-%d", time.Now().UnixNano()/1e6, e.seq.Add(1))
	c.stats.StockVersion = c.sn.Version
	c.stats.ConfigVersion = net.Version

	modes := req.DeliveryModes
	if len(modes) == 0 {
		modes = net.ModeList
	}
	maxOptions := req.MaxOptions
	if maxOptions == 0 {
		maxOptions = 5
	}
	resp := &model.PromiseResponse{RequestID: c.reqID, Options: []model.PromiseOption{}, Unavailable: []model.Unfulfillable{}}
	var perMode [][]*plan
	allHit := true
	for _, mode := range modes {
		plans, unf := c.planMode(mode, &allHit)
		if unf != nil {
			resp.Unavailable = append(resp.Unavailable, *unf)
			continue
		}
		c.scorePlans(mode, plans)
		perMode = append(perMode, plans)
	}
	c.stats.RouteCacheHit = allHit
	selected := selectPlans(perMode, maxOptions)
	for i, p := range selected {
		c.setView(p.mode)
		resp.Options = append(resp.Options, c.buildOption(p, i+1))
	}
	elapsed := time.Since(start)
	c.stats.ComputeMicros = elapsed.Microseconds()
	resp.Stats = c.stats
	resp.CalculationTimeMs = math.Round(float64(elapsed.Microseconds())/10) / 100
	return resp, nil
}

func (c *reqCtx) mode(id string) *model.DeliveryMode { return c.net.Modes[id] }

func (c *reqCtx) allowConsolidation(mode string) bool {
	if c.req.Constraints != nil && c.req.Constraints.ForbidConsolidation {
		return false
	}
	m := c.mode(mode)
	return m != nil && m.AllowConsolidation
}

func (c *reqCtx) allowSplit(mode string) bool {
	m := c.mode(mode)
	return m == nil || m.AllowSplit
}

func (c *reqCtx) maxSources(mode string) int {
	n := 3
	if m := c.mode(mode); m != nil && m.MaxSources > 0 {
		n = m.MaxSources
	}
	if c.req.Constraints != nil && c.req.Constraints.MaxSources > 0 && c.req.Constraints.MaxSources < n {
		n = c.req.Constraints.MaxSources
	}
	return n
}

// planMode computes every candidate plan of a delivery mode.
func (c *reqCtx) planMode(mode string, allHit *bool) ([]*plan, *model.Unfulfillable) {
	if strings.HasPrefix(c.dept, "97") || strings.HasPrefix(c.dept, "98") {
		return nil, &model.Unfulfillable{DeliveryMode: mode, Code: "DESTINATION_NOT_SERVED", Reason: "overseas destinations are not served"}
	}
	dr, hit := c.net.Routes(c.dept, mode)
	if hit {
		c.e.RouteCacheHits.Add(1)
	} else {
		c.e.RouteCacheMisses.Add(1)
		*allHit = false
	}
	if dr.Count == 0 {
		return nil, &model.Unfulfillable{DeliveryMode: mode, Code: "DESTINATION_NOT_SERVED", Reason: fmt.Sprintf("no route serves department %s for mode %s", c.dept, mode)}
	}
	c.setView(mode)
	cands := c.findCandidates(mode, dr)
	c.modeCands[mode] = cands
	c.stats.CandidateStockPoints += len(cands)
	if len(cands) == 0 {
		return nil, &model.Unfulfillable{DeliveryMode: mode, Code: "NO_STOCK", Reason: "no connected stock point holds the requested items"}
	}
	allocs := c.searchAllocations(mode, cands)
	c.stats.Allocations += len(allocs)
	if len(allocs) == 0 {
		return nil, &model.Unfulfillable{DeliveryMode: mode, Code: "INSUFFICIENT_STOCK", Reason: c.insufficientReason(cands)}
	}
	var plans []*plan
	seen := map[uint64]bool{}
	addPlan := func(p *plan) {
		if p == nil {
			return
		}
		c.stats.PlansEvaluated++
		if !c.finalizePlan(p) || !c.acceptPlan(mode, p) {
			return
		}
		sig := p.signature()
		if seen[sig] {
			return
		}
		seen[sig] = true
		plans = append(plans, p)
	}
	consolidation := c.allowConsolidation(mode)
	for _, a := range allocs {
		for _, p := range c.planDirect(mode, dr, cands, a) {
			addPlan(p)
		}
		if consolidation && len(a.sources) > 1 {
			for _, p := range c.planConsolidated(mode, dr, cands, a) {
				addPlan(p)
			}
		}
	}
	if len(plans) == 0 {
		return nil, &model.Unfulfillable{DeliveryMode: mode, Code: "NO_FEASIBLE_PLAN", Reason: "stock is available but no route, calendar or parcel constraint allows a delivery for this mode"}
	}
	return plans, nil
}

func (c *reqCtx) insufficientReason(cands []candidate) string {
	var short []string
	for i, it := range c.items {
		total := 0
		for _, cd := range cands {
			total += c.qty(i, cd.col)
		}
		if total < it.qty {
			short = append(short, fmt.Sprintf("%s (requested %d, promisable %d)", it.code, it.qty, total))
		}
	}
	if len(short) == 0 {
		return "no allocation satisfies the sourcing constraints (max sources / split)"
	}
	return "insufficient promisable stock for " + strings.Join(short, ", ")
}

func (c *reqCtx) acceptPlan(mode string, p *plan) bool {
	m := c.mode(mode)
	if m != nil && m.MaxDeliveryDays >= 0 {
		if c.clk.BusinessDaysBetween(c.orderU, p.window.To) > m.MaxDeliveryDays {
			return false
		}
	}
	if cs := c.req.Constraints; cs != nil && cs.MaxPackages > 0 && p.packagesFinal > cs.MaxPackages {
		return false
	}
	if !c.withinLimits(p) {
		return false
	}
	return true
}

// selectPlans keeps the best plan of every mode, then the best plan of
// every (mode, strategy) pair, then fills by score. Plans with an identical
// outcome (same mode, window, packages and cost) are not repeated.
func selectPlans(perMode [][]*plan, maxOptions int) []*plan {
	var out []*plan
	used := map[*plan]bool{}
	outcomes := map[string]bool{}
	outcome := func(p *plan) string {
		return fmt.Sprintf("%s|%s|%d|%d|%.2f|%d", p.mode, p.strategy, p.window.To, p.packagesFinal, p.cost, p.sources)
	}
	take := func(p *plan) bool {
		if used[p] || len(out) >= maxOptions {
			return false
		}
		k := outcome(p)
		if outcomes[k] {
			return false
		}
		outcomes[k] = true
		used[p] = true
		out = append(out, p)
		return true
	}
	for _, plans := range perMode {
		if len(plans) > 0 {
			take(plans[0])
		}
	}
	for _, plans := range perMode {
		strat := map[string]bool{plans[0].strategy: true}
		for _, p := range plans {
			if !strat[p.strategy] {
				strat[p.strategy] = true
				take(p)
			}
		}
	}
	var rest []*plan
	for _, plans := range perMode {
		for _, p := range plans {
			if !used[p] {
				rest = append(rest, p)
			}
		}
	}
	sort.SliceStable(rest, func(a, b int) bool { return rest[a].score > rest[b].score })
	for _, p := range rest {
		take(p)
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].score > out[b].score })
	return out
}

func newPrep(n int) []int64 {
	p := make([]int64, n)
	for i := range p {
		p[i] = -1
	}
	return p
}
