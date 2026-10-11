// Package api exposes the REST API (/api/v1) of the delivery promise engine.
package api

import (
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/onestock/dp100ms/pkg/bench"
	"github.com/onestock/dp100ms/pkg/calendar"
	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/engine"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
	"github.com/onestock/dp100ms/pkg/pg"
	"github.com/onestock/dp100ms/pkg/store"
)

// Options configures the server.
type Options struct {
	AdminToken string
	// StaticDir serves the built frontend (container deployments).
	StaticDir string
	Platform  string
	// Reseed rebuilds the store with a new seed (admin action).
	Reseed func(seed int64, stockMode string) (*store.Store, error)
	// DB is the PostgreSQL persistence, when configured.
	DB *pg.DB
	// InitialRuns restores the benchmark history.
	InitialRuns []*bench.Run
}

// BenchRun is re-exported for bootstrap code.
type BenchRun = bench.Run

// Server holds the application state. The store can be swapped atomically
// by an admin reseed.
type Server struct {
	mu       sync.RWMutex
	st       *store.Store
	eng      *engine.Engine
	opts     Options
	mux      *http.ServeMux
	promises *bench.Recorder
	all      *bench.Recorder
	Bench    *bench.Manager
	started  time.Time
}

func New(s *store.Store, opts Options) *Server {
	srv := &Server{st: s, eng: engine.New(s), opts: opts, promises: bench.NewRecorder(20000), all: bench.NewRecorder(5000), started: time.Now()}
	srv.Bench = bench.NewManager(nil, func(p bench.BasketProfile) []bench.Basket { return bench.GenerateBaskets(srv.store(), p) }, bench.Hooks{
		CacheCounters: func() (uint64, uint64) {
			e := srv.engine()
			return e.RouteCacheHits.Load(), e.RouteCacheMisses.Load()
		},
		Persist: func(r *bench.Run) {
			if p := srv.store().Persister(); p != nil {
				_ = p.SaveEntity("benchmark", r.ID, r)
			}
		},
		Env: srv.environment,
	})
	srv.routes()
	srv.Bench.SetHandler(srv)
	for _, r := range opts.InitialRuns {
		srv.Bench.Load(r)
	}
	return srv
}

func (s *Server) store() *store.Store {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.st
}

func (s *Server) engine() *engine.Engine {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.eng
}

func (s *Server) environment() bench.Environment {
	h, _ := os.Hostname()
	return bench.Environment{System: bench.ReadSystem(), Hostname: h, Platform: s.opts.Platform}
}

// ServeHTTP adds CORS, metrics and panic recovery.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Expose-Headers", "X-Calculation-Time-Ms, X-Options-Count, X-Strategies")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	start := time.Now()
	sw := &statusWriter{ResponseWriter: w, status: 200}
	defer func() {
		if rec := recover(); rec != nil {
			writeProblem(sw, r, http.StatusInternalServerError, "internal", fmt.Sprint(rec), nil)
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			d := time.Since(start)
			failed := sw.status >= 500
			s.all.Observe(d, failed)
			if r.URL.Path == "/api/v1/delivery-promises" && r.Method == http.MethodPost {
				s.promises.Observe(d, sw.status >= 400)
			}
		}
	}()
	s.mux.ServeHTTP(sw, r)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// admin wraps write handlers with bearer token authentication.
func (s *Server) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if s.opts.AdminToken == "" || subtle.ConstantTimeCompare([]byte(tok), []byte(s.opts.AdminToken)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="admin"`)
			writeProblem(w, r, http.StatusUnauthorized, "unauthorized", "a valid admin bearer token is required", nil)
			return
		}
		h(w, r)
	}
}

func (s *Server) routes() {
	m := http.NewServeMux()
	s.mux = m
	m.HandleFunc("GET /api/v1/health", s.health)
	m.HandleFunc("GET /api/v1/openapi.json", s.openapi)
	m.HandleFunc("GET /api/v1/auth/check", s.admin(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) }))
	m.HandleFunc("POST /api/v1/delivery-promises", s.promise)
	m.HandleFunc("POST /api/v1/simulations", s.simulate)
	m.HandleFunc("GET /api/v1/dashboard", s.dashboard)
	m.HandleFunc("GET /api/v1/metrics", s.metrics)
	m.HandleFunc("POST /api/v1/metrics/reset", s.admin(s.metricsReset))

	registerCRUD(s, "stock-points", "stock point", func(st *store.Store) *store.Collection[model.StockPoint] { return st.StockPoints }, validateStockPoint,
		func(r *http.Request) func(*model.StockPoint) bool {
			q, typ, city := r.URL.Query().Get("q"), r.URL.Query().Get("type"), r.URL.Query().Get("city")
			return func(v *model.StockPoint) bool {
				return (typ == "" || string(v.Type) == typ) && (city == "" || strings.EqualFold(v.Address.City, city)) &&
					(q == "" || contains(v.ID, q) || contains(v.Name, q) || contains(v.Address.City, q) || strings.HasPrefix(v.Address.PostalCode, q))
			}
		})
	registerCRUD(s, "carriers", "carrier", func(st *store.Store) *store.Collection[model.Carrier] { return st.Carriers }, validateCarrier,
		func(r *http.Request) func(*model.Carrier) bool {
			q := r.URL.Query().Get("q")
			return func(v *model.Carrier) bool { return q == "" || contains(v.ID, q) || contains(v.Name, q) }
		})
	registerCRUD(s, "services", "service", func(st *store.Store) *store.Collection[model.CarrierService] { return st.Services }, validateService,
		func(r *http.Request) func(*model.CarrierService) bool {
			q, carrier, kind := r.URL.Query().Get("q"), r.URL.Query().Get("carrierId"), r.URL.Query().Get("kind")
			return func(v *model.CarrierService) bool {
				return (carrier == "" || v.CarrierID == carrier) && (kind == "" || string(v.Kind) == kind) && (q == "" || contains(v.ID, q) || contains(v.Name, q))
			}
		})
	registerCRUD(s, "hubs", "hub", func(st *store.Store) *store.Collection[model.Hub] { return st.Hubs }, validateHub,
		func(r *http.Request) func(*model.Hub) bool {
			q, kind := r.URL.Query().Get("q"), r.URL.Query().Get("kind")
			return func(v *model.Hub) bool {
				return (kind == "" || string(v.Kind) == kind) && (q == "" || contains(v.ID, q) || contains(v.Name, q) || contains(v.City, q))
			}
		})
	registerCRUD(s, "legs", "leg", func(st *store.Store) *store.Collection[model.Leg] { return st.Legs }, validateLeg,
		func(r *http.Request) func(*model.Leg) bool {
			qv := r.URL.Query()
			from, to, carrier, svc, node := qv.Get("from"), qv.Get("to"), qv.Get("carrierId"), qv.Get("serviceId"), qv.Get("node")
			return func(v *model.Leg) bool {
				return (from == "" || v.From == from) && (to == "" || v.To == to) && (carrier == "" || v.CarrierID == carrier) &&
					(svc == "" || v.ServiceID == svc) && (node == "" || v.From == node || v.To == node)
			}
		})
	registerCRUD(s, "routes", "route", func(st *store.Store) *store.Collection[model.Route] { return st.Routes },
		func(st *store.Store, v *model.Route) []fe {
			errs := checkID(v.ID)
			if v.Name == "" {
				errs = append(errs, fe{Field: "name", Message: "required"})
			}
			for _, e := range network.ValidateRoute(st, *v) {
				errs = append(errs, fe{Field: "legIds", Message: e})
			}
			return append(errs, checkModes(st, "modes", v.Modes)...)
		},
		func(r *http.Request) func(*model.Route) bool {
			q := r.URL.Query().Get("q")
			return func(v *model.Route) bool { return q == "" || contains(v.ID, q) || contains(v.Name, q) }
		})
	registerCRUD(s, "delivery-modes", "delivery mode", func(st *store.Store) *store.Collection[model.DeliveryMode] { return st.Modes }, validateMode, nil)
	registerCRUD(s, "scenarios", "scenario", func(st *store.Store) *store.Collection[model.Scenario] { return st.Scenarios }, validateScenario,
		func(r *http.Request) func(*model.Scenario) bool {
			q := r.URL.Query().Get("q")
			return func(v *model.Scenario) bool { return q == "" || contains(v.Name, q) || contains(v.ID, q) }
		})
	m.HandleFunc("POST /api/v1/scenarios/{id}/run", s.runScenario)
	registerCRUD(s, "rate-cards", "rate card", func(st *store.Store) *store.Collection[model.RateCard] { return st.RateCards }, validateRateCard,
		func(r *http.Request) func(*model.RateCard) bool {
			q, scope, carrier := r.URL.Query().Get("q"), r.URL.Query().Get("scope"), r.URL.Query().Get("carrierId")
			return func(v *model.RateCard) bool {
				return (scope == "" || string(v.Scope) == scope) && (carrier == "" || v.CarrierID == carrier) && (q == "" || contains(v.ID, q) || contains(v.Name, q))
			}
		})
	registerCRUD(s, "additional-services", "additional service", func(st *store.Store) *store.Collection[model.AdditionalService] { return st.AdditionalServices }, validateAdditionalService, nil)
	registerCRUD(s, "stock-views", "stock view", func(st *store.Store) *store.Collection[model.StockView] { return st.StockViews }, validateStockView, nil)
	registerCRUD(s, "zones", "zone", func(st *store.Store) *store.Collection[model.Zone] { return st.Zones }, validateZone,
		func(r *http.Request) func(*model.Zone) bool {
			q := r.URL.Query().Get("q")
			return func(v *model.Zone) bool { return q == "" || contains(v.ID, q) || contains(v.Name, q) }
		})
	registerCRUD(s, "carrier-routes", "carrier route", func(st *store.Store) *store.Collection[model.CarrierRoute] { return st.CarrierRoutes }, validateCarrierRoute,
		func(r *http.Request) func(*model.CarrierRoute) bool {
			q := r.URL.Query()
			carrier, svc, origin, dest, text := q.Get("carrierId"), q.Get("serviceId"), q.Get("originZoneId"), q.Get("destinationZoneId"), q.Get("q")
			return func(v *model.CarrierRoute) bool {
				return (carrier == "" || v.CarrierID == carrier) && (svc == "" || v.ServiceID == svc) &&
					(origin == "" || v.OriginZoneID == origin) && (dest == "" || v.DestinationZoneID == dest) &&
					(text == "" || contains(v.ID, text) || contains(v.Name, text))
			}
		})
	m.HandleFunc("POST /api/v1/rate-cards/quote", s.quoteRateCard)
	m.HandleFunc("POST /api/v1/rate-cards/{id}/quote", s.quoteRateCard)
	m.HandleFunc("GET /api/v1/pricing/fields", s.pricingFields)
	m.HandleFunc("POST /api/v1/carriers/{id}/schedule-preview", s.schedulePreview)
	m.HandleFunc("GET /api/v1/stock-views/{id}/preview", s.previewStockView)
	m.HandleFunc("PUT /api/v1/skus/{sku}", s.admin(s.putSKU))

	m.HandleFunc("GET /api/v1/stock-points/{id}/stock", s.pointStock)
	m.HandleFunc("GET /api/v1/stock-points/{id}/summary", s.pointSummary)
	m.HandleFunc("GET /api/v1/stock-points/{id}/connections", s.pointConnections)

	m.HandleFunc("GET /api/v1/stock", s.listStock)
	m.HandleFunc("GET /api/v1/stock/{stockPointId}/{sku}", s.getStock)
	m.HandleFunc("PUT /api/v1/stock/{stockPointId}/{sku}", s.admin(s.putStock))
	m.HandleFunc("PATCH /api/v1/stock", s.admin(s.patchStock))
	m.HandleFunc("POST /api/v1/stock/import", s.admin(s.importStock))
	m.HandleFunc("GET /api/v1/skus", s.listSKUs)
	m.HandleFunc("GET /api/v1/skus/{sku}", s.getSKU)
	m.HandleFunc("GET /api/v1/skus/{sku}/availability", s.skuAvailability)

	m.HandleFunc("GET /api/v1/network/graph", s.graph)
	m.HandleFunc("GET /api/v1/network/routes", s.compiledRoutes)
	m.HandleFunc("GET /api/v1/calendar/holidays", s.holidays)
	m.HandleFunc("GET /api/v1/settings", s.getSettings)
	m.HandleFunc("PUT /api/v1/settings", s.admin(s.putSettings))
	m.HandleFunc("POST /api/v1/admin/reseed", s.admin(s.reseed))
	m.HandleFunc("GET /api/v1/admin/database", s.admin(s.databaseStatus))

	m.HandleFunc("GET /api/v1/benchmarks", s.listBenchmarks)
	m.HandleFunc("GET /api/v1/benchmarks/presets", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, bench.Presets) })
	m.HandleFunc("GET /api/v1/benchmarks/baskets", s.benchBaskets)
	m.HandleFunc("POST /api/v1/benchmarks", s.admin(s.startBenchmark))
	m.HandleFunc("POST /api/v1/benchmarks/import", s.admin(s.importBenchmark))
	m.HandleFunc("GET /api/v1/benchmarks/{id}", s.getBenchmark)
	m.HandleFunc("POST /api/v1/benchmarks/{id}/stop", s.admin(s.stopBenchmark))
	m.HandleFunc("DELETE /api/v1/benchmarks/{id}", s.admin(s.deleteBenchmark))

	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeProblem(w, r, http.StatusNotFound, "not-found", "no route for "+r.Method+" "+r.URL.Path, nil)
	})
	if s.opts.StaticDir != "" {
		m.Handle("/", spaHandler(s.opts.StaticDir))
	}
}

// spaHandler serves static files and falls back to index.html.
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := dir + r.URL.Path
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			if r.URL.Path != "/" {
				http.ServeFile(w, r, dir+"/index.html")
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fs.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Generic CRUD

func registerCRUD[T any](s *Server, path, label string, col func(*store.Store) *store.Collection[T], validate func(*store.Store, *T) []fe, filter func(*http.Request) func(*T) bool) {
	base := "/api/v1/" + path
	s.mux.HandleFunc("GET "+base, func(w http.ResponseWriter, r *http.Request) {
		page, size := pageParams(r)
		var f func(*T) bool
		if filter != nil {
			f = filter(r)
		}
		items, total := col(s.store()).Page(f, (page-1)*size, size)
		writeJSON(w, 200, Page[T]{Items: items, Page: page, PageSize: size, Total: total})
	})
	s.mux.HandleFunc("GET "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, ok := col(s.store()).Get(r.PathValue("id"))
		if !ok {
			notFound(w, r, label)
			return
		}
		writeJSON(w, 200, v)
	})
	s.mux.HandleFunc("POST "+base, s.admin(func(w http.ResponseWriter, r *http.Request) {
		var v T
		if !decode(w, r, &v) {
			return
		}
		st := s.store()
		if errs := validate(st, &v); len(errs) > 0 {
			validationFailed(w, r, errs)
			return
		}
		if err := col(st).Create(v); err != nil {
			storeError(w, r, err, label)
			return
		}
		writeJSON(w, http.StatusCreated, v)
	}))
	s.mux.HandleFunc("PUT "+base+"/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		var v T
		if !decode(w, r, &v) {
			return
		}
		st := s.store()
		if errs := validate(st, &v); len(errs) > 0 {
			validationFailed(w, r, errs)
			return
		}
		if err := col(st).Update(r.PathValue("id"), v); err != nil {
			if err.Error() == "id mismatch" {
				validationFailed(w, r, []fe{{Field: "id", Message: "must match the URL"}})
				return
			}
			storeError(w, r, err, label)
			return
		}
		writeJSON(w, 200, v)
	}))
	s.mux.HandleFunc("DELETE "+base+"/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		if err := col(s.store()).Delete(r.PathValue("id")); err != nil {
			storeError(w, r, err, label)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

// ---------------------------------------------------------------------------
// Handlers

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	st := s.store()
	writeJSON(w, 200, map[string]any{
		"status": "ok", "seed": st.Seed, "uptimeSec": time.Since(s.started).Seconds(), "platform": s.opts.Platform,
		"persistence": st.Persister() != nil, "persistError": st.LastPersistError(), "stockLines": st.Stock.LineCount(),
	})
}

func (s *Server) promise(w http.ResponseWriter, r *http.Request) {
	var req model.PromiseRequest
	if !decode(w, r, &req) {
		return
	}
	resp, err := s.engine().Promise(&req)
	if err != nil {
		var ve *engine.ValidationError
		if errors.As(err, &ve) {
			validationFailed(w, r, ve.Fields)
			return
		}
		writeProblem(w, r, http.StatusInternalServerError, "internal", err.Error(), nil)
		return
	}
	h := w.Header()
	h.Set("X-Calculation-Time-Ms", strconv.FormatFloat(resp.CalculationTimeMs, 'f', 3, 64))
	h.Set("X-Options-Count", strconv.Itoa(len(resp.Options)))
	strategies := make([]string, 0, 3)
	for _, o := range resp.Options {
		found := false
		for _, s := range strategies {
			if s == o.Strategy {
				found = true
			}
		}
		if !found {
			strategies = append(strategies, o.Strategy)
		}
	}
	h.Set("X-Strategies", strings.Join(strategies, ","))
	writeJSON(w, 200, resp)
}

// SimulationResponse adds context for the web simulator.
type SimulationResponse struct {
	*model.PromiseResponse
	Request      model.PromiseRequest   `json:"request"`
	Nodes        map[string]nodeSummary `json:"nodes"`
	Stock        []skuStock             `json:"stock"`
	ServerTimeMs float64                `json:"serverTimeMs"`
}

type nodeSummary struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Kind string  `json:"kind"`
	City string  `json:"city"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

type skuStock struct {
	SKU             string `json:"sku"`
	Requested       int    `json:"requested"`
	TotalPromisable int    `json:"totalPromisable"`
	Points          int    `json:"pointsWithStock"`
}

func (s *Server) simulate(w http.ResponseWriter, r *http.Request) {
	t0 := time.Now()
	var req model.PromiseRequest
	if !decode(w, r, &req) {
		return
	}
	s.runSimulation(w, r, req, t0)
}

func (s *Server) runSimulation(w http.ResponseWriter, r *http.Request, req model.PromiseRequest, t0 time.Time) {
	e := s.engine()
	resp, err := e.Promise(&req)
	if err != nil {
		var ve *engine.ValidationError
		if errors.As(err, &ve) {
			validationFailed(w, r, ve.Fields)
			return
		}
		writeProblem(w, r, http.StatusInternalServerError, "internal", err.Error(), nil)
		return
	}
	net := e.Network()
	out := SimulationResponse{PromiseResponse: resp, Request: req, Nodes: map[string]nodeSummary{}}
	addNode := func(id string) {
		if _, ok := out.Nodes[id]; ok || id == model.CustomerNode {
			return
		}
		if n := net.Nodes[id]; n != nil {
			ns := nodeSummary{ID: n.ID, Name: n.Name, Kind: string(n.Kind), Lat: n.Lat, Lon: n.Lon}
			if n.StockPoint != nil {
				ns.City = n.StockPoint.Address.City
			} else if n.Hub != nil {
				ns.City = n.Hub.City
			}
			out.Nodes[id] = ns
		}
	}
	for _, o := range resp.Options {
		for _, sh := range o.Shipments {
			for _, l := range sh.Legs {
				addNode(l.From)
				addNode(l.To)
			}
		}
		for _, a := range o.Allocations {
			addNode(a.StockPointID)
		}
	}
	st := s.store()
	for _, it := range req.Items {
		k, ok := st.Stock.SKUIndex(it.SKU)
		if !ok {
			continue
		}
		sn := st.Stock.Snapshot([]int32{k})
		ss := skuStock{SKU: it.SKU, Requested: it.Quantity}
		for p := 0; p < sn.NPoints; p++ {
			if q := sn.Q(0, p); q > 0 {
				ss.TotalPromisable += int(q)
				ss.Points++
			}
		}
		out.Stock = append(out.Stock, ss)
	}
	out.ServerTimeMs = float64(time.Since(t0).Microseconds()) / 1000
	writeJSON(w, 200, out)
}

func (s *Server) runScenario(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.store().Scenarios.Get(r.PathValue("id"))
	if !ok {
		notFound(w, r, "scenario")
		return
	}
	s.runSimulation(w, r, sc.Request, time.Now())
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	st := s.store()
	e := s.engine()
	hits, misses := e.RouteCacheHits.Load(), e.RouteCacheMisses.Load()
	rate := 0.0
	if hits+misses > 0 {
		rate = float64(hits) / float64(hits+misses)
	}
	var last *bench.Run
	for _, run := range s.Bench.List() {
		if run.Summary != nil {
			last = run
			break
		}
	}
	writeJSON(w, 200, map[string]any{
		"counts": st.Counts(), "promiseLatency": s.promises.Snapshot(), "apiLatency": s.all.Snapshot(),
		"routeCacheHitRate": rate, "system": bench.ReadSystem(), "lastBenchmark": last, "seed": st.Seed, "platform": s.opts.Platform,
	})
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"promise": s.promises.Snapshot(), "api": s.all.Snapshot(), "system": bench.ReadSystem()})
}

func (s *Server) metricsReset(w http.ResponseWriter, r *http.Request) {
	s.promises.Reset()
	s.all.Reset()
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Stock

func stockErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrUnknownStockPoint):
		notFound(w, r, "stock point")
	case errors.Is(err, store.ErrUnknownSKU):
		notFound(w, r, "sku")
	default:
		writeProblem(w, r, 500, "internal", err.Error(), nil)
	}
}

func (s *Server) pointStock(w http.ResponseWriter, r *http.Request) {
	page, size := pageParams(r)
	q := store.StockQuery{StockPointID: r.PathValue("id"), SKU: r.URL.Query().Get("sku"), OnlyListed: r.URL.Query().Get("all") != "true",
		OnlyAvailable: r.URL.Query().Get("onlyAvailable") == "true", Offset: (page - 1) * size, Limit: size}
	items, total, err := s.store().Stock.Query(q)
	if err != nil {
		stockErr(w, r, err)
		return
	}
	writeJSON(w, 200, Page[model.StockLine]{Items: items, Page: page, PageSize: size, Total: total})
}

func (s *Server) pointSummary(w http.ResponseWriter, r *http.Request) {
	sum, err := s.store().Stock.Summary(r.PathValue("id"))
	if err != nil {
		stockErr(w, r, err)
		return
	}
	writeJSON(w, 200, sum)
}

func (s *Server) pointConnections(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st := s.store()
	if _, ok := st.StockPoints.Get(id); !ok {
		if _, ok := st.Hubs.Get(id); !ok {
			notFound(w, r, "node")
			return
		}
	}
	var out, in []model.Leg
	for _, l := range st.Legs.All() {
		if l.From == id {
			out = append(out, l)
		}
		if l.To == id {
			in = append(in, l)
		}
	}
	writeJSON(w, 200, map[string]any{"outgoing": nz(out), "incoming": nz(in)})
}

func nz[T any](x []T) []T {
	if x == nil {
		return []T{}
	}
	return x
}

func (s *Server) listStock(w http.ResponseWriter, r *http.Request) {
	page, size := pageParams(r)
	q := store.StockQuery{StockPointID: r.URL.Query().Get("stockPointId"), SKU: r.URL.Query().Get("sku"), OnlyListed: true,
		OnlyAvailable: r.URL.Query().Get("onlyAvailable") == "true", Offset: (page - 1) * size, Limit: size}
	items, total, err := s.store().Stock.Query(q)
	if err != nil {
		stockErr(w, r, err)
		return
	}
	writeJSON(w, 200, Page[model.StockLine]{Items: items, Page: page, PageSize: size, Total: total})
}

func (s *Server) getStock(w http.ResponseWriter, r *http.Request) {
	l, err := s.store().Stock.Line(r.PathValue("stockPointId"), r.PathValue("sku"))
	if err != nil {
		stockErr(w, r, err)
		return
	}
	writeJSON(w, 200, l)
}

func (s *Server) persistLines(st *store.Store, keys [][2]string) {
	p := st.Persister()
	if p == nil {
		return
	}
	lines := make([]model.StockLine, 0, len(keys))
	for _, k := range keys {
		if l, err := st.Stock.Line(k[0], k[1]); err == nil {
			lines = append(lines, l)
		}
	}
	_ = p.SaveStockLines(lines)
}

func (s *Server) putStock(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Physical int   `json:"physical"`
		Reserved int   `json:"reserved"`
		Listed   *bool `json:"listed,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Physical < 0 || body.Reserved < 0 {
		validationFailed(w, r, []fe{{Field: "physical/reserved", Message: "must be >= 0"}})
		return
	}
	listed := true
	if body.Listed != nil {
		listed = *body.Listed
	}
	st := s.store()
	pid, sku := r.PathValue("stockPointId"), r.PathValue("sku")
	if err := st.Stock.Set(pid, sku, body.Physical, body.Reserved, listed); err != nil {
		stockErr(w, r, err)
		return
	}
	s.persistLines(st, [][2]string{{pid, sku}})
	l, _ := st.Stock.Line(pid, sku)
	writeJSON(w, 200, l)
}

type stockBatchResult struct {
	Applied      int                      `json:"applied"`
	Rejected     int                      `json:"rejected"`
	Errors       []store.StockUpdateError `json:"errors"`
	StockVersion uint64                   `json:"stockVersion"`
	DurationMs   float64                  `json:"durationMs"`
}

func (s *Server) applyBatch(w http.ResponseWriter, ups []store.StockUpdate, t0 time.Time) {
	st := s.store()
	applied, errs := st.Stock.Apply(ups)
	if st.Persister() != nil && applied > 0 {
		keys := make([][2]string, 0, len(ups))
		for _, u := range ups {
			keys = append(keys, [2]string{u.StockPointID, u.SKU})
		}
		s.persistLines(st, keys)
	}
	if len(errs) > 100 {
		errs = errs[:100]
	}
	writeJSON(w, 200, stockBatchResult{Applied: applied, Rejected: len(ups) - applied, Errors: nz(errs), StockVersion: st.Stock.Version(),
		DurationMs: float64(time.Since(t0).Microseconds()) / 1000})
}

func (s *Server) patchStock(w http.ResponseWriter, r *http.Request) {
	t0 := time.Now()
	var ups []store.StockUpdate
	if !decode(w, r, &ups) {
		return
	}
	s.applyBatch(w, ups, t0)
}

// importStock accepts CSV (stockPointId,sku,physical,reserved) or a JSON
// array of updates. Up to 2 million lines per call.
func (s *Server) importStock(w http.ResponseWriter, r *http.Request) {
	t0 := time.Now()
	r.Body = http.MaxBytesReader(w, r.Body, 128<<20)
	ct := r.Header.Get("Content-Type")
	var ups []store.StockUpdate
	if strings.HasPrefix(ct, "text/csv") || strings.HasPrefix(ct, "text/plain") {
		cr := csv.NewReader(r.Body)
		cr.ReuseRecord = true
		cr.FieldsPerRecord = -1
		line := 0
		for {
			rec, err := cr.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				badRequest(w, r, fmt.Sprintf("csv line %d: %v", line+1, err))
				return
			}
			line++
			if line == 1 && len(rec) > 0 && strings.EqualFold(strings.TrimSpace(rec[0]), "stockPointId") {
				continue
			}
			if len(rec) < 3 {
				badRequest(w, r, fmt.Sprintf("csv line %d: expected stockPointId,sku,physical[,reserved]", line))
				return
			}
			phys, err := strconv.Atoi(strings.TrimSpace(rec[2]))
			if err != nil {
				badRequest(w, r, fmt.Sprintf("csv line %d: physical must be an integer", line))
				return
			}
			u := store.StockUpdate{StockPointID: strings.TrimSpace(rec[0]), SKU: strings.TrimSpace(rec[1]), Physical: &phys}
			if len(rec) > 3 && strings.TrimSpace(rec[3]) != "" {
				res, err := strconv.Atoi(strings.TrimSpace(rec[3]))
				if err != nil {
					badRequest(w, r, fmt.Sprintf("csv line %d: reserved must be an integer", line))
					return
				}
				u.Reserved = &res
			}
			ups = append(ups, u)
			if len(ups) > 2_000_000 {
				badRequest(w, r, "at most 2,000,000 lines per import")
				return
			}
		}
	} else {
		if err := json.NewDecoder(r.Body).Decode(&ups); err != nil {
			badRequest(w, r, "body must be a JSON array of stock updates or text/csv: "+err.Error())
			return
		}
	}
	s.applyBatch(w, ups, t0)
}

func (s *Server) listSKUs(w http.ResponseWriter, r *http.Request) {
	page, size := pageParams(r)
	items, total := s.store().SearchSKUs(r.URL.Query().Get("q"), (page-1)*size, size)
	writeJSON(w, 200, Page[model.SKU]{Items: nz(items), Page: page, PageSize: size, Total: total})
}

func (s *Server) getSKU(w http.ResponseWriter, r *http.Request) {
	st := s.store()
	k, ok := st.Stock.SKUIndex(r.PathValue("sku"))
	if !ok {
		notFound(w, r, "sku")
		return
	}
	writeJSON(w, 200, st.Stock.SKU(k))
}

func (s *Server) skuAvailability(w http.ResponseWriter, r *http.Request) {
	st := s.store()
	k, ok := st.Stock.SKUIndex(r.PathValue("sku"))
	if !ok {
		notFound(w, r, "sku")
		return
	}
	lines, _, _ := st.Stock.Query(store.StockQuery{SKU: st.Stock.SKU(k).Code, OnlyListed: true, Limit: 100000})
	sort.Slice(lines, func(i, j int) bool { return lines[i].Promisable > lines[j].Promisable })
	total := 0
	for _, l := range lines {
		total += l.Promisable
	}
	writeJSON(w, 200, map[string]any{"sku": st.Stock.SKU(k), "totalPromisable": total, "lines": nz(lines)})
}

// ---------------------------------------------------------------------------
// Network

type graphNode struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Kind          string  `json:"kind"`
	City          string  `json:"city"`
	Lat           float64 `json:"lat"`
	Lon           float64 `json:"lon"`
	Active        bool    `json:"active"`
	IsHub         bool    `json:"isHub"`
	Consolidation bool    `json:"consolidation"`
}

func (s *Server) graph(w http.ResponseWriter, r *http.Request) {
	st := s.store()
	nodes := []graphNode{}
	hubs := map[string]model.Hub{}
	for _, h := range st.Hubs.All() {
		hubs[h.ID] = h
	}
	for _, p := range st.StockPoints.All() {
		h, isHub := hubs[p.ID]
		nodes = append(nodes, graphNode{ID: p.ID, Name: p.Name, Kind: string(p.Type), City: p.Address.City, Lat: p.Lat, Lon: p.Lon, Active: p.Active, IsHub: isHub, Consolidation: isHub && h.ConsolidationEnabled})
	}
	for _, h := range st.Hubs.All() {
		if h.StockPointID != "" {
			continue
		}
		nodes = append(nodes, graphNode{ID: h.ID, Name: h.Name, Kind: "HUB", City: h.City, Lat: h.Lat, Lon: h.Lon, Active: h.Active, IsHub: true, Consolidation: h.ConsolidationEnabled})
	}
	// legs of the compiled network: generated from the carrier routes
	// (generated = true) or stored; stored legs replaced by routes or
	// inactive are listed with inUse = false
	net := s.engine().Network()
	legs := []graphLeg{}
	used := map[string]bool{}
	for _, l := range net.Legs {
		gl := graphLeg{Leg: *l.Leg, Generated: l.FromRoutes, InUse: true, CarrierRouteIDs: nz(l.RouteIDs())}
		if p := l.DefaultPlan; p != nil && len(gl.Departures) == 0 {
			gl.Departures = p.Departures
		}
		used[l.ID] = true
		legs = append(legs, gl)
	}
	for _, l := range st.Legs.All() {
		if !used[l.ID] {
			legs = append(legs, graphLeg{Leg: l, CarrierRouteIDs: []string{}})
		}
	}
	writeJSON(w, 200, map[string]any{"nodes": nodes, "legs": legs, "routes": st.Routes.All()})
}

type graphLeg struct {
	model.Leg
	// Generated: derived from carrier routes (configured in the carrier
	// screens), not a stored leg.
	Generated       bool     `json:"generated"`
	InUse           bool     `json:"inUse"`
	CarrierRouteIDs []string `json:"carrierRouteIds"`
}

type compiledPath struct {
	Origin   string   `json:"origin"`
	Legs     []string `json:"legs"`
	Nodes    []string `json:"nodes"`
	Carriers []string `json:"carriers"`
	Hubs     []string `json:"hubs"`
	RouteID  string   `json:"routeId,omitempty"`
}

func (s *Server) compiledRoutes(w http.ResponseWriter, r *http.Request) {
	pc := r.URL.Query().Get("postalCode")
	mode := r.URL.Query().Get("mode")
	origin := r.URL.Query().Get("origin")
	dept, err := network.Dept(pc)
	if err != nil {
		validationFailed(w, r, []fe{{Field: "postalCode", Message: err.Error()}})
		return
	}
	net := s.engine().Network()
	if _, ok := net.Modes[mode]; !ok {
		validationFailed(w, r, []fe{{Field: "mode", Message: "unknown or inactive delivery mode"}})
		return
	}
	dr, _ := net.Routes(dept, mode)
	out := []compiledPath{}
	origins := make([]string, 0, len(dr.ByOrigin))
	for o := range dr.ByOrigin {
		origins = append(origins, o)
	}
	sort.Strings(origins)
	for _, o := range origins {
		if origin != "" && o != origin {
			continue
		}
		for _, p := range dr.ByOrigin[o] {
			cp := compiledPath{Origin: o, Hubs: nz(p.Hubs), RouteID: p.RouteID, Nodes: []string{o}}
			for _, l := range p.Legs {
				cp.Legs = append(cp.Legs, l.ID)
				cp.Nodes = append(cp.Nodes, l.To)
				cp.Carriers = append(cp.Carriers, l.Carrier.ID)
			}
			out = append(out, cp)
		}
	}
	writeJSON(w, 200, map[string]any{"department": dept, "mode": mode, "count": len(out), "paths": out})
}

func (s *Server) holidays(w http.ResponseWriter, r *http.Request) {
	y, _ := strconv.Atoi(r.URL.Query().Get("year"))
	if y < 2000 || y > 2100 {
		y = time.Now().In(calendar.Paris()).Year()
	}
	writeJSON(w, 200, map[string]any{"year": y, "holidays": calendar.HolidayList(y)})
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.store().Settings())
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var v model.EngineSettings
	if !decode(w, r, &v) {
		return
	}
	var errs []fe
	if v.BeamWidth < 1 || v.BeamWidth > 64 {
		errs = append(errs, fe{Field: "beamWidth", Message: "must be between 1 and 64"})
	}
	if v.MaxAllocations < 1 || v.MaxAllocations > 100 {
		errs = append(errs, fe{Field: "maxAllocations", Message: "must be between 1 and 100"})
	}
	if v.MaxLegs < 1 || v.MaxLegs > 5 {
		errs = append(errs, fe{Field: "maxLegs", Message: "must be between 1 and 5"})
	}
	if v.MaxHubsPerPlan < 1 || v.MaxHubsPerPlan > 20 {
		errs = append(errs, fe{Field: "maxHubsPerPlan", Message: "must be between 1 and 20"})
	}
	if v.MaxCandidates == 0 {
		v.MaxCandidates = 48
	}
	if v.MaxCandidates < 1 || v.MaxCandidates > 500 {
		errs = append(errs, fe{Field: "maxCandidates", Message: "must be between 1 and 500"})
	}
	wt := v.Weights
	if wt.DeliveryTime < 0 || wt.Packages < 0 || wt.Cost < 0 || wt.Legs < 0 || wt.Sources < 0 {
		errs = append(errs, fe{Field: "weights", Message: "weights must be >= 0"})
	}
	if v.Timezone == "" {
		v.Timezone = "Europe/Paris"
	}
	if _, err := time.LoadLocation(v.Timezone); err != nil {
		errs = append(errs, fe{Field: "timezone", Message: "unknown IANA time zone"})
	}
	if len(errs) > 0 {
		validationFailed(w, r, errs)
		return
	}
	s.store().SetSettings(v)
	writeJSON(w, 200, v)
}

func (s *Server) reseed(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seed         int64  `json:"seed"`
		StockStorage string `json:"stockStorage,omitempty"` // delta | full
	}
	if !decode(w, r, &body) {
		return
	}
	t0 := time.Now()
	var st *store.Store
	var err error
	if s.opts.Reseed != nil {
		st, err = s.opts.Reseed(body.Seed, body.StockStorage)
	} else {
		cfg := datagen.DefaultConfig()
		cfg.Seed = body.Seed
		st = datagen.Generate(cfg)
	}
	if err != nil {
		writeProblem(w, r, 500, "internal", err.Error(), nil)
		return
	}
	s.mu.Lock()
	s.st = st
	s.eng = engine.New(st)
	s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"seed": body.Seed, "counts": st.Counts(), "durationMs": time.Since(t0).Milliseconds()})
}

// ---------------------------------------------------------------------------
// Benchmarks

func (s *Server) listBenchmarks(w http.ResponseWriter, r *http.Request) {
	runs := s.Bench.List()
	// list view without the time series
	type light struct {
		bench.Run
		Series []bench.Point `json:"series,omitempty"`
	}
	out := make([]light, len(runs))
	for i, run := range runs {
		out[i] = light{Run: *run}
		out[i].Series = nil
	}
	writeJSON(w, 200, map[string]any{"items": out, "total": len(out)})
}

func (s *Server) getBenchmark(w http.ResponseWriter, r *http.Request) {
	run, ok := s.Bench.Get(r.PathValue("id"))
	if !ok {
		notFound(w, r, "benchmark")
		return
	}
	writeJSON(w, 200, run)
}

func (s *Server) startBenchmark(w http.ResponseWriter, r *http.Request) {
	var cfg bench.RunConfig
	if !decode(w, r, &cfg) {
		return
	}
	wait := r.URL.Query().Get("wait") == "true" || os.Getenv("VERCEL") != ""
	run, err := s.Bench.Start(cfg, wait)
	if err != nil {
		writeProblem(w, r, http.StatusConflict, "conflict", err.Error(), nil)
		return
	}
	status := http.StatusAccepted
	if wait {
		status = http.StatusOK
	}
	writeJSON(w, status, run)
}

func (s *Server) stopBenchmark(w http.ResponseWriter, r *http.Request) {
	if !s.Bench.Stop(r.PathValue("id")) {
		notFound(w, r, "running benchmark")
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) deleteBenchmark(w http.ResponseWriter, r *http.Request) {
	if !s.Bench.Delete(r.PathValue("id")) {
		notFound(w, r, "finished benchmark")
		return
	}
	if p := s.store().Persister(); p != nil {
		_ = p.DeleteEntity("benchmark", r.PathValue("id"))
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) importBenchmark(w http.ResponseWriter, r *http.Request) {
	var run bench.Run
	if !decode(w, r, &run) {
		return
	}
	if run.Summary == nil {
		validationFailed(w, r, []fe{{Field: "summary", Message: "required"}})
		return
	}
	if run.Source == "" {
		run.Source = "k6"
	}
	if run.Status == "" {
		run.Status = "completed"
	}
	if run.StartedAt.IsZero() {
		run.StartedAt = time.Now()
	}
	if run.Series == nil {
		run.Series = []bench.Point{}
	}
	s.Bench.Add(&run)
	writeJSON(w, http.StatusCreated, run)
}

func (s *Server) benchBaskets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	atoi := func(k string, d int) int {
		if v, err := strconv.Atoi(q.Get(k)); err == nil {
			return v
		}
		return d
	}
	atof := func(k string, d float64) float64 {
		if v, err := strconv.ParseFloat(q.Get(k), 64); err == nil {
			return v
		}
		return d
	}
	p := bench.BasketProfile{
		Count: atoi("count", 1000), Seed: int64(atoi("seed", 1)), SkusMin: atoi("skusMin", 2), SkusMax: atoi("skusMax", 5),
		QtyMin: atoi("qtyMin", 1), QtyMax: atoi("qtyMax", 2),
		PctMono: atof("pctMono", 30), PctMulti: atof("pctMulti", 40), PctMultiSource: atof("pctMultiSource", 20), PctConsolidation: atof("pctConsolidation", 10),
		SpreadOrderDates: q.Get("spread") == "true",
	}
	if v := q.Get("postalCodes"); v != "" {
		p.PostalCodes = strings.Split(v, ",")
	}
	if v := q.Get("modes"); v != "" {
		p.Modes = strings.Split(v, ",")
	}
	writeJSON(w, 200, bench.GenerateBaskets(s.store(), p))
}

func (s *Server) databaseStatus(w http.ResponseWriter, r *http.Request) {
	if s.opts.DB == nil {
		writeJSON(w, 200, map[string]any{"persistence": false, "detail": "no DATABASE_URL / POSTGRES_URL configured: data is generated in memory"})
		return
	}
	m, err := s.opts.DB.Meta(r.Context())
	if err != nil {
		writeProblem(w, r, 500, "internal", err.Error(), nil)
		return
	}
	writeJSON(w, 200, map[string]any{"persistence": true, "dataset": m, "lastPersistError": s.store().LastPersistError()})
}
