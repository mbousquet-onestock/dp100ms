package engine_test

import (
	"os"
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/bench"
	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/engine"
	"github.com/onestock/dp100ms/pkg/model"
)

// TestHeuristicQuality compares the bounded search with an exhaustive
// candidate evaluation (MaxCandidates = 1000, wider beam) on the reference
// dataset: earliest promise per mode and best score. Run with
// QUALITY=1 go test -run HeuristicQuality -v ./pkg/engine/
func TestHeuristicQuality(t *testing.T) {
	if os.Getenv("QUALITY") == "" {
		t.Skip("set QUALITY=1")
	}
	s := datagen.Generate(datagen.DefaultConfig())
	baskets := bench.GenerateBaskets(s, bench.BasketProfile{Count: 500, Seed: 11, SpreadOrderDates: true})
	var lastDur time.Duration
	run := func(set func(*model.EngineSettings)) []map[string]int64 {
		t0 := time.Now()
		defer func() { lastDur = time.Since(t0) / time.Duration(len(baskets)) }()
		st := s.Settings()
		set(&st)
		s.SetSettings(st)
		e := engine.New(s)
		out := make([]map[string]int64, len(baskets))
		for i, b := range baskets {
			r := b.Request
			r.MaxOptions = 50
			resp, err := e.Promise(&r)
			if err != nil {
				t.Fatal(err)
			}
			best := map[string]int64{}
			for _, o := range resp.Options {
				u := o.EstimatedDelivery.To.Unix()
				if v, ok := best[o.DeliveryMode]; !ok || u < v {
					best[o.DeliveryMode] = u
				}
			}
			out[i] = best
		}
		return out
	}
	ref := run(func(st *model.EngineSettings) { st.MaxCandidates = 1000; st.BeamWidth = 16; st.MaxAllocations = 40 })
	type variant struct{ cand, beam, alloc int }
	for _, v := range []variant{{32, 6, 12}, {48, 6, 12}, {48, 8, 20}, {48, 10, 24}, {48, 16, 40}} {
		cap := v.cand
		got := run(func(st *model.EngineSettings) {
			st.MaxCandidates = v.cand
			st.BeamWidth = v.beam
			st.MaxAllocations = v.alloc
		})
		same, later, missing, total := 0, 0, 0, 0
		var lateHours float64
		for i := range ref {
			for mode, u := range ref[i] {
				total++
				g, ok := got[i][mode]
				switch {
				case !ok:
					missing++
				case g == u:
					same++
				case g > u:
					later++
					lateHours += float64(g-u) / 3600
				}
			}
		}
		avg := 0.0
		if later > 0 {
			avg = lateHours / float64(later)
		}
		t.Logf("%v/req beam=%d alloc=%d maxCandidates=%d: earliest promise identical for %d/%d mode-baskets (%.1f%%), later %d (avg +%.1f h), mode lost %d",
			lastDur, v.beam, v.alloc, cap, same, total, float64(same)*100/float64(total), later, avg, missing)
	}
}
