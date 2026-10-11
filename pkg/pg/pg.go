// Package pg persists the store into PostgreSQL: JSONB documents for the
// configuration, relational tables for the catalog and the 1.2M stock lines
// (bulk loaded with COPY).
package pg

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/onestock/dp100ms/pkg/bench"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

//go:embed migrations/*.sql
var migrations embed.FS

var tables = map[string]string{
	"stock_point":        "stock_points",
	"carrier":            "carriers",
	"service":            "carrier_services",
	"hub":                "hubs",
	"leg":                "legs",
	"route":              "routes",
	"delivery_mode":      "delivery_modes",
	"scenario":           "scenarios",
	"benchmark":          "benchmarks",
	"settings":           "settings",
	"rate_card":          "rate_cards",
	"additional_service": "additional_services",
	"stock_view":         "stock_views",
	"zone":               "zones",
	"carrier_route":      "carrier_routes",
}

// DB implements store.Persister.
type DB struct {
	Pool *pgxpool.Pool
}

func Open(ctx context.Context, url string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	// Transaction poolers (PgBouncer, Neon "-pooler" endpoints) do not keep
	// prepared statements between transactions: use the simple protocol.
	if strings.Contains(cfg.ConnConfig.Host, "-pooler") || strings.Contains(url, "pgbouncer=true") {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	ctx2, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(ctx2); err != nil {
		pool.Close()
		return nil, err
	}
	return &DB{Pool: pool}, nil
}

func (d *DB) Close() { d.Pool.Close() }

// Migrate applies embedded migrations in order.
func (d *DB) Migrate(ctx context.Context) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	if _, err := d.Pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	for _, n := range names {
		v, err := strconv.Atoi(strings.SplitN(n, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("bad migration name %s", n)
		}
		var exists bool
		if err := d.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, v).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, _ := migrations.ReadFile("migrations/" + n)
		tx, err := d.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", n, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES ($1)`, v); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) SaveEntity(kind, id string, v any) error {
	t, ok := tables[kind]
	if !ok {
		return fmt.Errorf("unknown entity kind %s", kind)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = d.Pool.Exec(ctx, `INSERT INTO `+t+` (id, data, updated_at) VALUES ($1, $2, now())
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, id, b)
	return err
}

func (d *DB) DeleteEntity(kind, id string) error {
	t, ok := tables[kind]
	if !ok {
		return fmt.Errorf("unknown entity kind %s", kind)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := d.Pool.Exec(ctx, `DELETE FROM `+t+` WHERE id = $1`, id)
	return err
}

func (d *DB) SaveStockLines(lines []model.StockLine) error {
	if len(lines) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	batch := &pgx.Batch{}
	for _, l := range lines {
		batch.Queue(`INSERT INTO stock_lines (stock_point_id, sku, physical, reserved, listed, updated_at) VALUES ($1,$2,$3,$4,$5,now())
			ON CONFLICT (stock_point_id, sku) DO UPDATE SET physical=EXCLUDED.physical, reserved=EXCLUDED.reserved, listed=EXCLUDED.listed, updated_at=now()`,
			l.StockPointID, l.SKU, l.Physical, l.Reserved, l.Listed)
	}
	return d.Pool.SendBatch(ctx, batch).Close()
}

// IsEmpty reports whether the dataset has never been initialised.
func (d *DB) IsEmpty(ctx context.Context) (bool, error) {
	var n int
	if err := d.Pool.QueryRow(ctx, `SELECT count(*) FROM dataset_meta`).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

// Meta describes the stored dataset.
type Meta struct {
	Seed          int64      `json:"seed"`
	StockMode     string     `json:"stockMode"`
	GeneratedAt   time.Time  `json:"generatedAt"`
	InitializedAt *time.Time `json:"initializedAt,omitempty"`
	StockRows     int        `json:"stockRows"`
}

func (d *DB) Meta(ctx context.Context) (*Meta, error) {
	m := &Meta{}
	err := d.Pool.QueryRow(ctx, `SELECT seed, stock_mode, generated_at, initialized_at FROM dataset_meta WHERE id = 1`).Scan(&m.Seed, &m.StockMode, &m.GeneratedAt, &m.InitializedAt)
	if err != nil {
		return nil, err
	}
	_ = d.Pool.QueryRow(ctx, `SELECT count(*) FROM stock_lines`).Scan(&m.StockRows)
	return m, nil
}

// WithInitLock runs fn while holding a session advisory lock, so that a
// single process initialises an empty database even when several
// serverless instances start at the same time.
func (d *DB) WithInitLock(ctx context.Context, fn func() error) error {
	conn, err := d.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(727100042)`); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock(727100042)`) //nolint:errcheck
	return fn()
}

const (
	StockFull  = "full"
	StockDelta = "delta"
)

var entityTables = []string{"stock_points", "carriers", "carrier_services", "hubs", "legs", "routes", "delivery_modes",
	"scenarios", "rate_cards", "additional_services", "stock_views", "zones", "carrier_routes"}

func docRows[T any](items []T, id func(T) string) ([][]any, error) {
	rows := make([][]any, 0, len(items))
	for _, it := range items {
		b, err := json.Marshal(it)
		if err != nil {
			return nil, err
		}
		rows = append(rows, []any{id(it), b})
	}
	return rows, nil
}

// SaveAll replaces the whole dataset. In "full" mode every stock line is
// copied; in "delta" mode only the configuration and the catalog are
// stored and the stock baseline is regenerated from the seed at load time.
func (d *DB) SaveAll(ctx context.Context, s *store.Store, cfg any, stockMode string) error {
	if stockMode != StockDelta {
		stockMode = StockFull
	}
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `TRUNCATE stock_lines, skus, settings, dataset_meta, `+strings.Join(entityTables, ", ")); err != nil {
		return err
	}
	copyDocs := func(table string, rows [][]any, err error) error {
		if err != nil {
			return err
		}
		_, err = tx.CopyFrom(ctx, pgx.Identifier{table}, []string{"id", "data"}, pgx.CopyFromRows(rows))
		return err
	}
	steps := []func() error{
		func() error {
			r, e := docRows(s.StockPoints.All(), func(v model.StockPoint) string { return v.ID })
			return copyDocs("stock_points", r, e)
		},
		func() error {
			r, e := docRows(s.Carriers.All(), func(v model.Carrier) string { return v.ID })
			return copyDocs("carriers", r, e)
		},
		func() error {
			r, e := docRows(s.Services.All(), func(v model.CarrierService) string { return v.ID })
			return copyDocs("carrier_services", r, e)
		},
		func() error {
			r, e := docRows(s.Hubs.All(), func(v model.Hub) string { return v.ID })
			return copyDocs("hubs", r, e)
		},
		func() error {
			r, e := docRows(s.Legs.All(), func(v model.Leg) string { return v.ID })
			return copyDocs("legs", r, e)
		},
		func() error {
			r, e := docRows(s.Routes.All(), func(v model.Route) string { return v.ID })
			return copyDocs("routes", r, e)
		},
		func() error {
			r, e := docRows(s.Modes.All(), func(v model.DeliveryMode) string { return v.ID })
			return copyDocs("delivery_modes", r, e)
		},
		func() error {
			r, e := docRows(s.Scenarios.All(), func(v model.Scenario) string { return v.ID })
			return copyDocs("scenarios", r, e)
		},
		func() error {
			r, e := docRows(s.RateCards.All(), func(v model.RateCard) string { return v.ID })
			return copyDocs("rate_cards", r, e)
		},
		func() error {
			r, e := docRows(s.AdditionalServices.All(), func(v model.AdditionalService) string { return v.ID })
			return copyDocs("additional_services", r, e)
		},
		func() error {
			r, e := docRows(s.StockViews.All(), func(v model.StockView) string { return v.ID })
			return copyDocs("stock_views", r, e)
		},
		func() error {
			r, e := docRows(s.Zones.All(), func(v model.Zone) string { return v.ID })
			return copyDocs("zones", r, e)
		},
		func() error {
			r, e := docRows(s.CarrierRoutes.All(), func(v model.CarrierRoute) string { return v.ID })
			return copyDocs("carrier_routes", r, e)
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	sb, _ := json.Marshal(s.Settings())
	if _, err := tx.Exec(ctx, `INSERT INTO settings (id, data) VALUES ('engine', $1)`, sb); err != nil {
		return err
	}
	cb, _ := json.Marshal(cfg)
	if _, err := tx.Exec(ctx, `INSERT INTO dataset_meta (id, seed, config, stock_mode, initialized_at) VALUES (1, $1, $2, $3, now())`, s.Seed, cb, stockMode); err != nil {
		return err
	}
	skus := s.Stock.SKUs()
	rows := make([][]any, len(skus))
	for i, k := range skus {
		var attrs []byte
		if len(k.Attributes) > 0 {
			attrs, _ = json.Marshal(k.Attributes)
		}
		rows[i] = []any{i, k.Code, k.Name, k.Category, k.WeightKg, k.VolumeL, k.LengthCm, k.WidthCm, k.HeightCm, k.PriceEur, attrs}
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"skus"}, []string{"position", "code", "name", "category", "weight_kg", "volume_l", "length_cm", "width_cm", "height_cm", "price_eur", "attributes"}, pgx.CopyFromRows(rows)); err != nil {
		return err
	}
	if stockMode == StockFull {
		lines := make([][]any, 0, 1_200_000)
		s.Stock.ForEachLine(func(l model.StockLine) {
			lines = append(lines, []any{l.StockPointID, l.SKU, int32(l.Physical), int32(l.Reserved), l.Listed})
		})
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"stock_lines"}, []string{"stock_point_id", "sku", "physical", "reserved", "listed"}, pgx.CopyFromRows(lines)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// SaveSKU upserts an article.
func (d *DB) SaveSKU(k model.SKU) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var attrs []byte
	if len(k.Attributes) > 0 {
		attrs, _ = json.Marshal(k.Attributes)
	}
	_, err := d.Pool.Exec(ctx, `UPDATE skus SET name=$2, category=$3, weight_kg=$4, volume_l=$5, length_cm=$6, width_cm=$7, height_cm=$8, price_eur=$9, attributes=$10 WHERE code=$1`,
		k.Code, k.Name, k.Category, k.WeightKg, k.VolumeL, k.LengthCm, k.WidthCm, k.HeightCm, k.PriceEur, attrs)
	return err
}

// LoadAll builds a store from the database. In delta mode, baseline
// regenerates the stock from the seed before the stored changes are applied.
func (d *DB) LoadAll(ctx context.Context, baseline func(s *store.Store, seed int64)) (*store.Store, []*bench.Run, error) {
	s := store.New()
	type loader struct {
		table string
		fn    func([]byte) error
	}
	loaders := []loader{
		{"delivery_modes", s.Modes.LoadJSON}, {"carriers", s.Carriers.LoadJSON}, {"carrier_services", s.Services.LoadJSON},
		{"stock_points", s.StockPoints.LoadJSON}, {"hubs", s.Hubs.LoadJSON}, {"legs", s.Legs.LoadJSON},
		{"routes", s.Routes.LoadJSON}, {"scenarios", s.Scenarios.LoadJSON}, {"rate_cards", s.RateCards.LoadJSON},
		{"additional_services", s.AdditionalServices.LoadJSON}, {"stock_views", s.StockViews.LoadJSON},
		{"zones", s.Zones.LoadJSON}, {"carrier_routes", s.CarrierRoutes.LoadJSON},
	}
	for _, l := range loaders {
		rows, err := d.Pool.Query(ctx, `SELECT data FROM `+l.table+` ORDER BY id`)
		if err != nil {
			return nil, nil, err
		}
		for rows.Next() {
			var b []byte
			if err := rows.Scan(&b); err != nil {
				rows.Close()
				return nil, nil, err
			}
			if err := l.fn(b); err != nil {
				rows.Close()
				return nil, nil, fmt.Errorf("%s: %w", l.table, err)
			}
		}
		rows.Close()
		if rows.Err() != nil {
			return nil, nil, rows.Err()
		}
	}
	var sb []byte
	if err := d.Pool.QueryRow(ctx, `SELECT data FROM settings WHERE id='engine'`).Scan(&sb); err == nil {
		var es model.EngineSettings
		if json.Unmarshal(sb, &es) == nil {
			s.LoadSettingsRaw(es)
		}
	}
	stockMode := StockFull
	_ = d.Pool.QueryRow(ctx, `SELECT seed, stock_mode FROM dataset_meta WHERE id=1`).Scan(&s.Seed, &stockMode)
	rows, err := d.Pool.Query(ctx, `SELECT code, name, category, weight_kg::float8, volume_l::float8, length_cm::float8, width_cm::float8, height_cm::float8, price_eur::float8, attributes FROM skus ORDER BY position`)
	if err != nil {
		return nil, nil, err
	}
	var skus []model.SKU
	for rows.Next() {
		var k model.SKU
		var attrs []byte
		if err := rows.Scan(&k.Code, &k.Name, &k.Category, &k.WeightKg, &k.VolumeL, &k.LengthCm, &k.WidthCm, &k.HeightCm, &k.PriceEur, &attrs); err != nil {
			rows.Close()
			return nil, nil, err
		}
		if len(attrs) > 0 {
			_ = json.Unmarshal(attrs, &k.Attributes)
		}
		skus = append(skus, k)
	}
	rows.Close()
	s.InitStock(skus)
	if stockMode == StockDelta && baseline != nil {
		baseline(s, s.Seed)
	}
	st := s.Stock
	st.Lock()
	rows, err = d.Pool.Query(ctx, `SELECT stock_point_id, sku, physical, reserved, listed FROM stock_lines`)
	if err != nil {
		st.Unlock()
		return nil, nil, err
	}
	for rows.Next() {
		var pid, sku string
		var phys, res int32
		var listed bool
		if err := rows.Scan(&pid, &sku, &phys, &res, &listed); err != nil {
			rows.Close()
			st.Unlock()
			return nil, nil, err
		}
		p, ok1 := st.PointIndex(pid)
		k, ok2 := st.SKUIndex(sku)
		if ok1 && ok2 {
			st.SetRaw(int(k), p, phys, res, listed)
		}
	}
	rows.Close()
	st.Unlock()
	var runs []*bench.Run
	brows, err := d.Pool.Query(ctx, `SELECT data FROM benchmarks ORDER BY started_at DESC LIMIT 200`)
	if err == nil {
		for brows.Next() {
			var b []byte
			if brows.Scan(&b) == nil {
				var r bench.Run
				if json.Unmarshal(b, &r) == nil {
					runs = append(runs, &r)
				}
			}
		}
		brows.Close()
	}
	s.BumpConfig()
	return s, runs, nil
}
