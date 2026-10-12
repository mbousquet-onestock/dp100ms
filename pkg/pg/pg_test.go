package pg

import (
	"context"
	"os"
	"testing"

	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

// Integration test: requires TEST_DATABASE_URL (a disposable database).
func TestRoundTrip(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	cfg := datagen.DefaultConfig()
	cfg.Stores, cfg.Warehouses, cfg.LastMileHubs, cfg.SKUsPerPoint, cfg.CatalogSize, cfg.WarehouseCatalog = 10, 2, 2, 500, 600, 500
	s := datagen.Generate(cfg)
	if err := db.SaveAll(ctx, s, cfg, StockFull); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveEntity("carrier", "X", model.Carrier{ID: "X", Name: "X", Active: true}); err != nil {
		t.Fatal(err)
	}
	first, _, _ := s.Stock.Query(store.StockQuery{StockPointID: "STORE-001", OnlyListed: true, Limit: 1})
	sku := first[0].SKU
	_ = db.SaveStockLines([]model.StockLine{{StockPointID: "STORE-001", SKU: sku, Physical: 99, Listed: true}})
	loaded, _, err := db.LoadAll(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.StockPoints.Len() != 14 || loaded.Stock.LineCount() != 14*500 {
		t.Fatalf("loaded %d points, %d lines", loaded.StockPoints.Len(), loaded.Stock.LineCount())
	}
	if _, ok := loaded.Carriers.Get("X"); !ok {
		t.Fatal("carrier not persisted")
	}
	if l, _ := loaded.Stock.Line("STORE-001", sku); l.Physical != 99 {
		t.Fatalf("stock line not persisted: %+v", l)
	}
	if err := db.DeleteEntity("carrier", "X"); err != nil {
		t.Fatal(err)
	}
}

// Delta mode: only changed stock lines are stored; the baseline comes back
// from the seed.
func TestDeltaRoundTrip(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	cfg := datagen.DefaultConfig()
	cfg.Stores, cfg.Warehouses, cfg.LastMileHubs, cfg.SKUsPerPoint, cfg.CatalogSize, cfg.WarehouseCatalog = 10, 2, 2, 500, 600, 500
	s := datagen.Generate(cfg)
	if err := db.SaveAll(ctx, s, cfg, StockDelta); err != nil {
		t.Fatal(err)
	}
	m, _ := db.Meta(ctx)
	if m.StockMode != StockDelta || m.StockRows != 0 {
		t.Fatalf("meta %+v", m)
	}
	_ = db.SaveStockLines([]model.StockLine{{StockPointID: "STORE-002", SKU: "SKU-00003", Physical: 42, Listed: true}})
	ref, _ := s.Stock.Line("WH-01", "SKU-00010")
	loaded, _, err := db.LoadAll(ctx, func(st *store.Store, seed int64) {
		c := cfg
		c.Seed = seed
		datagen.FillStock(st, c)
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := loaded.Stock.Line("WH-01", "SKU-00010"); got != ref {
		t.Fatalf("baseline differs: %+v vs %+v", got, ref)
	}
	if got, _ := loaded.Stock.Line("STORE-002", "SKU-00003"); got.Physical != 42 {
		t.Fatalf("change lost: %+v", got)
	}
	if loaded.RateCards.Len() == 0 || loaded.StockViews.Len() == 0 {
		t.Fatal("pricing configuration not persisted")
	}
	k, _ := loaded.Stock.SKUIndex("SKU-00001")
	if sku := loaded.Stock.SKU(k); sku.LengthCm == 0 || sku.PriceEur == 0 {
		t.Fatalf("article dimensions lost: %+v", sku)
	}
}

// Two instances share the database: writes of one are applied by the other.
func TestSyncBetweenInstances(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	cfg := datagen.DefaultConfig()
	cfg.Stores, cfg.Warehouses, cfg.LastMileHubs, cfg.SKUsPerPoint, cfg.CatalogSize, cfg.WarehouseCatalog = 10, 2, 2, 500, 600, 500
	if err := db.SaveAll(ctx, datagen.Generate(cfg), cfg, StockFull); err != nil {
		t.Fatal(err)
	}
	seq, _ := db.LastSeq(ctx)
	a, _, err := db.LoadAll(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := db.LoadAll(ctx, nil)
	a.SetPersister(db)
	// instance A writes a zone, a carrier route, a stock line and deletes a carrier
	if err := a.Zones.Create(model.Zone{ID: "BZH", Name: "Bretagne", Departments: []string{"29"}, Active: true}); err != nil {
		t.Fatal(err)
	}
	a.CarrierRoutes.Put(model.CarrierRoute{ID: "R-BZH", CarrierID: "COLIVIA", ServiceID: "COLIVIA-STD", OriginZoneID: "FR", DestinationZoneID: "BZH", Active: true})
	if err := a.Carriers.Delete("NAVETTE"); err != nil {
		t.Fatal(err)
	}
	first, _, _ := a.Stock.Query(store.StockQuery{StockPointID: "STORE-002", OnlyListed: true, Limit: 1})
	sku := first[0].SKU
	if _, errs := a.Stock.Apply([]store.StockUpdate{{StockPointID: "STORE-002", SKU: sku, Physical: ip(41), Reserved: ip(1)}}); len(errs) > 0 {
		t.Fatal(errs)
	}
	l, _ := a.Stock.Line("STORE-002", sku)
	if err := db.SaveStockLines([]model.StockLine{l}); err != nil {
		t.Fatal(err)
	}
	if e := a.LastPersistError(); e != "" {
		t.Fatal(e)
	}
	v0 := b.ConfigVersion()
	res, err := db.Sync(ctx, b, seq)
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied < 4 || res.Reload || res.Seq <= seq || b.ConfigVersion() == v0 {
		t.Fatalf("sync %+v", res)
	}
	if _, ok := b.Zones.Get("BZH"); !ok {
		t.Fatal("zone not synced")
	}
	if _, ok := b.CarrierRoutes.Get("R-BZH"); !ok {
		t.Fatal("carrier route not synced")
	}
	if _, ok := b.Carriers.Get("NAVETTE"); ok {
		t.Fatal("deletion not synced")
	}
	if got, _ := b.Stock.Line("STORE-002", sku); got.Physical != 41 || got.Reserved != 1 {
		t.Fatalf("stock not synced: %+v", got)
	}
	// nothing new: no-op; a reseed asks for a reload
	if res2, _ := db.Sync(ctx, b, res.Seq); res2.Applied != 0 || res2.Seq != res.Seq {
		t.Fatalf("second sync %+v", res2)
	}
	if err := db.SaveAll(ctx, datagen.Generate(cfg), cfg, StockFull); err != nil {
		t.Fatal(err)
	}
	if res3, _ := db.Sync(ctx, b, res.Seq); !res3.Reload {
		t.Fatalf("reseed not detected: %+v", res3)
	}
}

func ip(i int) *int { return &i }
