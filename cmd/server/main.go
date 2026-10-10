// Command server runs the delivery promise API (and optionally serves the
// built frontend) as a long-running process: local dev, Docker, Cloud Run.
package main

import (
	"context"
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/onestock/dp100ms/pkg/api"
	"github.com/onestock/dp100ms/pkg/app"
)

func main() {
	srv, err := app.Bootstrap(context.Background())
	if err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	srv.Bench.SelfURL = "http://127.0.0.1:" + port
	if v, err := strconv.Atoi(os.Getenv("BENCH_MAX_DURATION_SEC")); err == nil && v > 0 {
		srv.Bench.MaxDurationSec = v
	}
	if addr := os.Getenv("PPROF_ADDR"); addr != "" {
		// profiling endpoints on a separate, non-public port
		go func() { log.Println(http.ListenAndServe(addr, http.DefaultServeMux)) }()
	}
	hs := &http.Server{Addr: ":" + port, Handler: srv, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		log.Printf("listening on :%s", port)
		if err := hs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = hs.Shutdown(ctx)
	var _ *api.Server = srv
}
