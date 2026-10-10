// Package app wires the store, the optional PostgreSQL persistence and the
// HTTP API from environment variables. It is shared by the long-running
// server (local, Docker, Cloud Run) and the Vercel serverless function.
package app

import (
	"context"
	"log"
	"os"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/onestock/dp100ms/pkg/api"
	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/pg"
	"github.com/onestock/dp100ms/pkg/store"
)

// Environment variables:
//   SEED            dataset seed when generating in memory (default 42)
//   ADMIN_TOKEN     bearer token of the admin API (default dev-admin-token)
//   DATABASE_URL    PostgreSQL URL; enables persistence
//   STOCK_SOURCE    "database" (default when DATABASE_URL is set) or "generate"
//   STATIC_DIR      directory of the built frontend to serve
//   PLATFORM        free label (local, docker, vercel, cloudrun)
//   GOGC            Go GC target (default 200 here)

func Seed() int64 {
	if v, err := strconv.ParseInt(os.Getenv("SEED"), 10, 64); err == nil {
		return v
	}
	return 42
}

func generate(seed int64) *store.Store {
	cfg := datagen.DefaultConfig()
	cfg.Seed = seed
	return datagen.Generate(cfg)
}

// Bootstrap builds the API server.
func Bootstrap(ctx context.Context) (*api.Server, error) {
	t0 := time.Now()
	// The heap is small (~50 MB) and mostly long-lived: a higher GC target
	// trades a little memory for less GC CPU on the request path.
	if os.Getenv("GOGC") == "" {
		debug.SetGCPercent(200)
	}
	token := os.Getenv("ADMIN_TOKEN")
	if token == "" {
		token = "dev-admin-token"
		log.Printf("ADMIN_TOKEN not set: using the development token")
	}
	platform := os.Getenv("PLATFORM")
	if platform == "" {
		switch {
		case os.Getenv("VERCEL") != "":
			platform = "vercel"
		case os.Getenv("K_SERVICE") != "":
			platform = "cloudrun"
		default:
			platform = "local"
		}
	}
	opts := api.Options{AdminToken: token, StaticDir: os.Getenv("STATIC_DIR"), Platform: platform}
	var st *store.Store
	var db *pg.DB
	if url := os.Getenv("DATABASE_URL"); url != "" {
		var err error
		db, err = pg.Open(ctx, url)
		if err != nil {
			return nil, err
		}
		if err := db.Migrate(ctx); err != nil {
			return nil, err
		}
		empty, err := db.IsEmpty(ctx)
		if err != nil {
			return nil, err
		}
		if empty || os.Getenv("STOCK_SOURCE") == "generate" {
			st = generate(Seed())
			if empty {
				log.Printf("database empty: seeding with seed %d", st.Seed)
				if err := db.SaveAll(ctx, st, datagen.DefaultConfig()); err != nil {
					return nil, err
				}
			}
		} else {
			var runs []*api.BenchRun
			st, runs, err = db.LoadAll(ctx)
			if err != nil {
				return nil, err
			}
			defer func() { _ = runs }()
			opts.InitialRuns = runs
		}
		st.SetPersister(db)
		opts.Reseed = func(seed int64) (*store.Store, error) {
			s := generate(seed)
			cfg := datagen.DefaultConfig()
			cfg.Seed = seed
			if err := db.SaveAll(context.Background(), s, cfg); err != nil {
				return nil, err
			}
			s.SetPersister(db)
			return s, nil
		}
	} else {
		st = generate(Seed())
	}
	srv := api.New(st, opts)
	log.Printf("ready in %v: %d stock points, %d stock lines (platform=%s, persistence=%v)",
		time.Since(t0).Round(time.Millisecond), st.StockPoints.Len(), st.Stock.LineCount(), platform, db != nil)
	return srv, nil
}
