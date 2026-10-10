package calendar

import (
	"math/rand"
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
)

// The fast clock must agree with the time-package implementation.
func TestFastClockMatchesSlow(t *testing.T) {
	loc := Paris()
	clk := ClockFor(loc)
	r := rand.New(rand.NewSource(1))
	cals := []*Cal{
		Compile(model.Calendar{WorkingDays: []int{1, 2, 3, 4, 5}, HonorHolidays: true}),
		Compile(model.Calendar{WorkingDays: []int{1, 2, 3, 4, 5, 6}, HonorHolidays: true}),
		Compile(model.Calendar{WorkingDays: []int{2, 3, 4, 5, 6}, HonorHolidays: false, ClosedDates: []string{"2026-12-24"}}),
		Always,
	}
	deps := [][]model.TimeOfDay{{model.MustTOD("17:00")}, {model.MustTOD("02:30"), model.MustTOD("12:00"), model.MustTOD("17:30")}, {model.MustTOD("00:00")}}
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, loc).Unix()
	for i := 0; i < 20000; i++ {
		u := start + r.Int63n(3*365*86400)
		tt := time.Unix(u, 0).In(loc)
		d, s := clk.Split(u)
		if d != DayOf(tt) || s != int64(tt.Hour()*3600+tt.Minute()*60+tt.Second()) {
			t.Fatalf("split %v: got day %d sec %d", tt, d, s)
		}
		tod := model.TimeOfDay(r.Intn(24 * 60))
		if got, want := clk.At(d, tod), d.At(tod, loc).Unix(); got != want {
			t.Fatalf("at %v %v: got %v want %v", tt, tod, time.Unix(got, 0).In(loc), time.Unix(want, 0).In(loc))
		}
		c := cals[r.Intn(len(cals))]
		if clk.Working(c, d) != c.IsWorking(d) {
			t.Fatalf("working %v", tt)
		}
		dp := deps[r.Intn(len(deps))]
		cut := r.Intn(60)
		g1, ok1 := clk.NextDeparture(c, u, dp, cut)
		w1, ok2 := NextDeparture(c, loc, tt, dp, cut)
		if ok1 != ok2 || (ok1 && g1 != w1.Unix()) {
			t.Fatalf("departure from %v: got %v want %v", tt, time.Unix(g1, 0).In(loc), w1)
		}
		open, close, cutoff := model.MustTOD("09:00"), model.MustTOD("19:00"), model.MustTOD("16:00")
		prep := 30 + r.Intn(600)
		g2, _ := clk.PreparationReady(c, u, open, close, cutoff, prep)
		w2, _ := PreparationReady(c, loc, tt, open, close, cutoff, prep)
		if g2 != w2.Unix() {
			t.Fatalf("prep from %v (%d min): got %v want %v", tt, prep, time.Unix(g2, 0).In(loc), w2)
		}
		g3, _ := clk.NextOpen(c, u, open, model.MustTOD("24:00"))
		w3, _ := NextOpen(c, loc, tt, open, model.MustTOD("24:00"))
		if g3 != w3.Unix() {
			t.Fatalf("open from %v: got %v want %v", tt, time.Unix(g3, 0).In(loc), w3)
		}
	}
}
