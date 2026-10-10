// Package bench contains the live latency recorder used by the dashboard and
// the built-in load generator used by the benchmark screen.
package bench

import (
	"math"
	"runtime"
	"sort"
	"sync"
	"syscall"
	"time"
)

// Recorder keeps a ring buffer of recent request latencies and per-second
// counters. It is safe for concurrent use.
type Recorder struct {
	mu      sync.Mutex
	ring    []float64 // ms
	pos     int
	full    bool
	total   uint64
	errors  uint64
	seconds [120]secBucket
	started time.Time
	sumMs   float64
}

type secBucket struct {
	sec    int64
	count  int
	errors int
}

func NewRecorder(size int) *Recorder {
	return &Recorder{ring: make([]float64, size), started: time.Now()}
}

// Observe records one request.
func (r *Recorder) Observe(d time.Duration, failed bool) {
	ms := float64(d.Microseconds()) / 1000
	now := time.Now().Unix()
	r.mu.Lock()
	r.ring[r.pos] = ms
	r.pos++
	if r.pos == len(r.ring) {
		r.pos = 0
		r.full = true
	}
	r.total++
	r.sumMs += ms
	b := &r.seconds[now%int64(len(r.seconds))]
	if b.sec != now {
		*b = secBucket{sec: now}
	}
	b.count++
	if failed {
		r.errors++
		b.errors++
	}
	r.mu.Unlock()
}

// Snapshot summarises the recorder.
type Snapshot struct {
	Requests  uint64  `json:"requests"`
	Errors    uint64  `json:"errors"`
	ErrorRate float64 `json:"errorRate"`
	Window    int     `json:"window"`
	AvgMs     float64 `json:"avgMs"`
	P50Ms     float64 `json:"p50Ms"`
	P95Ms     float64 `json:"p95Ms"`
	P99Ms     float64 `json:"p99Ms"`
	MaxMs     float64 `json:"maxMs"`
	RPS1m     float64 `json:"rps1m"`
	RPSPeak   float64 `json:"rpsPeak"`
	UptimeSec float64 `json:"uptimeSec"`
}

func Percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return math.Round(sorted[idx]*1000) / 1000
}

func (r *Recorder) Snapshot() Snapshot {
	r.mu.Lock()
	n := r.pos
	if r.full {
		n = len(r.ring)
	}
	vals := make([]float64, n)
	copy(vals, r.ring[:n])
	s := Snapshot{Requests: r.total, Errors: r.errors, Window: n, UptimeSec: time.Since(r.started).Seconds()}
	now := time.Now().Unix()
	var c60 int
	for _, b := range r.seconds {
		if b.sec > now-60 && b.sec < now {
			c60 += b.count
			if float64(b.count) > s.RPSPeak {
				s.RPSPeak = float64(b.count)
			}
		}
	}
	r.mu.Unlock()
	if s.Requests > 0 {
		s.ErrorRate = float64(s.Errors) / float64(s.Requests)
	}
	span := math.Min(60, s.UptimeSec)
	if span > 0 {
		s.RPS1m = math.Round(float64(c60)/span*10) / 10
	}
	sort.Float64s(vals)
	if n > 0 {
		sum := 0.0
		for _, v := range vals {
			sum += v
		}
		s.AvgMs = math.Round(sum/float64(n)*1000) / 1000
		s.MaxMs = vals[n-1]
	}
	s.P50Ms = Percentile(vals, 50)
	s.P95Ms = Percentile(vals, 95)
	s.P99Ms = Percentile(vals, 99)
	return s
}

// Reset clears the recorder.
func (r *Recorder) Reset() {
	r.mu.Lock()
	r.pos, r.full, r.total, r.errors, r.sumMs = 0, false, 0, 0, 0
	r.seconds = [120]secBucket{}
	r.started = time.Now()
	r.mu.Unlock()
}

// System describes the process resources.
type System struct {
	GoVersion   string  `json:"goVersion"`
	NumCPU      int     `json:"numCpu"`
	GOMAXPROCS  int     `json:"gomaxprocs"`
	Goroutines  int     `json:"goroutines"`
	HeapAllocMB float64 `json:"heapAllocMb"`
	SysMB       float64 `json:"sysMb"`
	NumGC       uint32  `json:"numGc"`
	CPUSeconds  float64 `json:"cpuSeconds"`
	OS          string  `json:"os"`
	Arch        string  `json:"arch"`
}

func CPUSeconds() float64 {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return 0
	}
	return float64(ru.Utime.Sec+ru.Stime.Sec) + float64(ru.Utime.Usec+ru.Stime.Usec)/1e6
}

func ReadSystem() System {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return System{
		GoVersion: runtime.Version(), NumCPU: runtime.NumCPU(), GOMAXPROCS: runtime.GOMAXPROCS(0), Goroutines: runtime.NumGoroutine(),
		HeapAllocMB: math.Round(float64(ms.HeapAlloc)/1e6*10) / 10, SysMB: math.Round(float64(ms.Sys)/1e6*10) / 10, NumGC: ms.NumGC,
		CPUSeconds: CPUSeconds(), OS: runtime.GOOS, Arch: runtime.GOARCH,
	}
}
