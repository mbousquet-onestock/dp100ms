package pg

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

// Change is a row of the change log.
type Change struct {
	Seq  int64
	Kind string
	ID   string
	Op   string
}

// LastSeq returns the last change sequence number (0 when empty).
func (d *DB) LastSeq(ctx context.Context) (int64, error) {
	var seq int64
	err := d.Pool.QueryRow(ctx, `SELECT COALESCE(max(seq), 0) FROM change_log`).Scan(&seq)
	return seq, err
}

// SyncResult summarises a synchronisation.
type SyncResult struct {
	Seq     int64 // last sequence applied
	Applied int   // changes applied
	Reload  bool  // the dataset was replaced (reseed): reload everything
}

// Sync applies to the store the changes written by other instances since
// seq: configuration entities, stock lines and articles. A dataset reload
// (reseed) is reported instead of applied.
func (d *DB) Sync(ctx context.Context, s *store.Store, seq int64) (SyncResult, error) {
	res := SyncResult{Seq: seq}
	rows, err := d.Pool.Query(ctx, `SELECT seq, kind, id, op FROM change_log WHERE seq > $1 ORDER BY seq LIMIT 20000`, seq)
	if err != nil {
		return res, err
	}
	var changes []Change
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.Seq, &c.Kind, &c.ID, &c.Op); err != nil {
			rows.Close()
			return res, err
		}
		changes = append(changes, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(changes) == 0 {
		return res, err
	}
	last := changes[len(changes)-1].Seq
	// latest operation per entity; stock keys and articles to reload
	type key struct{ kind, id string }
	latest := map[key]Change{}
	var order []key
	stockKeys := map[string]bool{}
	stockAll := false
	skus := map[string]bool{}
	for _, c := range changes {
		switch c.Kind {
		case "dataset":
			res.Reload, res.Seq = true, last
			return res, nil
		case "stock":
			stockKeys[c.ID] = true
		case "stock_all":
			stockAll = true
		case "sku":
			skus[c.ID] = true
		case "benchmark":
		default:
			k := key{c.Kind, c.ID}
			if _, ok := latest[k]; !ok {
				order = append(order, k)
			}
			latest[k] = c
		}
	}
	for _, k := range order {
		c := latest[k]
		var data []byte
		if c.Op != "delete" {
			t, ok := tables[k.kind]
			if !ok {
				continue
			}
			if err := d.Pool.QueryRow(ctx, `SELECT data FROM `+t+` WHERE id = $1`, k.id).Scan(&data); err != nil {
				data = nil // deleted since
			}
		}
		if _, err := s.ApplyRemote(k.kind, k.id, data); err != nil {
			return res, err
		}
		res.Applied++
	}
	for code := range skus {
		var k model.SKU
		var attrs []byte
		err := d.Pool.QueryRow(ctx, `SELECT code, name, category, weight_kg::float8, volume_l::float8, length_cm::float8, width_cm::float8, height_cm::float8, price_eur::float8, attributes FROM skus WHERE code = $1`, code).
			Scan(&k.Code, &k.Name, &k.Category, &k.WeightKg, &k.VolumeL, &k.LengthCm, &k.WidthCm, &k.HeightCm, &k.PriceEur, &attrs)
		if err != nil {
			continue
		}
		if len(attrs) > 0 {
			_ = json.Unmarshal(attrs, &k.Attributes)
		}
		if s.Stock.UpdateSKU(k) == nil {
			s.BumpConfig()
			res.Applied++
		}
	}
	if stockAll || len(stockKeys) > 0 {
		q := `SELECT stock_point_id, sku, physical, reserved, listed FROM stock_lines`
		var args []any
		if !stockAll {
			points, codes := make([]string, 0, len(stockKeys)), make([]string, 0, len(stockKeys))
			for k := range stockKeys {
				p, c, _ := strings.Cut(k, "|")
				points, codes = append(points, p), append(codes, c)
			}
			q += ` WHERE (stock_point_id, sku) IN (SELECT * FROM unnest($1::text[], $2::text[]))`
			args = []any{points, codes}
		}
		rows, err := d.Pool.Query(ctx, q, args...)
		if err != nil {
			return res, err
		}
		var ups []store.StockUpdate
		for rows.Next() {
			var p, c string
			var phys, resv int
			var listed bool
			if err := rows.Scan(&p, &c, &phys, &resv, &listed); err != nil {
				rows.Close()
				return res, err
			}
			ph, rv, li := phys, resv, listed
			ups = append(ups, store.StockUpdate{StockPointID: p, SKU: c, Physical: &ph, Reserved: &rv, Listed: &li})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return res, err
		}
		n, _ := s.Stock.Apply(ups)
		res.Applied += n
	}
	res.Seq = last
	return res, nil
}

// PruneChanges removes change log rows older than the retention (instances
// sync every second; a month is far beyond any instance lifetime gap).
func (d *DB) PruneChanges(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM change_log WHERE at < now() - interval '30 days'`)
	return err
}
