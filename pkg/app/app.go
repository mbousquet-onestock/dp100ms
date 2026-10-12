// Package app wires the store, the optional PostgreSQL persistence and the
// HTTP API from environment variables. It is shared by the long-running
// server (local, Docker, Cloud Run) and the Vercel serverless function.
package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"runtime/debug"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/onestock/dp100ms/pkg/api"
	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/pg"
	"github.com/onestock/dp100ms/pkg/store"
)

// Environment variables:
//
//	SEED            dataset seed (default 42)
//	ADMIN_TOKEN     bearer token of the admin API (default dev-admin-token)
//	DATABASE_URL    PostgreSQL URL; POSTGRES_URL (Vercel / Neon integration)
//	                is used when DATABASE_URL is not set
//	DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING
//	                direct connection used for migrations and initialisation
//	STOCK_STORAGE   "delta" (default: only changed stock lines are stored,
//	                the baseline is regenerated from the seed) or "full"
//	STOCK_SOURCE    "generate" ignores the database content at boot
//	STATIC_DIR      directory of the built frontend to serve
//	PLATFORM        free label (local, docker, vercel, cloudrun)
//	GOGC            Go GC target (default 200 here)

func Seed() int64 {
	if v, err := strconv.ParseInt(os.Getenv("SEED"), 10, 64); err == nil {
		return v
	}
	return 42
}

func firstEnv(names ...string) string {
	for _, n := range names {
		if v := os.Getenv(n); v != "" {
			return v
		}
	}
	return ""
}

// DatabaseURLs returns the pooled URL used at runtime and the direct URL
// used for migrations and the initial load.
func DatabaseURLs() (runtime, direct string) {
	runtime = firstEnv("DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL")
	direct = firstEnv("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING")
	if direct == "" {
		direct = runtime
	}
	return
}

// StockStorage returns the configured stock storage mode.
func StockStorage() string {
	if os.Getenv("STOCK_STORAGE") == pg.StockFull {
		return pg.StockFull
	}
	return pg.StockDelta
}

func generate(seed int64) *store.Store {
	cfg := datagen.DefaultConfig()
	cfg.Seed = seed
	return datagen.Generate(cfg)
}

func baseline(s *store.Store, seed int64) {
	cfg := datagen.DefaultConfig()
	cfg.Seed = seed
	datagen.FillStock(s, cfg)
}

// InitDatabase migrates the database and, when it is empty, loads the
// reference dataset. It is safe to call from several instances at once:
// an advisory lock serialises the initialisation. It returns true when this
// call performed the initial load.
func InitDatabase(ctx context.Context, directURL string, seed int64, stockMode string, force bool) (bool, error) {
	db, err := pg.Open(ctx, directURL)
	if err != nil {
		return false, err
	}
	defer db.Close()
	loaded := false
	err = db.WithInitLock(ctx, func() error {
		if err := db.Migrate(ctx); err != nil {
			return err
		}
		empty, err := db.IsEmpty(ctx)
		if err != nil {
			return err
		}
		if !empty && !force {
			return nil
		}
		t0 := time.Now()
		cfg := datagen.DefaultConfig()
		cfg.Seed = seed
		st := datagen.Generate(cfg)
		if err := db.SaveAll(ctx, st, cfg, stockMode); err != nil {
			return fmt.Errorf("initial load: %w", err)
		}
		loaded = true
		log.Printf("database initialised in %v (seed %d, stock storage %s)", time.Since(t0).Round(time.Millisecond), seed, stockMode)
		return nil
	})
	return loaded, err
}

// Bootstrap builds the API server.
// SyncInterval is how often an instance applies the changes written by the
// other instances (SYNC_INTERVAL_MS, default 1000 ms, 0 disables).
func SyncInterval() time.Duration {
	if v := os.Getenv("SYNC_INTERVAL_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms >= 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return time.Second
}

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
	runtimeURL, directURL := DatabaseURLs()
	if runtimeURL != "" {
		if _, err := InitDatabase(ctx, directURL, Seed(), StockStorage(), false); err != nil {
			return nil, err
		}
		db, err := pg.Open(ctx, runtimeURL)
		if err != nil {
			return nil, err
		}
		// changes written by other instances after this point are synced
		var seq atomic.Int64
		if v, err := db.LastSeq(ctx); err == nil {
			seq.Store(v)
		}
		_ = db.PruneChanges(ctx)
		if os.Getenv("STOCK_SOURCE") == "generate" {
			st = generate(Seed())
		} else {
			var runs []*api.BenchRun
			st, runs, err = db.LoadAll(ctx, baseline)
			if err != nil {
				return nil, err
			}
			opts.InitialRuns = runs
		}
		st.SetPersister(db)
		opts.DB = db
		opts.SyncInterval = SyncInterval()
		if opts.SyncInterval > 0 {
			opts.Sync = func(ctx context.Context, s *store.Store) (bool, error) {
				res, err := db.Sync(ctx, s, seq.Load())
				if err != nil {
					return false, err
				}
				seq.Store(res.Seq)
				return res.Reload, nil
			}
			opts.Reload = func() (*store.Store, error) {
				ctx := context.Background()
				if v, err := db.LastSeq(ctx); err == nil {
					seq.Store(v)
				}
				s, _, err := db.LoadAll(ctx, baseline)
				if err != nil {
					return nil, err
				}
				s.SetPersister(db)
				return s, nil
			}
		}
		opts.Reseed = func(seed int64, stockMode string) (*store.Store, error) {
			if stockMode == "" {
				stockMode = StockStorage()
			}
			if _, err := InitDatabase(context.Background(), directURL, seed, stockMode, true); err != nil {
				return nil, err
			}
			if v, err := db.LastSeq(context.Background()); err == nil {
				seq.Store(v) // our own reseed: no reload needed
			}
			s, _, err := db.LoadAll(context.Background(), baseline)
			if err != nil {
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
		time.Since(t0).Round(time.Millisecond), st.StockPoints.Len(), st.Stock.LineCount(), platform, runtimeURL != "")
	return srv, nil
}
