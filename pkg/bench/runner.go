package bench

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// RunConfig configures a load test.
type RunConfig struct {
	Name        string `json:"name"`
	Profile     string `json:"profile,omitempty"` // vus-10 … vus-1000, rate-500 …
	VUs         int    `json:"vus"`
	DurationSec int    `json:"durationSec"`
	// RateRPS > 0 switches to a constant arrival rate (open model).
	RateRPS int `json:"rateRps"`
	// Target: "inprocess" (handler called directly, JSON included, no
	// network) or "http" (real HTTP to BaseURL, default the server itself).
	Target  string        `json:"target"`
	BaseURL string        `json:"baseUrl,omitempty"`
	Baskets BasketProfile `json:"baskets"`
}

type LatencyStats struct {
	Requests int     `json:"requests"`
	Errors   int     `json:"errors"`
	AvgMs    float64 `json:"avgMs"`
	P50Ms    float64 `json:"p50Ms"`
	P90Ms    float64 `json:"p90Ms"`
	P95Ms    float64 `json:"p95Ms"`
	P99Ms    float64 `json:"p99Ms"`
	MaxMs    float64 `json:"maxMs"`
	MinMs    float64 `json:"minMs"`
}

type Summary struct {
	LatencyStats
	ErrorRate         float64                 `json:"errorRate"`
	RPS               float64                 `json:"rps"`
	DurationSec       float64                 `json:"durationSec"`
	CPUAvgPct         float64                 `json:"cpuAvgPct"`
	CPUPeakPct        float64                 `json:"cpuPeakPct"`
	MemPeakMB         float64                 `json:"memPeakMb"`
	CacheHitRate      float64                 `json:"cacheHitRate"`
	DistinctBaskets   int                     `json:"distinctBaskets"`
	AvgComputeMs      float64                 `json:"avgComputeMs"`
	ByCategory        map[string]LatencyStats `json:"byCategory"`
	DroppedIterations int                     `json:"droppedIterations"`
	StatusCodes       map[string]int          `json:"statusCodes"`
}

type Point struct {
	T      int     `json:"t"`
	RPS    float64 `json:"rps"`
	P50    float64 `json:"p50"`
	P95    float64 `json:"p95"`
	P99    float64 `json:"p99"`
	Errors int     `json:"errors"`
	CPUPct float64 `json:"cpuPct"`
	HeapMB float64 `json:"heapMb"`
}

type Environment struct {
	System
	Hostname string `json:"hostname"`
	Platform string `json:"platform"`
}

type Run struct {
	ID         string      `json:"id"`
	Source     string      `json:"source"` // builtin | k6
	Status     string      `json:"status"` // running | completed | stopped | failed
	Config     RunConfig   `json:"config"`
	StartedAt  time.Time   `json:"startedAt"`
	FinishedAt *time.Time  `json:"finishedAt,omitempty"`
	Summary    *Summary    `json:"summary,omitempty"`
	Series     []Point     `json:"series"`
	Env        Environment `json:"environment"`
	Error      string      `json:"error,omitempty"`
}

// Hooks lets the runner read engine counters without importing it.
type Hooks struct {
	CacheCounters func() (hits, misses uint64)
	Persist       func(r *Run)
	Env           func() Environment
}

// Manager runs and stores benchmarks.
type Manager struct {
	mu             sync.Mutex
	runs           []*Run
	cancel         map[string]context.CancelFunc
	seq            atomic.Int64
	handler        http.Handler
	hooks          Hooks
	baskets        func(BasketProfile) []Basket
	MaxDurationSec int
	SelfURL        string
}

func NewManager(h http.Handler, baskets func(BasketProfile) []Basket, hooks Hooks) *Manager {
	return &Manager{handler: h, baskets: baskets, hooks: hooks, cancel: map[string]context.CancelFunc{}, MaxDurationSec: 600}
}

// SetHandler lets the API register itself after construction.
func (m *Manager) SetHandler(h http.Handler) { m.handler = h }

// Load restores runs (persistence).
func (m *Manager) Load(r *Run) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r.Status == "running" {
		r.Status = "failed"
		r.Error = "interrupted by a restart"
	}
	m.runs = append(m.runs, r)
	sort.Slice(m.runs, func(i, j int) bool { return m.runs[i].StartedAt.Before(m.runs[j].StartedAt) })
}

func (m *Manager) List() []*Run {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Run, len(m.runs))
	for i := range m.runs {
		out[len(m.runs)-1-i] = m.runs[i]
	}
	return out
}

func (m *Manager) Get(id string) (*Run, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.runs {
		if r.ID == id {
			return r, true
		}
	}
	return nil, false
}

func (m *Manager) Stop(id string) bool {
	m.mu.Lock()
	c, ok := m.cancel[id]
	m.mu.Unlock()
	if ok {
		c()
	}
	return ok
}

func (m *Manager) Delete(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, r := range m.runs {
		if r.ID == id && r.Status != "running" {
			m.runs = append(m.runs[:i], m.runs[i+1:]...)
			return true
		}
	}
	return false
}

// Add stores an externally produced run (k6 import).
func (m *Manager) Add(r *Run) {
	if r.ID == "" {
		r.ID = fmt.Sprintf("bench-%d-%d", time.Now().Unix(), m.seq.Add(1))
	}
	m.mu.Lock()
	m.runs = append(m.runs, r)
	m.mu.Unlock()
	if m.hooks.Persist != nil {
		m.hooks.Persist(r)
	}
}

// Presets are the predefined load profiles.
var Presets = []RunConfig{
	{Name: "10 utilisateurs concurrents", Profile: "vus-10", VUs: 10, DurationSec: 30},
	{Name: "50 utilisateurs concurrents", Profile: "vus-50", VUs: 50, DurationSec: 30},
	{Name: "100 utilisateurs concurrents", Profile: "vus-100", VUs: 100, DurationSec: 30},
	{Name: "250 utilisateurs concurrents", Profile: "vus-250", VUs: 250, DurationSec: 30},
	{Name: "500 utilisateurs concurrents", Profile: "vus-500", VUs: 500, DurationSec: 30},
	{Name: "1000 utilisateurs concurrents", Profile: "vus-1000", VUs: 1000, DurationSec: 30},
	{Name: "Débit constant 200 req/s", Profile: "rate-200", VUs: 200, RateRPS: 200, DurationSec: 30},
	{Name: "Débit constant 500 req/s", Profile: "rate-500", VUs: 400, RateRPS: 500, DurationSec: 30},
	{Name: "Débit constant 1000 req/s", Profile: "rate-1000", VUs: 800, RateRPS: 1000, DurationSec: 30},
	{Name: "Débit constant 2000 req/s", Profile: "rate-2000", VUs: 1000, RateRPS: 2000, DurationSec: 30},
}

func (cfg *RunConfig) normalize(maxDur int) {
	if cfg.VUs <= 0 {
		cfg.VUs = 10
	}
	if cfg.VUs > 2000 {
		cfg.VUs = 2000
	}
	if cfg.DurationSec <= 0 {
		cfg.DurationSec = 20
	}
	if cfg.DurationSec > maxDur {
		cfg.DurationSec = maxDur
	}
	if cfg.Target == "" {
		cfg.Target = "inprocess"
	}
	if cfg.Name == "" {
		if cfg.RateRPS > 0 {
			cfg.Name = fmt.Sprintf("Débit constant %d req/s", cfg.RateRPS)
		} else {
			cfg.Name = fmt.Sprintf("%d utilisateurs concurrents", cfg.VUs)
		}
	}
	if cfg.Baskets.Count == 0 {
		cfg.Baskets.Count = 2000
	}
}

// Start launches a run. When wait is true it blocks until completion.
func (m *Manager) Start(cfg RunConfig, wait bool) (*Run, error) {
	cfg.normalize(m.MaxDurationSec)
	m.mu.Lock()
	for _, r := range m.runs {
		if r.Status == "running" {
			m.mu.Unlock()
			return nil, fmt.Errorf("benchmark %s is already running", r.ID)
		}
	}
	run := &Run{ID: fmt.Sprintf("bench-%d-%d", time.Now().Unix(), m.seq.Add(1)), Source: "builtin", Status: "running", Config: cfg, StartedAt: time.Now(), Series: []Point{}}
	if m.hooks.Env != nil {
		run.Env = m.hooks.Env()
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel[run.ID] = cancel
	m.runs = append(m.runs, run)
	m.mu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() {
			if rec := recover(); rec != nil {
				m.finish(run, nil, fmt.Sprint(rec))
			}
		}()
		sum, err := m.execute(ctx, run)
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		m.finish(run, sum, msg)
	}()
	if wait {
		<-done
	}
	return run, nil
}

func (m *Manager) finish(run *Run, sum *Summary, errMsg string) {
	now := time.Now()
	m.mu.Lock()
	run.FinishedAt = &now
	run.Summary = sum
	switch {
	case errMsg != "":
		run.Status = "failed"
		run.Error = errMsg
	case run.Status == "stopping":
		run.Status = "stopped"
	default:
		run.Status = "completed"
	}
	delete(m.cancel, run.ID)
	m.mu.Unlock()
	if m.hooks.Persist != nil {
		m.hooks.Persist(run)
	}
}

type sample struct {
	ms      float64
	ok      bool
	status  int
	cat     int8
	compute float64
}

func (m *Manager) execute(ctx context.Context, run *Run) (*Summary, error) {
	cfg := run.Config
	baskets := m.baskets(cfg.Baskets)
	if len(baskets) == 0 {
		return nil, fmt.Errorf("no basket could be generated")
	}
	bodies := make([][]byte, len(baskets))
	cats := make([]int8, len(baskets))
	catNames := []string{CatMono, CatMulti, CatMultiSource, CatConsolidation}
	for i, b := range baskets {
		bodies[i], _ = json.Marshal(b.Request)
		for ci, n := range catNames {
			if n == b.Category {
				cats[i] = int8(ci)
			}
		}
	}
	var client *http.Client
	url := ""
	if cfg.Target == "http" {
		base := cfg.BaseURL
		if base == "" {
			base = m.SelfURL
		}
		if base == "" {
			return nil, fmt.Errorf("http target needs a baseUrl")
		}
		url = base + "/api/v1/delivery-promises"
		tr := &http.Transport{MaxIdleConns: cfg.VUs * 2, MaxIdleConnsPerHost: cfg.VUs * 2, IdleConnTimeout: 30 * time.Second}
		client = &http.Client{Transport: tr, Timeout: 30 * time.Second}
		defer tr.CloseIdleConnections()
	}
	do := func(i int) sample {
		body := bodies[i]
		t0 := time.Now()
		var status int
		var compute float64
		if client != nil {
			resp, err := client.Post(url, "application/json", bytes.NewReader(body))
			if err != nil {
				return sample{ms: msSince(t0), ok: false, status: 0, cat: cats[i]}
			}
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			status = resp.StatusCode
			compute = extractCompute(b)
		} else {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/delivery-promises", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			m.handler.ServeHTTP(rec, req)
			status = rec.Code
			compute = extractCompute(rec.Body.Bytes())
		}
		return sample{ms: msSince(t0), ok: status == 200, status: status, cat: cats[i], compute: compute}
	}

	var hits0, miss0 uint64
	if m.hooks.CacheCounters != nil {
		hits0, miss0 = m.hooks.CacheCounters()
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.DurationSec)*time.Second)
	defer cancel()
	var mu sync.Mutex
	var all []sample
	var window []sample
	var next atomic.Int64
	var dropped atomic.Int64
	record := func(s sample) {
		mu.Lock()
		all = append(all, s)
		window = append(window, s)
		mu.Unlock()
	}
	var wg sync.WaitGroup
	start := time.Now()
	if cfg.RateRPS > 0 {
		// open model: fixed arrival rate, bounded concurrency
		sem := make(chan struct{}, cfg.VUs)
		interval := time.Second / time.Duration(cfg.RateRPS)
		ticker := time.NewTicker(interval)
		go func() {
			defer ticker.Stop()
			for {
				select {
				case <-runCtx.Done():
					return
				case <-ticker.C:
					select {
					case sem <- struct{}{}:
						wg.Add(1)
						go func() {
							defer wg.Done()
							defer func() { <-sem }()
							i := int(next.Add(1)-1) % len(bodies)
							record(do(i))
						}()
					default:
						dropped.Add(1)
					}
				}
			}
		}()
	} else {
		for v := 0; v < cfg.VUs; v++ {
			wg.Add(1)
			go func(v int) {
				defer wg.Done()
				for runCtx.Err() == nil {
					i := int(next.Add(1)-1) % len(bodies)
					record(do(i))
				}
			}(v)
		}
	}
	// sampler
	cpu0 := CPUSeconds()
	t0 := time.Now()
	tick := time.NewTicker(time.Second)
	sec := 0
	var cpuSum, cpuPeak, memPeak float64
loop:
	for {
		select {
		case <-runCtx.Done():
			break loop
		case <-tick.C:
			sec++
			mu.Lock()
			w := window
			window = nil
			mu.Unlock()
			cpu1 := CPUSeconds()
			el := time.Since(t0).Seconds()
			pct := (cpu1 - cpu0) / el / float64(runtime.NumCPU()) * 100
			cpu0, t0 = cpu1, time.Now()
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			heap := float64(ms.HeapAlloc) / 1e6
			cpuSum += pct
			cpuPeak = math.Max(cpuPeak, pct)
			memPeak = math.Max(memPeak, heap)
			ls := stats(w)
			p := Point{T: sec, RPS: float64(len(w)), P50: ls.P50Ms, P95: ls.P95Ms, P99: ls.P99Ms, Errors: ls.Errors, CPUPct: round1(pct), HeapMB: round1(heap)}
			m.mu.Lock()
			run.Series = append(run.Series, p)
			m.mu.Unlock()
		}
	}
	tick.Stop()
	if ctx.Err() != nil {
		m.mu.Lock()
		run.Status = "stopping"
		m.mu.Unlock()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	mu.Lock()
	defer mu.Unlock()
	sum := &Summary{LatencyStats: stats(all), DurationSec: round1(elapsed), ByCategory: map[string]LatencyStats{}, StatusCodes: map[string]int{}}
	if sum.Requests > 0 {
		sum.ErrorRate = float64(sum.Errors) / float64(sum.Requests)
	}
	sum.RPS = round1(float64(sum.Requests) / elapsed)
	if sec > 0 {
		sum.CPUAvgPct = round1(cpuSum / float64(sec))
	}
	sum.CPUPeakPct = round1(cpuPeak)
	sum.MemPeakMB = round1(memPeak)
	sum.DroppedIterations = int(dropped.Load())
	n := int(next.Load())
	if n > len(bodies) {
		n = len(bodies)
	}
	sum.DistinctBaskets = n
	byCat := map[int8][]sample{}
	var compSum float64
	for _, s := range all {
		byCat[s.cat] = append(byCat[s.cat], s)
		sum.StatusCodes[fmt.Sprint(s.status)]++
		compSum += s.compute
	}
	if len(all) > 0 {
		sum.AvgComputeMs = math.Round(compSum/float64(len(all))*1000) / 1000
	}
	for ci, ss := range byCat {
		sum.ByCategory[catNames[ci]] = stats(ss)
	}
	if m.hooks.CacheCounters != nil {
		h1, m1 := m.hooks.CacheCounters()
		dh, dm := h1-hits0, m1-miss0
		if dh+dm > 0 {
			sum.CacheHitRate = math.Round(float64(dh)/float64(dh+dm)*10000) / 10000
		}
	}
	return sum, nil
}

func extractCompute(b []byte) float64 {
	var v struct {
		CalculationTimeMs float64 `json:"calculationTimeMs"`
	}
	_ = json.Unmarshal(b, &v)
	return v.CalculationTimeMs
}

func msSince(t time.Time) float64 { return float64(time.Since(t).Microseconds()) / 1000 }

func round1(x float64) float64 { return math.Round(x*10) / 10 }

func stats(ss []sample) LatencyStats {
	ls := LatencyStats{Requests: len(ss)}
	if len(ss) == 0 {
		return ls
	}
	vals := make([]float64, len(ss))
	sum := 0.0
	for i, s := range ss {
		vals[i] = s.ms
		sum += s.ms
		if !s.ok {
			ls.Errors++
		}
	}
	sort.Float64s(vals)
	ls.AvgMs = math.Round(sum/float64(len(vals))*1000) / 1000
	ls.P50Ms = Percentile(vals, 50)
	ls.P90Ms = Percentile(vals, 90)
	ls.P95Ms = Percentile(vals, 95)
	ls.P99Ms = Percentile(vals, 99)
	ls.MaxMs = vals[len(vals)-1]
	ls.MinMs = vals[0]
	return ls
}
