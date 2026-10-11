// Package store is the in-memory repository of the configuration (stock
// points, carriers, services, hubs, legs, routes, delivery modes, scenarios,
// settings) and of the stock matrix. Every configuration change bumps a
// version used by the network compiler to invalidate its caches. An optional
// Persister mirrors writes into PostgreSQL.
package store

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/onestock/dp100ms/pkg/model"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("already exists")
)

// Persister mirrors the in-memory state into durable storage.
type Persister interface {
	SaveEntity(kind, id string, v any) error
	DeleteEntity(kind, id string) error
	SaveStockLines(lines []model.StockLine) error
	SaveSKU(v model.SKU) error
}

// Collection is a thread-safe ordered map of entities.
type Collection[T any] struct {
	kind  string
	mu    sync.RWMutex
	items map[string]*T
	order []string
	id    func(*T) string
	owner *Store
}

func newCollection[T any](owner *Store, kind string, id func(*T) string) *Collection[T] {
	return &Collection[T]{kind: kind, items: map[string]*T{}, id: id, owner: owner}
}

func (c *Collection[T]) Kind() string { return c.kind }

func (c *Collection[T]) Get(id string) (T, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.items[id]
	if !ok {
		var zero T
		return zero, false
	}
	return *v, true
}

// All returns a copy of all entities in insertion order.
func (c *Collection[T]) All() []T {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]T, 0, len(c.order))
	for _, id := range c.order {
		out = append(out, *c.items[id])
	}
	return out
}

func (c *Collection[T]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.order)
}

// Create inserts a new entity.
func (c *Collection[T]) Create(v T) error {
	id := c.id(&v)
	c.mu.Lock()
	if _, ok := c.items[id]; ok {
		c.mu.Unlock()
		return ErrConflict
	}
	c.items[id] = &v
	c.order = append(c.order, id)
	c.mu.Unlock()
	c.owner.changed(c.kind, id, &v)
	return nil
}

// Put creates or replaces an entity.
func (c *Collection[T]) Put(v T) {
	id := c.id(&v)
	c.mu.Lock()
	if _, ok := c.items[id]; !ok {
		c.order = append(c.order, id)
	}
	c.items[id] = &v
	c.mu.Unlock()
	c.owner.changed(c.kind, id, &v)
}

// Update replaces an existing entity.
func (c *Collection[T]) Update(id string, v T) error {
	if c.id(&v) != id {
		return errors.New("id mismatch")
	}
	c.mu.Lock()
	if _, ok := c.items[id]; !ok {
		c.mu.Unlock()
		return ErrNotFound
	}
	c.items[id] = &v
	c.mu.Unlock()
	c.owner.changed(c.kind, id, &v)
	return nil
}

func (c *Collection[T]) Delete(id string) error {
	c.mu.Lock()
	if _, ok := c.items[id]; !ok {
		c.mu.Unlock()
		return ErrNotFound
	}
	delete(c.items, id)
	for i, o := range c.order {
		if o == id {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
	c.mu.Unlock()
	c.owner.deleted(c.kind, id)
	return nil
}

// LoadRaw inserts without notifications (bulk loading).
func (c *Collection[T]) LoadRaw(v T) {
	id := c.id(&v)
	c.mu.Lock()
	if _, ok := c.items[id]; !ok {
		c.order = append(c.order, id)
	}
	c.items[id] = &v
	c.mu.Unlock()
}

// LoadJSON inserts a JSON-encoded entity without notifications.
func (c *Collection[T]) LoadJSON(b []byte) error {
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	c.LoadRaw(v)
	return nil
}

// Page filters and paginates.
func (c *Collection[T]) Page(filter func(*T) bool, offset, limit int) ([]T, int) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]T, 0, limit)
	total := 0
	for _, id := range c.order {
		v := c.items[id]
		if filter != nil && !filter(v) {
			continue
		}
		if total >= offset && len(out) < limit {
			out = append(out, *v)
		}
		total++
	}
	return out, total
}

// Store is the root repository.
type Store struct {
	configVersion atomic.Uint64
	persister     Persister
	persistErr    atomic.Value

	StockPoints        *Collection[model.StockPoint]
	Carriers           *Collection[model.Carrier]
	Services           *Collection[model.CarrierService]
	Hubs               *Collection[model.Hub]
	Legs               *Collection[model.Leg]
	Routes             *Collection[model.Route]
	Modes              *Collection[model.DeliveryMode]
	Scenarios          *Collection[model.Scenario]
	RateCards          *Collection[model.RateCard]
	AdditionalServices *Collection[model.AdditionalService]
	StockViews         *Collection[model.StockView]
	Zones              *Collection[model.Zone]
	CarrierRoutes      *Collection[model.CarrierRoute]

	settingsMu sync.RWMutex
	settings   model.EngineSettings

	Stock *Stock
	Seed  int64
}

func New() *Store {
	s := &Store{settings: model.DefaultSettings()}
	s.StockPoints = newCollection(s, "stock_point", func(v *model.StockPoint) string { return v.ID })
	s.Carriers = newCollection(s, "carrier", func(v *model.Carrier) string { return v.ID })
	s.Services = newCollection(s, "service", func(v *model.CarrierService) string { return v.ID })
	s.Hubs = newCollection(s, "hub", func(v *model.Hub) string { return v.ID })
	s.Legs = newCollection(s, "leg", func(v *model.Leg) string { return v.ID })
	s.Routes = newCollection(s, "route", func(v *model.Route) string { return v.ID })
	s.Modes = newCollection(s, "delivery_mode", func(v *model.DeliveryMode) string { return v.ID })
	s.Scenarios = newCollection(s, "scenario", func(v *model.Scenario) string { return v.ID })
	s.RateCards = newCollection(s, "rate_card", func(v *model.RateCard) string { return v.ID })
	s.AdditionalServices = newCollection(s, "additional_service", func(v *model.AdditionalService) string { return v.ID })
	s.StockViews = newCollection(s, "stock_view", func(v *model.StockView) string { return v.ID })
	s.Zones = newCollection(s, "zone", func(v *model.Zone) string { return v.ID })
	s.CarrierRoutes = newCollection(s, "carrier_route", func(v *model.CarrierRoute) string { return v.ID })
	return s
}

func (s *Store) SetPersister(p Persister) { s.persister = p }
func (s *Store) Persister() Persister     { return s.persister }

// ConfigVersion changes whenever the network configuration changes.
func (s *Store) ConfigVersion() uint64 { return s.configVersion.Load() }

// BumpConfig forces cache invalidation.
func (s *Store) BumpConfig() { s.configVersion.Add(1) }

func (s *Store) changed(kind, id string, v any) {
	if kind != "scenario" {
		s.configVersion.Add(1)
	}
	if kind == "stock_point" {
		s.syncStockPoints()
	}
	if s.persister != nil {
		if err := s.persister.SaveEntity(kind, id, v); err != nil {
			s.persistErr.Store(err.Error())
		}
	}
}

func (s *Store) deleted(kind, id string) {
	if kind != "scenario" {
		s.configVersion.Add(1)
	}
	if kind == "stock_point" {
		s.syncStockPoints()
	}
	if s.persister != nil {
		if err := s.persister.DeleteEntity(kind, id); err != nil {
			s.persistErr.Store(err.Error())
		}
	}
}

// LastPersistError reports the last persistence failure, if any.
func (s *Store) LastPersistError() string {
	if v, ok := s.persistErr.Load().(string); ok {
		return v
	}
	return ""
}

// syncStockPoints keeps the stock matrix columns aligned with stock points.
func (s *Store) syncStockPoints() {
	if s.Stock == nil {
		return
	}
	pts := s.StockPoints.All()
	ids := make([]string, len(pts))
	safety := make([]int, len(pts))
	// keep existing matrix order first, then new points
	existing := s.Stock.PointIDs()
	byID := map[string]model.StockPoint{}
	for _, p := range pts {
		byID[p.ID] = p
	}
	ids = ids[:0]
	safety = safety[:0]
	seen := map[string]bool{}
	for _, id := range existing {
		if p, ok := byID[id]; ok {
			ids = append(ids, id)
			safety = append(safety, p.SafetyStock)
			seen[id] = true
		}
	}
	for _, p := range pts {
		if !seen[p.ID] {
			ids = append(ids, p.ID)
			safety = append(safety, p.SafetyStock)
		}
	}
	s.Stock.SetPoints(ids, safety)
}

// InitStock creates the stock matrix from the catalog and current points.
func (s *Store) InitStock(skus []model.SKU) {
	pts := s.StockPoints.All()
	ids := make([]string, len(pts))
	safety := make([]int, len(pts))
	for i, p := range pts {
		ids[i] = p.ID
		safety[i] = p.SafetyStock
	}
	s.Stock = NewStock(skus, ids, safety)
}

func (s *Store) Settings() model.EngineSettings {
	s.settingsMu.RLock()
	defer s.settingsMu.RUnlock()
	return s.settings
}

func (s *Store) SetSettings(v model.EngineSettings) {
	s.settingsMu.Lock()
	s.settings = v
	s.settingsMu.Unlock()
	s.configVersion.Add(1)
	if s.persister != nil {
		if err := s.persister.SaveEntity("settings", "engine", v); err != nil {
			s.persistErr.Store(err.Error())
		}
	}
}

// LoadSettingsRaw sets settings without persistence (bootstrap).
func (s *Store) LoadSettingsRaw(v model.EngineSettings) {
	s.settingsMu.Lock()
	s.settings = v
	s.settingsMu.Unlock()
}

// Counts summarises the repository for the dashboard.
type Counts struct {
	StockPoints        int            `json:"stockPoints"`
	StockPointsByType  map[string]int `json:"stockPointsByType"`
	SKUs               int            `json:"skus"`
	StockLines         int            `json:"stockLines"`
	Carriers           int            `json:"carriers"`
	Services           int            `json:"services"`
	Hubs               int            `json:"hubs"`
	Legs               int            `json:"legs"`
	Routes             int            `json:"routes"`
	DeliveryModes      int            `json:"deliveryModes"`
	Scenarios          int            `json:"scenarios"`
	RateCards          int            `json:"rateCards"`
	AdditionalServices int            `json:"additionalServices"`
	StockViews         int            `json:"stockViews"`
	Zones              int            `json:"zones"`
	CarrierRoutes      int            `json:"carrierRoutes"`
	ConfigVersion      uint64         `json:"configVersion"`
	StockVersion       uint64         `json:"stockVersion"`
}

func (s *Store) Counts() Counts {
	c := Counts{
		StockPoints: s.StockPoints.Len(), Carriers: s.Carriers.Len(), Services: s.Services.Len(),
		Hubs: s.Hubs.Len(), Legs: s.Legs.Len(), Routes: s.Routes.Len(), DeliveryModes: s.Modes.Len(),
		Scenarios: s.Scenarios.Len(), RateCards: s.RateCards.Len(), AdditionalServices: s.AdditionalServices.Len(), StockViews: s.StockViews.Len(), Zones: s.Zones.Len(), CarrierRoutes: s.CarrierRoutes.Len(), ConfigVersion: s.ConfigVersion(), StockPointsByType: map[string]int{},
	}
	for _, p := range s.StockPoints.All() {
		c.StockPointsByType[string(p.Type)]++
	}
	if s.Stock != nil {
		c.SKUs = len(s.Stock.SKUs())
		c.StockLines = s.Stock.LineCount()
		c.StockVersion = s.Stock.Version()
	}
	return c
}

// SearchSKUs returns catalog entries matching a prefix/substring.
func (s *Store) SearchSKUs(q string, offset, limit int) ([]model.SKU, int) {
	q = strings.ToLower(q)
	var out []model.SKU
	total := 0
	for _, k := range s.Stock.SKUs() {
		if q != "" && !strings.Contains(strings.ToLower(k.Code), q) && !strings.Contains(strings.ToLower(k.Name), q) && !strings.Contains(strings.ToLower(k.Category), q) {
			continue
		}
		if total >= offset && len(out) < limit {
			out = append(out, k)
		}
		total++
	}
	return out, total
}

// SortedIDs is a helper for deterministic output.
func SortedIDs[T any](items []T, id func(T) string) []string {
	out := make([]string, len(items))
	for i, v := range items {
		out[i] = id(v)
	}
	sort.Strings(out)
	return out
}

// UpdateSKU updates an article, invalidates caches and persists it.
func (s *Store) UpdateSKU(v model.SKU) error {
	if err := s.Stock.UpdateSKU(v); err != nil {
		return err
	}
	s.configVersion.Add(1)
	if s.persister != nil {
		if err := s.persister.SaveSKU(v); err != nil {
			s.persistErr.Store(err.Error())
		}
	}
	return nil
}
