// Package handler is the Vercel serverless entry point: every /api/* request
// is rewritten to this function (see vercel.json). The dataset is generated
// in memory at cold start (deterministic seed) unless DATABASE_URL is set.
package handler

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/onestock/dp100ms/pkg/api"
	"github.com/onestock/dp100ms/pkg/app"
)

var (
	once    sync.Once
	server  *api.Server
	initErr error
	// diagnostics: instance start, bootstrap duration, first request
	started   time.Time
	bootMs    float64
	firstDone atomic.Bool
)

// Handler serves all API routes.
func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(func() {
		started = time.Now()
		server, initErr = app.Bootstrap(context.Background())
		bootMs = float64(time.Since(started).Microseconds()) / 1000
		if server != nil {
			server.Bench.MaxDurationSec = 25
		}
	})
	if initErr != nil {
		http.Error(w, "bootstrap failed: "+initErr.Error(), http.StatusInternalServerError)
		return
	}
	// Diagnostics for clients (Postman, browser devtools): the first request
	// of an instance pays the bootstrap (dataset generation / database load).
	h := w.Header()
	if firstDone.CompareAndSwap(false, true) {
		h.Set("X-Instance-Cold-Start", "true")
		h.Add("Server-Timing", "bootstrap;desc=\"démarrage instance\";dur="+strconv.FormatFloat(bootMs, 'f', 1, 64))
	} else {
		h.Set("X-Instance-Cold-Start", "false")
	}
	h.Set("X-Instance-Uptime-S", strconv.Itoa(int(time.Since(started).Seconds())))
	if region := os.Getenv("VERCEL_REGION"); region != "" {
		h.Set("X-Function-Region", region)
	}
	// The rewrite passes the original path as ?path=…; restore it.
	if p := r.URL.Query().Get("__path"); p != "" && !strings.HasPrefix(r.URL.Path, "/api/v1") {
		q := r.URL.Query()
		q.Del("__path")
		r.URL.Path = "/api/" + strings.TrimPrefix(p, "/")
		r.URL.RawQuery = q.Encode()
	}
	server.ServeHTTP(w, r)
}
