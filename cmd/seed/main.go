// Command seed generates the reproducible reference dataset, verifies it and
// writes it to PostgreSQL (DATABASE_URL) and/or CSV files.
//
//	go run ./cmd/seed -seed 42                       # verify only (in memory)
//	DATABASE_URL=postgres://… go run ./cmd/seed         # (re)initialise PostgreSQL
//	go run ./cmd/seed -db postgres://… -storage full    # store all 1.2M stock lines
//	go run ./cmd/seed -db postgres://… -if-empty        # only when the base is empty
//	go run ./cmd/seed -csv data/                     # export CSV
//
// The application performs the same initialisation automatically at its
// first connection to an empty database.
package main

import (
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/onestock/dp100ms/pkg/app"
	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/store"
)

func main() {
	cfg := datagen.DefaultConfig()
	flag.Int64Var(&cfg.Seed, "seed", cfg.Seed, "dataset seed")
	flag.IntVar(&cfg.Stores, "stores", cfg.Stores, "number of stores")
	flag.IntVar(&cfg.Warehouses, "warehouses", cfg.Warehouses, "number of warehouses")
	flag.IntVar(&cfg.LastMileHubs, "lmh", cfg.LastMileHubs, "number of last-mile hubs")
	flag.IntVar(&cfg.CatalogSize, "catalog", cfg.CatalogSize, "catalog size")
	flag.IntVar(&cfg.SKUsPerPoint, "skus-per-point", cfg.SKUsPerPoint, "listed SKUs per stock point")
	csvDir := flag.String("csv", "", "export CSV files to this directory")
	_, direct := app.DatabaseURLs()
	dbURL := flag.String("db", direct, "PostgreSQL URL (default $DATABASE_URL_UNPOOLED, $POSTGRES_URL_NON_POOLING, $DATABASE_URL or $POSTGRES_URL)")
	storage := flag.String("storage", app.StockStorage(), "stock storage: delta (changed lines only, default) or full (1.2M lines)")
	ifEmpty := flag.Bool("if-empty", false, "do nothing when the database is already initialised")
	flag.Parse()

	t0 := time.Now()
	s := datagen.Generate(cfg)
	log.Printf("generated in %v", time.Since(t0).Round(time.Millisecond))
	if err := verify(s, cfg); err != nil {
		log.Fatalf("verification failed: %v", err)
	}
	if *csvDir != "" {
		if err := exportCSV(s, *csvDir); err != nil {
			log.Fatal(err)
		}
	}
	if *dbURL != "" {
		t1 := time.Now()
		loaded, err := app.InitDatabase(context.Background(), *dbURL, cfg.Seed, *storage, !*ifEmpty)
		if err != nil {
			log.Fatalf("database: %v", err)
		}
		if loaded {
			log.Printf("database initialised in %v (stock storage %s)", time.Since(t1).Round(time.Millisecond), *storage)
		} else {
			log.Printf("database already initialised: nothing done")
		}
	}
}

func verify(s *store.Store, cfg datagen.Config) error {
	c := s.Counts()
	fmt.Printf("seed                %d\n", cfg.Seed)
	fmt.Printf("stock points        %d %v\n", c.StockPoints, c.StockPointsByType)
	fmt.Printf("catalog SKUs        %d\n", c.SKUs)
	fmt.Printf("stock lines         %d\n", c.StockLines)
	fmt.Printf("carriers / services %d / %d\n", c.Carriers, c.Services)
	fmt.Printf("hubs / legs / routes %d / %d / %d\n", c.Hubs, c.Legs, c.Routes)
	fmt.Printf("delivery modes      %d, scenarios %d\n", c.DeliveryModes, c.Scenarios)
	zero, partial, reserved := 0, 0, 0
	s.Stock.ForEachLine(func(l model.StockLine) {
		switch {
		case l.Physical == 0:
			zero++
		case l.Promisable < l.Physical:
			partial++
		}
		if l.Reserved > 0 {
			reserved++
		}
	})
	fmt.Printf("zero-stock lines    %d (%.1f%%)\n", zero, float64(zero)*100/float64(c.StockLines))
	fmt.Printf("partially promisable %d, with reservations %d\n", partial, reserved)
	want := (cfg.Stores + cfg.Warehouses + cfg.LastMileHubs) * cfg.SKUsPerPoint
	if c.StockLines != want {
		return fmt.Errorf("expected %d stock lines, got %d", want, c.StockLines)
	}
	if c.SKUs < cfg.SKUsPerPoint {
		return fmt.Errorf("catalog smaller than the per-point assortment")
	}
	if zero == 0 || partial == 0 {
		return fmt.Errorf("dataset has no zero or partial stock")
	}
	fmt.Println("verification        OK")
	return nil
}

func exportCSV(s *store.Store, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	write := func(name string, header []string, rows func(w *csv.Writer)) error {
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		defer f.Close()
		w := csv.NewWriter(f)
		_ = w.Write(header)
		rows(w)
		w.Flush()
		return w.Error()
	}
	if err := write("stock_points.csv", []string{"id", "name", "type", "postal_code", "city", "lat", "lon", "cutoff", "prep_minutes"}, func(w *csv.Writer) {
		for _, p := range s.StockPoints.All() {
			_ = w.Write([]string{p.ID, p.Name, string(p.Type), p.Address.PostalCode, p.Address.City, ftoa(p.Lat), ftoa(p.Lon), p.Cutoff.String(), strconv.Itoa(p.PrepTimeMinutes)})
		}
	}); err != nil {
		return err
	}
	if err := write("skus.csv", []string{"sku", "name", "category", "weight_kg", "volume_l"}, func(w *csv.Writer) {
		for _, k := range s.Stock.SKUs() {
			_ = w.Write([]string{k.Code, k.Name, k.Category, ftoa(k.WeightKg), ftoa(k.VolumeL)})
		}
	}); err != nil {
		return err
	}
	if err := write("legs.csv", []string{"id", "from", "to", "carrier", "service", "departures"}, func(w *csv.Writer) {
		for _, l := range s.Legs.All() {
			deps := ""
			for i, d := range l.Departures {
				if i > 0 {
					deps += " "
				}
				deps += d.String()
			}
			_ = w.Write([]string{l.ID, l.From, l.To, l.CarrierID, l.ServiceID, deps})
		}
	}); err != nil {
		return err
	}
	return write("stock_lines.csv", []string{"stockPointId", "sku", "physical", "reserved"}, func(w *csv.Writer) {
		s.Stock.ForEachLine(func(l model.StockLine) {
			_ = w.Write([]string{l.StockPointID, l.SKU, strconv.Itoa(l.Physical), strconv.Itoa(l.Reserved)})
		})
	})
}

func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
