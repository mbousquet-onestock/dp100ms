// Package handler is the Vercel serverless entry point: every /api/* request
// is rewritten to this function (see vercel.json). The dataset is generated
// in memory at cold start (deterministic seed) unless DATABASE_URL is set.
package handler

import (
	"context"
	"net/http"
	"strings"
	"sync"

	"github.com/onestock/dp100ms/pkg/api"
	"github.com/onestock/dp100ms/pkg/app"
)

var (
	once    sync.Once
	server  *api.Server
	initErr error
)

// Handler serves all API routes.
func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(func() {
		server, initErr = app.Bootstrap(context.Background())
		if server != nil {
			server.Bench.MaxDurationSec = 25
		}
	})
	if initErr != nil {
		http.Error(w, "bootstrap failed: "+initErr.Error(), http.StatusInternalServerError)
		return
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
