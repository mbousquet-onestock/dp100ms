// Package calendar implements French business-day arithmetic: public
// holidays, working weekdays, opening hours, cut-offs and scheduled
// departures. All computations happen in a single IANA time zone
// (Europe/Paris by default) and are allocation-free on the hot path.
package calendar

import (
	"sort"
	"sync"
	"time"
	_ "time/tzdata" // embedded zoneinfo: serverless runtimes may lack it

	"github.com/onestock/dp100ms/pkg/model"
)

const searchHorizonDays = 30

var (
	parisOnce sync.Once
	paris     *time.Location
)

// Paris returns the Europe/Paris location.
func Paris() *time.Location {
	parisOnce.Do(func() {
		l, err := time.LoadLocation("Europe/Paris")
		if err != nil {
			panic(err)
		}
		paris = l
	})
	return paris
}

// Day is a civil date encoded as days since 1970-01-01.
type Day int32

func DayOf(t time.Time) Day {
	y, m, d := t.Date()
	return civilToDay(y, m, d)
}

func civilToDay(y int, m time.Month, d int) Day {
	return Day(time.Date(y, m, d, 12, 0, 0, 0, time.UTC).Unix() / 86400)
}

func (d Day) Civil() (int, time.Month, int) {
	return time.Unix(int64(d)*86400+43200, 0).UTC().Date()
}

func (d Day) Weekday() time.Weekday { return time.Weekday((int(d) + 4) % 7) } // 1970-01-01 was a Thursday

// At returns the instant at a local wall-clock time on day d.
func (d Day) At(tod model.TimeOfDay, loc *time.Location) time.Time {
	y, m, dd := d.Civil()
	return time.Date(y, m, dd, int(tod)/60, int(tod)%60, 0, 0, loc)
}

func minuteOfDay(t time.Time) model.TimeOfDay {
	return model.TimeOfDay(t.Hour()*60 + t.Minute())
}

// ---------------------------------------------------------------------------
// French public holidays

var holidayCache sync.Map // year -> map[Day]string

func easterSunday(y int) (time.Month, int) {
	// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
	a := y % 19
	b := y / 100
	c := y % 100
	d := b / 4
	e := b % 4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i := c / 4
	k := c % 4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := ((h + l - 7*m + 114) % 31) + 1
	return time.Month(month), day
}

// Holidays returns the French metropolitan public holidays of a year.
func Holidays(y int) map[Day]string {
	if v, ok := holidayCache.Load(y); ok {
		return v.(map[Day]string)
	}
	h := map[Day]string{
		civilToDay(y, time.January, 1):   "Jour de l'an",
		civilToDay(y, time.May, 1):       "Fête du Travail",
		civilToDay(y, time.May, 8):       "Victoire 1945",
		civilToDay(y, time.July, 14):     "Fête nationale",
		civilToDay(y, time.August, 15):   "Assomption",
		civilToDay(y, time.November, 1):  "Toussaint",
		civilToDay(y, time.November, 11): "Armistice 1918",
		civilToDay(y, time.December, 25): "Noël",
	}
	em, ed := easterSunday(y)
	easter := civilToDay(y, em, ed)
	h[easter+1] = "Lundi de Pâques"
	h[easter+39] = "Ascension"
	h[easter+50] = "Lundi de Pentecôte"
	holidayCache.Store(y, h)
	return h
}

// IsHoliday reports whether d is a French public holiday.
func IsHoliday(d Day) bool {
	y, _, _ := d.Civil()
	_, ok := Holidays(y)[d]
	return ok
}

// HolidayList returns sorted holidays for the API.
func HolidayList(y int) []struct {
	Date string `json:"date"`
	Name string `json:"name"`
} {
	h := Holidays(y)
	out := make([]struct {
		Date string `json:"date"`
		Name string `json:"name"`
	}, 0, len(h))
	for d, n := range h {
		yy, mm, dd := d.Civil()
		out = append(out, struct {
			Date string `json:"date"`
			Name string `json:"name"`
		}{time.Date(yy, mm, dd, 0, 0, 0, 0, time.UTC).Format("2006-01-02"), n})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out
}

// ---------------------------------------------------------------------------
// Compiled calendars

// Cal is a compiled calendar: a weekday bitmask, a holiday flag and a set of
// closed dates. It is immutable and safe for concurrent use.
type Cal struct {
	mask     uint8
	holidays bool
	closed   map[Day]struct{}
}

// Compile turns a model.Calendar into a Cal. Invalid dates are ignored.
func Compile(c model.Calendar) *Cal {
	cal := &Cal{mask: c.Mask(), holidays: c.HonorHolidays}
	if len(c.ClosedDates) > 0 {
		cal.closed = make(map[Day]struct{}, len(c.ClosedDates))
		for _, s := range c.ClosedDates {
			if t, err := time.Parse("2006-01-02", s); err == nil {
				cal.closed[DayOf(t)] = struct{}{}
			}
		}
	}
	return cal
}

// Always is a calendar open every day.
var Always = &Cal{mask: 0x7f}

func (c *Cal) IsWorking(d Day) bool {
	if c.mask&(1<<uint(d.Weekday())) == 0 {
		return false
	}
	if c.holidays && IsHoliday(d) {
		return false
	}
	if c.closed != nil {
		if _, ok := c.closed[d]; ok {
			return false
		}
	}
	return true
}

// NextWorkingDay returns the first working day >= d (or d+horizon).
func (c *Cal) NextWorkingDay(d Day) (Day, bool) {
	for i := 0; i < searchHorizonDays; i++ {
		if c.IsWorking(d + Day(i)) {
			return d + Day(i), true
		}
	}
	return d, false
}

// AddWorkingDays returns the n-th working day strictly after d (n = 0 returns
// the first working day >= d).
func (c *Cal) AddWorkingDays(d Day, n int) (Day, bool) {
	cur, ok := c.NextWorkingDay(d)
	if !ok {
		return d, false
	}
	for n > 0 {
		cur, ok = c.NextWorkingDay(cur + 1)
		if !ok {
			return d, false
		}
		n--
	}
	return cur, true
}

// ---------------------------------------------------------------------------
// Time arithmetic

// PreparationReady computes when a preparation started by an order placed
// at t is ready: orders after the cut-off (or outside working days) start
// at the next opening; preparation consumes working minutes within opening
// hours and spills over to the next working day if needed.
func PreparationReady(c *Cal, loc *time.Location, t time.Time, open, close, cutoff model.TimeOfDay, prepMinutes int) (time.Time, bool) {
	t = t.In(loc)
	day := DayOf(t)
	mod := minuteOfDay(t)
	var start time.Time
	if c.IsWorking(day) && mod <= cutoff && mod < close {
		if mod < open {
			start = day.At(open, loc)
		} else {
			start = t
		}
	} else {
		nd, ok := c.NextWorkingDay(day + 1)
		if !ok {
			return time.Time{}, false
		}
		start = nd.At(open, loc)
	}
	return addWorkingMinutes(c, loc, start, prepMinutes, open, close)
}

func addWorkingMinutes(c *Cal, loc *time.Location, start time.Time, minutes int, open, close model.TimeOfDay) (time.Time, bool) {
	cur := start
	remaining := time.Duration(minutes) * time.Minute
	for i := 0; i < searchHorizonDays; i++ {
		day := DayOf(cur)
		end := day.At(close, loc)
		avail := end.Sub(cur)
		if remaining <= avail {
			return cur.Add(remaining), true
		}
		if avail > 0 {
			remaining -= avail
		}
		nd, ok := c.NextWorkingDay(day + 1)
		if !ok {
			return time.Time{}, false
		}
		cur = nd.At(open, loc)
	}
	return time.Time{}, false
}

// NextDeparture returns the first scheduled departure on a working day such
// that ready <= departure - cutoffBefore. departures must be sorted.
func NextDeparture(c *Cal, loc *time.Location, ready time.Time, departures []model.TimeOfDay, cutoffBefore int) (time.Time, bool) {
	ready = ready.In(loc)
	day := DayOf(ready)
	mod := int(minuteOfDay(ready))
	if ready.Second() > 0 || ready.Nanosecond() > 0 {
		mod++
	}
	for i := 0; i < searchHorizonDays; i++ {
		d := day + Day(i)
		if !c.IsWorking(d) {
			continue
		}
		for _, dep := range departures {
			if i == 0 && int(dep)-cutoffBefore < mod {
				continue
			}
			return d.At(dep, loc), true
		}
	}
	return time.Time{}, false
}

// NextOpen returns the earliest instant >= t within opening hours of a
// working day (used for hub reception).
func NextOpen(c *Cal, loc *time.Location, t time.Time, open, close model.TimeOfDay) (time.Time, bool) {
	t = t.In(loc)
	day := DayOf(t)
	mod := minuteOfDay(t)
	if c.IsWorking(day) && mod < close {
		if mod < open {
			return day.At(open, loc), true
		}
		return t, true
	}
	nd, ok := c.NextWorkingDay(day + 1)
	if !ok {
		return time.Time{}, false
	}
	return nd.At(open, loc), true
}
