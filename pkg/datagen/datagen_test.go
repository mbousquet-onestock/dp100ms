package datagen

import (
	"testing"

	"github.com/onestock/dp100ms/pkg/model"
)

func TestReferenceVolumes(t *testing.T) {
	s := Generate(DefaultConfig())
	c := s.Counts()
	if c.StockPointsByType["STORE"] != 100 || c.StockPointsByType["WAREHOUSE"] != 10 || c.StockPointsByType["LAST_MILE_HUB"] != 10 {
		t.Fatalf("unexpected stock points %+v", c.StockPointsByType)
	}
	if c.SKUs < 10000 {
		t.Fatalf("catalog must hold at least 10,000 SKUs, got %d", c.SKUs)
	}
	if c.StockLines != 1_200_000 {
		t.Fatalf("expected 1,200,000 stock lines, got %d", c.StockLines)
	}
	for _, p := range s.StockPoints.All() {
		sum, _ := s.Stock.Summary(p.ID)
		if sum.Listed != 10000 {
			t.Fatalf("%s lists %d SKUs, want 10000", p.ID, sum.Listed)
		}
		if sum.OutOfStock == 0 {
			t.Errorf("%s has no out-of-stock line: data too ideal", p.ID)
		}
		if p.Lat < 41 || p.Lat > 51.5 || p.Lon < -5 || p.Lon > 10 {
			t.Errorf("%s outside metropolitan France", p.ID)
		}
	}
	cities := map[string]bool{}
	for _, p := range s.StockPoints.All() {
		cities[p.Address.City] = true
	}
	for _, c := range []string{"Paris", "Lyon", "Marseille", "Bordeaux", "Lille", "Toulouse", "Nantes", "Strasbourg", "Nice", "Rennes"} {
		if !cities[c] {
			t.Errorf("missing agglomeration %s", c)
		}
	}
	if s.Carriers.Len() < 3 || s.Services.Len() < 6 || s.Legs.Len() < 300 || s.Routes.Len() == 0 {
		t.Errorf("network too small: %+v", c)
	}
	multi := 0
	for _, l := range s.Legs.All() {
		if l.To != model.CustomerNode {
			multi++
		}
	}
	if multi == 0 {
		t.Error("no transit legs: multi-leg routes impossible")
	}
}

func TestReproducible(t *testing.T) {
	a := Generate(DefaultConfig())
	b := Generate(DefaultConfig())
	cfg := DefaultConfig()
	cfg.Seed = 7
	c := Generate(cfg)
	same, diff := true, false
	for _, p := range []string{"STORE-001", "WH-03", "LMH-07"} {
		for _, k := range []string{"SKU-00001", "SKU-05000", "SKU-11999"} {
			la, _ := a.Stock.Line(p, k)
			lb, _ := b.Stock.Line(p, k)
			lc, _ := c.Stock.Line(p, k)
			if la != lb {
				same = false
			}
			if la != lc {
				diff = true
			}
		}
	}
	if !same {
		t.Fatal("same seed must give the same stock")
	}
	if !diff {
		t.Fatal("another seed should change the stock")
	}
	if len(a.Legs.All()) != len(b.Legs.All()) || a.Routes.All()[0].Name != b.Routes.All()[0].Name {
		t.Fatal("network not reproducible")
	}
}
