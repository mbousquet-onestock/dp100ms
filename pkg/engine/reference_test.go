package engine_test

import (
	"sort"
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/bench"
	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/engine"
)

// TestReferenceDatasetInvariants runs varied generated baskets on the full
// reference dataset (120 points, 1.2M lines) and checks every invariant on
// every option. It also reports the in-process computation latency.
func TestReferenceDatasetInvariants(t *testing.T) {
	if testing.Short() {
		t.Skip("reference dataset")
	}
	s := datagen.Generate(datagen.DefaultConfig())
	f := &fixture{s: s, e: engine.New(s)}
	baskets := bench.GenerateBaskets(s, bench.BasketProfile{Count: 400, Seed: 3, SpreadOrderDates: true})
	var lat []float64
	cats := map[string]int{}
	withOptions, consolidated := 0, 0
	for _, b := range baskets {
		r := b.Request
		t0 := time.Now()
		resp, err := f.e.Promise(&r)
		if err != nil {
			t.Fatalf("%v: %v", r, err)
		}
		lat = append(lat, float64(time.Since(t0).Microseconds())/1000)
		checkInvariants(t, f, &r, resp, nil)
		cats[b.Category]++
		if len(resp.Options) > 0 {
			withOptions++
		}
		for _, o := range resp.Options {
			if o.Strategy == "CONSOLIDATED" {
				consolidated++
				break
			}
		}
		if b.Category == bench.CatMultiSource || b.Category == bench.CatConsolidation {
			for _, o := range resp.Options {
				if len(sources(o)) < 2 {
					t.Errorf("multi-source basket served by a single source: %v", sources(o))
				}
			}
		}
	}
	sort.Float64s(lat)
	t.Logf("baskets=%v withOptions=%d consolidated=%d engine latency p50=%.2fms p95=%.2fms p99=%.2fms max=%.2fms",
		cats, withOptions, consolidated, lat[len(lat)/2], lat[len(lat)*95/100], lat[len(lat)*99/100], lat[len(lat)-1])
	if withOptions < len(baskets)*8/10 {
		t.Errorf("only %d/%d baskets got an option", withOptions, len(baskets))
	}
	if consolidated == 0 {
		t.Error("no consolidated option on the reference dataset")
	}
}

func BenchmarkPromiseReference(b *testing.B) {
	s := datagen.Generate(datagen.DefaultConfig())
	e := engine.New(s)
	baskets := bench.GenerateBaskets(s, bench.BasketProfile{Count: 1000, Seed: 5})
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r := baskets[i%len(baskets)].Request
		if _, err := e.Promise(&r); err != nil {
			b.Fatal(err)
		}
	}
}
