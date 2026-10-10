package calendar

import (
	"sync"
	"time"

	"github.com/onestock/dp100ms/pkg/model"
)

// Fast integer clock. Instants are Unix seconds (int64). A per-day table
// built once for 2015-2045 gives the Unix time of local midnight and the DST
// transition of the day, so local date / time-of-day conversions are a
// couple of array reads instead of time.Date calls. Holidays are a bitmap
// over the same range. Outside the range, the slow time package is used.

const (
	clockFirstYear = 2015
	clockLastYear  = 2045
)

type dayInfo struct {
	start int64 // unix time of local 00:00
	trans int64 // unix time of the DST transition (0 = none)
	delta int64 // offset after - offset before (seconds)
}

// Clock converts between Unix seconds and local civil time for one zone.
type Clock struct {
	loc     *time.Location
	base    Day
	days    []dayInfo
	holiday []bool
}

var (
	clockMu    sync.Mutex
	clockCache = map[*time.Location]*Clock{}
)

// ClockFor returns the (cached) clock of a location.
func ClockFor(loc *time.Location) *Clock {
	clockMu.Lock()
	defer clockMu.Unlock()
	if c, ok := clockCache[loc]; ok {
		return c
	}
	c := buildClock(loc)
	clockCache[loc] = c
	return c
}

func buildClock(loc *time.Location) *Clock {
	first := civilToDay(clockFirstYear, time.January, 1)
	last := civilToDay(clockLastYear, time.December, 31)
	n := int(last-first) + 2
	c := &Clock{loc: loc, base: first, days: make([]dayInfo, n), holiday: make([]bool, n)}
	for i := 0; i < n; i++ {
		d := first + Day(i)
		y, m, dd := d.Civil()
		t0 := time.Date(y, m, dd, 0, 0, 0, 0, loc)
		t1 := time.Date(y, m, dd+1, 0, 0, 0, 0, loc)
		info := dayInfo{start: t0.Unix()}
		_, off0 := t0.Zone()
		_, off1 := t1.Zone()
		if off0 != off1 {
			// binary search the transition second
			lo, hi := t0.Unix(), t1.Unix()
			for hi-lo > 1 {
				mid := (lo + hi) / 2
				if _, o := time.Unix(mid, 0).In(loc).Zone(); o == off0 {
					lo = mid
				} else {
					hi = mid
				}
			}
			info.trans = hi
			info.delta = int64(off1 - off0)
		}
		c.days[i] = info
		c.holiday[i] = isHolidaySlow(d)
	}
	return c
}

func isHolidaySlow(d Day) bool {
	y, _, _ := d.Civil()
	_, ok := Holidays(y)[d]
	return ok
}

// Loc returns the clock's location.
func (c *Clock) Loc() *time.Location { return c.loc }

func (c *Clock) info(d Day) (dayInfo, bool) {
	i := int(d - c.base)
	if i < 0 || i >= len(c.days)-1 {
		return dayInfo{}, false
	}
	return c.days[i], true
}

// Split returns the local day and the local seconds since midnight.
func (c *Clock) Split(u int64) (Day, int64) {
	// first guess with a +1h offset, then adjust
	d := Day(floorDiv(u+3600, 86400))
	for k := 0; k < 3; k++ {
		inf, ok := c.info(d)
		if !ok {
			t := time.Unix(u, 0).In(c.loc)
			return DayOf(t), int64(t.Hour()*3600 + t.Minute()*60 + t.Second())
		}
		next, _ := c.info(d + 1)
		switch {
		case u < inf.start:
			d--
		case next.start != 0 && u >= next.start:
			d++
		default:
			s := u - inf.start
			if inf.trans != 0 && u >= inf.trans {
				s += inf.delta
			}
			return d, s
		}
	}
	t := time.Unix(u, 0).In(c.loc)
	return DayOf(t), int64(t.Hour()*3600 + t.Minute()*60 + t.Second())
}

// At returns the Unix time of a local wall-clock time on day d.
func (c *Clock) At(d Day, tod model.TimeOfDay) int64 {
	inf, ok := c.info(d)
	if !ok {
		return d.At(tod, c.loc).Unix()
	}
	u := inf.start + int64(tod)*60
	if inf.trans != 0 {
		// time.Date semantics: times in the spring-forward gap move
		// forward, ambiguous fall-back times take the second occurrence
		if u-inf.delta >= inf.trans {
			u -= inf.delta
		}
	}
	return u
}

// IsHoliday is the O(1) holiday lookup.
func (c *Clock) IsHoliday(d Day) bool {
	i := int(d - c.base)
	if i < 0 || i >= len(c.holiday) {
		return IsHoliday(d)
	}
	return c.holiday[i]
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// Working reports whether d is a working day of cal (fast holiday lookup).
func (c *Clock) Working(cal *Cal, d Day) bool {
	if cal.mask&(1<<uint(d.Weekday())) == 0 {
		return false
	}
	if cal.holidays && c.IsHoliday(d) {
		return false
	}
	if cal.closed != nil {
		if _, ok := cal.closed[d]; ok {
			return false
		}
	}
	return true
}

func (c *Clock) nextWorking(cal *Cal, d Day) (Day, bool) {
	for i := 0; i < searchHorizonDays; i++ {
		if c.Working(cal, d+Day(i)) {
			return d + Day(i), true
		}
	}
	return d, false
}

// AddWorkingDays is the fast variant of Cal.AddWorkingDays.
func (c *Clock) AddWorkingDays(cal *Cal, d Day, n int) (Day, bool) {
	cur, ok := c.nextWorking(cal, d)
	if !ok {
		return d, false
	}
	for n > 0 {
		cur, ok = c.nextWorking(cal, cur+1)
		if !ok {
			return d, false
		}
		n--
	}
	return cur, true
}

// NextDeparture is the fast variant of NextDeparture (departures sorted).
func (c *Clock) NextDeparture(cal *Cal, ready int64, departures []model.TimeOfDay, cutoffBefore int) (int64, bool) {
	day, secs := c.Split(ready)
	mod := (secs + 59) / 60 // round up to the minute
	for i := 0; i < searchHorizonDays; i++ {
		d := day + Day(i)
		if !c.Working(cal, d) {
			continue
		}
		for _, dep := range departures {
			if i == 0 && int64(dep)-int64(cutoffBefore) < mod {
				continue
			}
			return c.At(d, dep), true
		}
	}
	return 0, false
}

// PreparationReady is the fast variant of PreparationReady.
func (c *Clock) PreparationReady(cal *Cal, order int64, open, close, cutoff model.TimeOfDay, prepMinutes int) (int64, bool) {
	day, secs := c.Split(order)
	mod := secs / 60
	var start int64
	if c.Working(cal, day) && mod <= int64(cutoff) && mod < int64(close) {
		if mod < int64(open) {
			start = c.At(day, open)
		} else {
			start = order
		}
	} else {
		nd, ok := c.nextWorking(cal, day+1)
		if !ok {
			return 0, false
		}
		start = c.At(nd, open)
	}
	remaining := int64(prepMinutes) * 60
	cur := start
	for i := 0; i < searchHorizonDays; i++ {
		d, _ := c.Split(cur)
		end := c.At(d, close)
		avail := end - cur
		if remaining <= avail {
			return cur + remaining, true
		}
		if avail > 0 {
			remaining -= avail
		}
		nd, ok := c.nextWorking(cal, d+1)
		if !ok {
			return 0, false
		}
		cur = c.At(nd, open)
	}
	return 0, false
}

// NextOpen is the fast variant of NextOpen.
func (c *Clock) NextOpen(cal *Cal, t int64, open, close model.TimeOfDay) (int64, bool) {
	day, secs := c.Split(t)
	mod := secs / 60
	if c.Working(cal, day) && mod < int64(close) {
		if mod < int64(open) {
			return c.At(day, open), true
		}
		return t, true
	}
	nd, ok := c.nextWorking(cal, day+1)
	if !ok {
		return 0, false
	}
	return c.At(nd, open), true
}

// BusinessDaysBetween counts Mon-Fri non-holiday days after a, up to b.
func (c *Clock) BusinessDaysBetween(a, b int64) int {
	da, _ := c.Split(a)
	db, _ := c.Split(b)
	n := 0
	for d := da + 1; d <= db; d++ {
		wd := d.Weekday()
		if wd == time.Saturday || wd == time.Sunday || c.IsHoliday(d) {
			continue
		}
		n++
	}
	return n
}

// Time converts a Unix instant to a time in the clock's location.
func (c *Clock) Time(u int64) time.Time { return time.Unix(u, 0).In(c.loc) }
