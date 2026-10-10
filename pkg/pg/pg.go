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
	"stock_point":   "stock_points",
	"carrier":       "carriers",
	"service":       "carrier_services",
	"hub":           "hubs",
	"leg":           "legs",
	"route":         "routes",
	"delivery_mode": "delivery_modes",
	"scenario":      "scenarios",
	"benchmark":     "benchmarks",
	"settings":      "settings",
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

// IsEmpty reports whether the dataset has never been seeded.
func (d *DB) IsEmpty(ctx context.Context) (bool, error) {
	var n int
	if err := d.Pool.QueryRow(ctx, `SELECT count(*) FROM skus`).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

// SaveAll replaces the whole dataset (seed). Stock lines use COPY.
func (d *DB) SaveAll(ctx context.Context, s *store.Store, cfg any) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `TRUNCATE stock_lines, skus, stock_points, carriers, carrier_services, hubs, legs, routes, delivery_modes, scenarios, settings, dataset_meta`); err != nil {
		return err
	}
	insert := func(table string, id string, v any) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO `+table+` (id, data) VALUES ($1, $2)`, id, b)
		return err
	}
	for _, v := range s.StockPoints.All() {
		if err := insert("stock_points", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Carriers.All() {
		if err := insert("carriers", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Services.All() {
		if err := insert("carrier_services", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Hubs.All() {
		if err := insert("hubs", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Legs.All() {
		if err := insert("legs", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Routes.All() {
		if err := insert("routes", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Modes.All() {
		if err := insert("delivery_modes", v.ID, v); err != nil {
			return err
		}
	}
	for _, v := range s.Scenarios.All() {
		if err := insert("scenarios", v.ID, v); err != nil {
			return err
		}
	}
	if err := insert("settings", "engine", s.Settings()); err != nil {
		return err
	}
	cb, _ := json.Marshal(cfg)
	if _, err := tx.Exec(ctx, `INSERT INTO dataset_meta (id, seed, config) VALUES (1, $1, $2)`, s.Seed, cb); err != nil {
		return err
	}
	skus := s.Stock.SKUs()
	rows := make([][]any, len(skus))
	for i, k := range skus {
		rows[i] = []any{i, k.Code, k.Name, k.Category, k.WeightKg, k.VolumeL}
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"skus"}, []string{"position", "code", "name", "category", "weight_kg", "volume_l"}, pgx.CopyFromRows(rows)); err != nil {
		return err
	}
	lines := make([][]any, 0, 1_200_000)
	s.Stock.ForEachLine(func(l model.StockLine) {
		lines = append(lines, []any{l.StockPointID, l.SKU, int32(l.Physical), int32(l.Reserved), l.Listed})
	})
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"stock_lines"}, []string{"stock_point_id", "sku", "physical", "reserved", "listed"}, pgx.CopyFromRows(lines)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// LoadAll builds a store from the database.
func (d *DB) LoadAll(ctx context.Context) (*store.Store, []*bench.Run, error) {
	s := store.New()
	type loader struct {
		table string
		fn    func([]byte) error
	}
	loaders := []loader{
		{"delivery_modes", s.Modes.LoadJSON}, {"carriers", s.Carriers.LoadJSON}, {"carrier_services", s.Services.LoadJSON},
		{"stock_points", s.StockPoints.LoadJSON}, {"hubs", s.Hubs.LoadJSON}, {"legs", s.Legs.LoadJSON},
		{"routes", s.Routes.LoadJSON}, {"scenarios", s.Scenarios.LoadJSON},
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
	_ = d.Pool.QueryRow(ctx, `SELECT seed FROM dataset_meta WHERE id=1`).Scan(&s.Seed)
	rows, err := d.Pool.Query(ctx, `SELECT code, name, category, weight_kg::float8, volume_l::float8 FROM skus ORDER BY position`)
	if err != nil {
		return nil, nil, err
	}
	var skus []model.SKU
	for rows.Next() {
		var k model.SKU
		if err := rows.Scan(&k.Code, &k.Name, &k.Category, &k.WeightKg, &k.VolumeL); err != nil {
			rows.Close()
			return nil, nil, err
		}
		skus = append(skus, k)
	}
	rows.Close()
	s.InitStock(skus)
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
