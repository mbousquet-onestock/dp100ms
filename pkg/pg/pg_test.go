package pg

import (
	"context"
	"os"
	"testing"

	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/model"
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
	if err := db.SaveAll(ctx, s, cfg); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveEntity("carrier", "X", model.Carrier{ID: "X", Name: "X", Active: true}); err != nil {
		t.Fatal(err)
	}
	_ = db.SaveStockLines([]model.StockLine{{StockPointID: "STORE-001", SKU: "SKU-00001", Physical: 99, Listed: true}})
	loaded, _, err := db.LoadAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.StockPoints.Len() != 14 || loaded.Stock.LineCount() != 14*500 {
		t.Fatalf("loaded %d points, %d lines", loaded.StockPoints.Len(), loaded.Stock.LineCount())
	}
	if _, ok := loaded.Carriers.Get("X"); !ok {
		t.Fatal("carrier not persisted")
	}
	if l, _ := loaded.Stock.Line("STORE-001", "SKU-00001"); l.Physical != 99 {
		t.Fatalf("stock line not persisted: %+v", l)
	}
	if err := db.DeleteEntity("carrier", "X"); err != nil {
		t.Fatal(err)
	}
}
