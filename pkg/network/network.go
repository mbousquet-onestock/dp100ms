// Package network compiles the logistic configuration into an immutable
// directed graph (nodes = stock points and hubs, edges = legs) and
// enumerates bounded paths towards a delivery zone. Compiled networks are
// cached per configuration version; destination path sets are cached per
// (department, delivery mode) inside a network.
package network

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

type NodeKind string

const (
	NodeStore     NodeKind = "STORE"
	NodeWarehouse NodeKind = "WAREHOUSE"
	NodeLastMile  NodeKind = "LAST_MILE_HUB"
	NodeHub       NodeKind = "HUB"
)

// Hub is a compiled hub.
type Hub struct {
	model.Hub
	Cal *calendar.Cal
	// Unavail are the unavailability windows as Unix seconds [from, to).
	Unavail [][2]int64
}

// Node is a vertex of the network graph.
type Node struct {
	Idx        int // dense index in Network.NodeList
	ID         string
	Name       string
	Kind       NodeKind
	Lat, Lon   float64
	StockPoint *model.StockPoint
	PrepCal    *calendar.Cal
	Hub        *Hub
	modes      map[string]bool
	// Inbound[originIdx] lists origin -> this hub paths (consolidation hubs).
	Inbound [][]*Path
}

// AllowsMode reports whether a stock point may ship for a delivery mode.
func (n *Node) AllowsMode(m string) bool {
	if n.modes == nil {
		return true
	}
	return n.modes[m]
}

// Leg is a compiled leg.
type Leg struct {
	*model.Leg
	Idx         int
	ToNode      *Node // nil for CUSTOMER
	Service     *model.CarrierService
	Carrier     *model.Carrier
	PickupCal   *calendar.Cal
	DeliveryCal *calendar.Cal
	Departures  []model.TimeOfDay
	Transit     time.Duration
	Final       bool
	zones       map[string]bool // nil = all metropolitan departments
	excluded    map[string]bool
	modes       map[string]bool
	MaxWeightKg float64
	MaxVolumeL  float64
	MaxItems    int
}

// ServesDept reports whether a final leg covers a department.
func (l *Leg) ServesDept(dept string) bool {
	if l.excluded[dept] {
		return false
	}
	if l.zones == nil {
		return true
	}
	return l.zones[dept]
}

// ServesPostalCode applies the optional explicit postal code list.
func (l *Leg) ServesPostalCode(pc string) bool {
	if len(l.Service.ServedPostalCodes) == 0 {
		return true
	}
	for _, p := range l.Service.ServedPostalCodes {
		if strings.HasPrefix(pc, p) {
			return true
		}
	}
	return false
}

func (l *Leg) HasMode(m string) bool { return l.modes[m] }

// Path is an ordered sequence of legs from an origin node.
type Path struct {
	sig      string // cached Signature()
	ID       int
	Origin   string
	Legs     []*Leg
	Hubs     []string
	RouteID  string // explicit route, if any
	MaxW     float64
	MaxV     float64
	MaxItems int
}

func (p *Path) Signature() string {
	if p.sig != "" {
		return p.sig
	}
	ids := make([]string, len(p.Legs))
	for i, l := range p.Legs {
		ids[i] = l.ID
	}
	return strings.Join(ids, ">")
}

// DestRoutes holds every bounded path to a department for a delivery mode.
type DestRoutes struct {
	Dept     string
	Mode     string
	ByOrigin map[string][]*Path // origin node -> paths to the customer
	ByIdx    [][]*Path          // same, indexed by Node.Idx
	Count    int
}

// Network is an immutable compiled graph.
type Network struct {
	Version           uint64
	Loc               *time.Location
	Settings          model.EngineSettings
	Nodes             map[string]*Node
	NodeList          []*Node
	Legs              []*Leg
	LegByID           map[string]*Leg
	In                map[string][]*Leg
	Final             []*Leg
	Modes             map[string]*model.DeliveryMode
	ModeList          []string
	Carriers          map[string]*model.Carrier
	ExplicitRoutes    []model.Route
	ConsolidationHubs []*Node

	// HubInbound[hub][origin] lists paths origin -> hub (<= 2 legs).
	HubInbound map[string]map[string][]*Path

	destCache sync.Map // key dept|mode -> *DestRoutes
	colCache  atomic.Pointer[colMapping]
	pathSeq   int
	pathMu    sync.Mutex
	canonical map[string]*Path
	Warnings  []string
}

func setOf(xs []string) map[string]bool {
	if len(xs) == 0 {
		return nil
	}
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}

func minPositive(a, b float64) float64 {
	if a <= 0 {
		return b
	}
	if b <= 0 || a < b {
		return a
	}
	return b
}

func minPositiveInt(a, b int) int {
	if a <= 0 {
		return b
	}
	if b <= 0 || a < b {
		return a
	}
	return b
}

// Compile builds a network from the store.
func Compile(s *store.Store) *Network {
	settings := s.Settings()
	loc := calendar.Paris()
	if settings.Timezone != "" && settings.Timezone != "Europe/Paris" {
		if l, err := time.LoadLocation(settings.Timezone); err == nil {
			loc = l
		}
	}
	n := &Network{
		Version: s.ConfigVersion(), Loc: loc, Settings: settings,
		Nodes: map[string]*Node{}, LegByID: map[string]*Leg{}, In: map[string][]*Leg{},
		Modes: map[string]*model.DeliveryMode{}, Carriers: map[string]*model.Carrier{},
		HubInbound: map[string]map[string][]*Path{},
	}
	for _, sp := range s.StockPoints.All() {
		sp := sp
		if !sp.Active {
			continue
		}
		kind := NodeStore
		switch sp.Type {
		case model.StockPointWarehouse:
			kind = NodeWarehouse
		case model.StockPointLastMileHub:
			kind = NodeLastMile
		}
		n.Nodes[sp.ID] = &Node{ID: sp.ID, Name: sp.Name, Kind: kind, Lat: sp.Lat, Lon: sp.Lon, StockPoint: &sp,
			PrepCal: calendar.Compile(sp.PrepCalendar), modes: setOf(sp.AllowedModes)}
	}
	for _, h := range s.Hubs.All() {
		h := h
		if !h.Active {
			continue
		}
		ch := &Hub{Hub: h, Cal: calendar.Compile(h.Calendar)}
		for _, u := range h.Unavailability {
			ch.Unavail = append(ch.Unavail, [2]int64{u.From.Unix(), u.To.Unix()})
		}
		if node, ok := n.Nodes[h.ID]; ok {
			node.Hub = ch
		} else if h.StockPointID != "" {
			if node, ok := n.Nodes[h.StockPointID]; ok {
				node.Hub = ch
				n.Nodes[h.ID] = node
			}
		} else {
			n.Nodes[h.ID] = &Node{ID: h.ID, Name: h.Name, Kind: NodeHub, Lat: h.Lat, Lon: h.Lon, Hub: ch}
		}
		if h.ConsolidationEnabled {
			if node := n.Nodes[h.ID]; node != nil {
				n.ConsolidationHubs = append(n.ConsolidationHubs, node)
			}
		}
	}
	seenNode := map[*Node]bool{}
	ids := make([]string, 0, len(n.Nodes))
	for id := range n.Nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		nd := n.Nodes[id]
		if !seenNode[nd] {
			seenNode[nd] = true
			nd.Idx = len(n.NodeList)
			n.NodeList = append(n.NodeList, nd)
		}
	}
	for _, c := range s.Carriers.All() {
		c := c
		n.Carriers[c.ID] = &c
	}
	services := map[string]*model.CarrierService{}
	for _, sv := range s.Services.All() {
		sv := sv
		services[sv.ID] = &sv
	}
	for _, m := range s.Modes.All() {
		m := m
		if m.Active {
			n.Modes[m.ID] = &m
			n.ModeList = append(n.ModeList, m.ID)
		}
	}
	for _, lg := range s.Legs.All() {
		lg := lg
		if !lg.Active {
			continue
		}
		svc := services[lg.ServiceID]
		car := n.Carriers[lg.CarrierID]
		if svc == nil || car == nil || !svc.Active || !car.Active || svc.CarrierID != car.ID {
			continue
		}
		if _, ok := n.Nodes[lg.From]; !ok {
			continue
		}
		final := lg.To == model.CustomerNode
		if !final {
			if to, ok := n.Nodes[lg.To]; !ok || to.Hub == nil {
				continue // legs must end at an active hub or the customer
			}
		}
		cl := &Leg{Leg: &lg, Idx: len(n.Legs), Service: svc, Carrier: car, Final: final, ToNode: n.Nodes[lg.To]}
		if lg.Calendar != nil {
			cl.PickupCal = calendar.Compile(*lg.Calendar)
		} else {
			cl.PickupCal = calendar.Compile(svc.PickupCalendar)
		}
		cl.DeliveryCal = calendar.Compile(svc.DeliveryCalendar)
		cl.Departures = append([]model.TimeOfDay(nil), lg.Departures...)
		if len(cl.Departures) == 0 {
			cl.Departures = []model.TimeOfDay{svc.Cutoff}
		}
		sort.Slice(cl.Departures, func(i, j int) bool { return cl.Departures[i] < cl.Departures[j] })
		tm := lg.TransitMinutes
		if tm == 0 {
			tm = svc.TransitMinutes
		}
		cl.Transit = time.Duration(tm) * time.Minute
		if len(lg.DestinationZones) > 0 {
			cl.zones = setOf(lg.DestinationZones)
		} else if !(len(svc.Coverage) == 1 && svc.Coverage[0] == "*") && len(svc.Coverage) > 0 {
			cl.zones = setOf(svc.Coverage)
		}
		cl.excluded = setOf(svc.ExcludedCoverage)
		if cl.excluded == nil {
			cl.excluded = map[string]bool{}
		}
		if len(lg.Modes) > 0 {
			cl.modes = setOf(lg.Modes)
		} else {
			cl.modes = setOf(svc.Modes)
		}
		if cl.modes == nil {
			cl.modes = map[string]bool{}
		}
		cl.MaxWeightKg = minPositive(lg.MaxWeightKg, svc.MaxWeightKg)
		cl.MaxVolumeL = svc.MaxVolumeL
		cl.MaxItems = svc.MaxItems
		n.Legs = append(n.Legs, cl)
		n.LegByID[lg.ID] = cl
		if final {
			n.Final = append(n.Final, cl)
		} else {
			n.In[lg.To] = append(n.In[lg.To], cl)
		}
	}
	for _, r := range s.Routes.All() {
		if r.Active {
			n.ExplicitRoutes = append(n.ExplicitRoutes, r)
		}
	}
	n.buildHubInbound()
	return n
}

// newPath returns the canonical path for a leg sequence: identical paths
// found for different destinations or modes share one object (and one ID),
// so per-request timing memos are shared too.
func (n *Network) newPath(origin string, legs []*Leg) *Path {
	p := n.buildPath(origin, legs)
	n.pathMu.Lock()
	defer n.pathMu.Unlock()
	if n.canonical == nil {
		n.canonical = map[string]*Path{}
	}
	if ex, ok := n.canonical[p.sig]; ok {
		return ex
	}
	n.pathSeq++
	p.ID = n.pathSeq
	n.canonical[p.sig] = p
	return p
}

// newExplicitPath creates a path labelled with an explicit route.
func (n *Network) newExplicitPath(origin string, legs []*Leg, routeID string) *Path {
	p := n.buildPath(origin, legs)
	p.RouteID = routeID
	n.pathMu.Lock()
	n.pathSeq++
	p.ID = n.pathSeq
	n.pathMu.Unlock()
	return p
}

func (n *Network) buildPath(origin string, legs []*Leg) *Path {
	p := &Path{Origin: origin, Legs: legs}
	for i, l := range legs {
		if i > 0 {
			p.Hubs = append(p.Hubs, l.From)
		}
		p.MaxW = minPositive(p.MaxW, l.MaxWeightKg)
		p.MaxV = minPositive(p.MaxV, l.MaxVolumeL)
		p.MaxItems = minPositiveInt(p.MaxItems, l.MaxItems)
	}
	p.sig = p.Signature()
	return p
}

// buildHubInbound enumerates origin -> consolidation hub paths (<= 2 legs).
func (n *Network) buildHubInbound() {
	for _, h := range n.ConsolidationHubs {
		in := map[string][]*Path{}
		for _, l1 := range n.In[h.ID] {
			origin := n.Nodes[l1.From]
			if origin.StockPoint != nil {
				in[origin.ID] = append(in[origin.ID], n.newPath(origin.ID, []*Leg{l1}))
			}
			if origin.Hub == nil {
				continue
			}
			for _, l0 := range n.In[l1.From] {
				o0 := n.Nodes[l0.From]
				if o0.ID == h.ID || o0.StockPoint == nil {
					continue
				}
				in[o0.ID] = append(in[o0.ID], n.newPath(o0.ID, []*Leg{l0, l1}))
			}
		}
		n.HubInbound[h.ID] = in
		h.Inbound = make([][]*Path, len(n.NodeList))
		for origin, paths := range in {
			h.Inbound[n.Nodes[origin].Idx] = paths
		}
	}
}

type colMapping struct {
	ids   []string
	nodes []*Node
}

// NodesForColumns maps stock matrix columns to nodes (nil when inactive).
// The mapping is cached for the column slice of the current stock matrix.
func (n *Network) NodesForColumns(ids []string) []*Node {
	if m := n.colCache.Load(); m != nil && len(m.ids) == len(ids) && (len(ids) == 0 || &m.ids[0] == &ids[0]) {
		return m.nodes
	}
	nodes := make([]*Node, len(ids))
	for i, id := range ids {
		nodes[i] = n.Nodes[id]
	}
	n.colCache.Store(&colMapping{ids: ids, nodes: nodes})
	return nodes
}

// Dept extracts the French department code of a postal code. Corsica
// (20xxx) maps to "20"; overseas codes (97/98) are returned as-is.
func Dept(postalCode string) (string, error) {
	if len(postalCode) != 5 {
		return "", fmt.Errorf("postal code must have 5 digits")
	}
	for _, c := range postalCode {
		if c < '0' || c > '9' {
			return "", fmt.Errorf("postal code must have 5 digits")
		}
	}
	if postalCode[:2] == "97" || postalCode[:2] == "98" {
		return postalCode[:3], nil
	}
	return postalCode[:2], nil
}

// Routes returns (and caches) every bounded path to a department for a mode.
func (n *Network) Routes(dept, mode string) (*DestRoutes, bool) {
	key := dept + "|" + mode
	if v, ok := n.destCache.Load(key); ok {
		return v.(*DestRoutes), true
	}
	dr := n.computeRoutes(dept, mode)
	actual, _ := n.destCache.LoadOrStore(key, dr)
	return actual.(*DestRoutes), false
}

func (n *Network) maxLegs(mode string) int {
	ml := n.Settings.MaxLegs
	if m := n.Modes[mode]; m != nil && m.MaxLegs > 0 {
		ml = m.MaxLegs
	}
	if ml <= 0 {
		ml = 3
	}
	if ml > 5 {
		ml = 5
	}
	return ml
}

func (n *Network) computeRoutes(dept, mode string) *DestRoutes {
	dr := &DestRoutes{Dept: dept, Mode: mode, ByOrigin: map[string][]*Path{}, ByIdx: make([][]*Path, len(n.NodeList))}
	maxLegs := n.maxLegs(mode)
	seen := map[string]bool{}
	add := func(p *Path) {
		sig := p.Signature()
		if seen[sig] {
			return
		}
		seen[sig] = true
		dr.ByOrigin[p.Origin] = append(dr.ByOrigin[p.Origin], p)
		if nd := n.Nodes[p.Origin]; nd != nil {
			dr.ByIdx[nd.Idx] = append(dr.ByIdx[nd.Idx], p)
		}
		dr.Count++
	}
	// Bounded reverse DFS from eligible final legs. Intermediate nodes must
	// be active hubs; cycles are forbidden.
	var stack []*Leg
	visited := map[string]bool{}
	var dfs func(node string)
	dfs = func(node string) {
		// record the path starting at node
		legs := make([]*Leg, len(stack))
		for i := range stack {
			legs[i] = stack[len(stack)-1-i]
		}
		if nd := n.Nodes[node]; nd != nil && (nd.StockPoint != nil || nd.Hub != nil) {
			add(n.newPath(node, legs))
		}
		if len(stack) >= maxLegs {
			return
		}
		nd := n.Nodes[node]
		if nd == nil || nd.Hub == nil {
			return // only hubs can be transit nodes
		}
		for _, in := range n.In[node] {
			if visited[in.From] {
				continue
			}
			visited[in.From] = true
			stack = append(stack, in)
			dfs(in.From)
			stack = stack[:len(stack)-1]
			visited[in.From] = false
		}
	}
	for _, f := range n.Final {
		if !f.HasMode(mode) || !f.ServesDept(dept) {
			continue
		}
		visited = map[string]bool{f.From: true}
		stack = append(stack[:0], f)
		dfs(f.From)
	}
	// Explicit routes are always considered (they may exceed maxLegs).
	for _, r := range n.ExplicitRoutes {
		if len(r.Modes) > 0 && !contains(r.Modes, mode) {
			continue
		}
		legs, ok := n.resolveRoute(r)
		if !ok {
			continue
		}
		last := legs[len(legs)-1]
		if !last.Final || !last.HasMode(mode) || !last.ServesDept(dept) {
			continue
		}
		add(n.newExplicitPath(legs[0].From, legs, r.ID))
	}
	return dr
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// resolveRoute checks contiguity of an explicit route.
func (n *Network) resolveRoute(r model.Route) ([]*Leg, bool) {
	if len(r.LegIDs) == 0 {
		return nil, false
	}
	legs := make([]*Leg, 0, len(r.LegIDs))
	for i, id := range r.LegIDs {
		l := n.LegByID[id]
		if l == nil {
			return nil, false
		}
		if i > 0 && legs[i-1].To != l.From {
			return nil, false
		}
		legs = append(legs, l)
	}
	return legs, true
}

// ValidateRoute is used by the API to report route errors.
func ValidateRoute(s *store.Store, r model.Route) []string {
	var errs []string
	legs := map[string]model.Leg{}
	for _, l := range s.Legs.All() {
		legs[l.ID] = l
	}
	if len(r.LegIDs) == 0 {
		errs = append(errs, "legIds must contain at least one leg")
	}
	for i, id := range r.LegIDs {
		l, ok := legs[id]
		if !ok {
			errs = append(errs, fmt.Sprintf("legIds[%d]: unknown leg %s", i, id))
			continue
		}
		if i > 0 {
			prev, ok := legs[r.LegIDs[i-1]]
			if ok && prev.To != l.From {
				errs = append(errs, fmt.Sprintf("legIds[%d]: leg %s starts at %s but previous leg ends at %s", i, id, l.From, prev.To))
			}
		}
		if i < len(r.LegIDs)-1 && l.To == model.CustomerNode {
			errs = append(errs, fmt.Sprintf("legIds[%d]: only the last leg may end at CUSTOMER", i))
		}
	}
	if len(r.LegIDs) > 0 {
		if l, ok := legs[r.LegIDs[len(r.LegIDs)-1]]; ok && l.To != model.CustomerNode {
			errs = append(errs, "the last leg must end at CUSTOMER")
		}
	}
	return errs
}

// ---------------------------------------------------------------------------
// Cache of compiled networks

// Cache returns the network matching the current configuration version,
// recompiling it on change. Concurrent callers share one compilation.
type Cache struct {
	s   *store.Store
	mu  sync.Mutex
	cur atomic.Pointer[Network]
}

func NewCache(s *store.Store) *Cache { return &Cache{s: s} }

func (c *Cache) Get() *Network {
	v := c.s.ConfigVersion()
	if n := c.cur.Load(); n != nil && n.Version == v {
		return n
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if n := c.cur.Load(); n != nil && n.Version == c.s.ConfigVersion() {
		return n
	}
	n := Compile(c.s)
	c.cur.Store(n)
	return n
}
