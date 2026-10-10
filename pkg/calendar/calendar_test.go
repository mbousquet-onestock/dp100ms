package calendar

import (
	"testing"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
)

func d(y int, m time.Month, dd int) Day { return civilToDay(y, m, dd) }

func TestFrenchHolidays2026(t *testing.T) {
	want := []Day{d(2026, 1, 1), d(2026, 4, 6), d(2026, 5, 1), d(2026, 5, 8), d(2026, 5, 14), d(2026, 5, 25),
		d(2026, 7, 14), d(2026, 8, 15), d(2026, 11, 1), d(2026, 11, 11), d(2026, 12, 25)}
	h := Holidays(2026)
	if len(h) != 11 {
		t.Fatalf("expected 11 holidays, got %d", len(h))
	}
	for _, w := range want {
		if !IsHoliday(w) {
			y, m, dd := w.Civil()
			t.Errorf("%d-%02d-%02d should be a holiday", y, m, dd)
		}
	}
	if IsHoliday(d(2026, 4, 5)) {
		t.Error("Easter Sunday is not listed as a separate holiday")
	}
}

func TestEaster(t *testing.T) {
	cases := map[int][2]int{2024: {3, 31}, 2025: {4, 20}, 2026: {4, 5}, 2027: {3, 28}}
	for y, md := range cases {
		m, dd := easterSunday(y)
		if int(m) != md[0] || dd != md[1] {
			t.Errorf("easter %d = %d/%d, want %d/%d", y, dd, m, md[1], md[0])
		}
	}
}

func TestWeekday(t *testing.T) {
	if d(2026, 10, 12).Weekday() != time.Monday {
		t.Fatal("2026-10-12 is a Monday")
	}
}

func TestAddWorkingDays(t *testing.T) {
	c := Compile(model.Calendar{WorkingDays: []int{1, 2, 3, 4, 5}, HonorHolidays: true})
	// Friday 16/10 + 1 working day = Monday 19/10
	got, _ := c.AddWorkingDays(d(2026, 10, 16), 1)
	if got != d(2026, 10, 19) {
		y, m, dd := got.Civil()
		t.Fatalf("got %d-%d-%d", y, m, dd)
	}
	// Tuesday 10/11 + 1 = Thursday 12/11 (Armistice)
	got, _ = c.AddWorkingDays(d(2026, 11, 10), 1)
	if got != d(2026, 11, 12) {
		t.Fatal("holiday not skipped")
	}
	// 0 on a Saturday = Monday
	got, _ = c.AddWorkingDays(d(2026, 10, 17), 0)
	if got != d(2026, 10, 19) {
		t.Fatal("0 days from a non working day must move to the next working day")
	}
}

func TestPreparationReady(t *testing.T) {
	loc := Paris()
	c := Compile(model.Calendar{WorkingDays: []int{1, 2, 3, 4, 5, 6}, HonorHolidays: true})
	open, close, cutoff := model.MustTOD("09:00"), model.MustTOD("19:00"), model.MustTOD("16:00")
	cases := []struct {
		order time.Time
		prep  int
		want  time.Time
	}{
		{time.Date(2026, 10, 12, 10, 0, 0, 0, loc), 60, time.Date(2026, 10, 12, 11, 0, 0, 0, loc)},   // nominal
		{time.Date(2026, 10, 12, 7, 0, 0, 0, loc), 60, time.Date(2026, 10, 12, 10, 0, 0, 0, loc)},    // before opening
		{time.Date(2026, 10, 12, 16, 30, 0, 0, loc), 60, time.Date(2026, 10, 13, 10, 0, 0, 0, loc)},  // after cut-off
		{time.Date(2026, 10, 12, 15, 30, 0, 0, loc), 240, time.Date(2026, 10, 13, 9, 30, 0, 0, loc)}, // spills over (210 min on day 1)
		{time.Date(2026, 10, 17, 18, 0, 0, 0, loc), 60, time.Date(2026, 10, 19, 10, 0, 0, 0, loc)},   // Saturday evening -> Monday
		{time.Date(2026, 10, 31, 17, 0, 0, 0, loc), 60, time.Date(2026, 11, 2, 10, 0, 0, 0, loc)},    // Toussaint is a Sunday in 2026
	}
	for i, tc := range cases {
		got, ok := PreparationReady(c, loc, tc.order, open, close, cutoff, tc.prep)
		if !ok || !got.Equal(tc.want) {
			t.Errorf("case %d: got %v want %v", i, got, tc.want)
		}
	}
}

func TestNextDeparture(t *testing.T) {
	loc := Paris()
	c := Compile(model.Calendar{WorkingDays: []int{1, 2, 3, 4, 5}, HonorHolidays: true})
	deps := []model.TimeOfDay{model.MustTOD("12:00"), model.MustTOD("17:30")}
	got, _ := NextDeparture(c, loc, time.Date(2026, 10, 12, 11, 50, 0, 0, loc), deps, 15)
	if !got.Equal(time.Date(2026, 10, 12, 17, 30, 0, 0, loc)) {
		t.Errorf("cut-off before departure ignored: %v", got)
	}
	got, _ = NextDeparture(c, loc, time.Date(2026, 10, 16, 18, 0, 0, 0, loc), deps, 0)
	if !got.Equal(time.Date(2026, 10, 19, 12, 0, 0, 0, loc)) {
		t.Errorf("weekend not skipped: %v", got)
	}
}

func TestDSTTransition(t *testing.T) {
	loc := Paris()
	c := Compile(model.Calendar{WorkingDays: []int{1, 2, 3, 4, 5, 6, 7}})
	// 25/10/2026: switch to winter time; a 17:00 departure stays 17:00 local
	got, _ := NextDeparture(c, loc, time.Date(2026, 10, 25, 1, 0, 0, 0, loc), []model.TimeOfDay{model.MustTOD("17:00")}, 0)
	if got.Hour() != 17 || got.Day() != 25 {
		t.Errorf("got %v", got)
	}
	_, off := got.Zone()
	if off != 3600 {
		t.Errorf("expected CET (+01:00) after the DST switch, got %d", off)
	}
}
