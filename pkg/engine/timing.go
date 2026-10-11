package engine

import (
	"github.com/onestock/dp100ms/pkg/model"
	"github.com/onestock/dp100ms/pkg/network"
)

// All engine times are Unix seconds (int64) computed with the integer clock
// of the calendar package; they are converted to time.Time only when the
// response is built.

type win struct{ From, To int64 }

type legTime struct {
	leg *network.Leg
	dep int64
	arr int64 // for final legs: end of the delivery window
}

type pathTiming struct {
	ok     bool
	reason string
	legs   []legTime
	// window is the delivery window (final paths) or [arrival, reception]
	// at the destination hub (inbound paths).
	window win
}

type timingKey struct {
	path  int
	start int64
}

// hubReception returns when a parcel arriving at a hub is received:
// unavailability windows postpone it, then the hub calendar and opening
// hours apply.
func (c *reqCtx) hubReception(h *network.Hub, arr int64) (int64, bool) {
	t := arr
	for i := 0; i < 3; i++ { // overlapping windows
		moved := false
		for _, u := range h.Unavail {
			if t >= u[0] && t < u[1] {
				t = u[1]
				moved = true
			}
		}
		if !moved {
			break
		}
	}
	close := h.ClosingTime
	if close == 0 {
		close = 24 * 60
	}
	return c.clk.NextOpen(h.Cal, t, h.OpeningTime, close)
}

// traverse computes departure and arrival of every leg of a path for goods
// ready at the origin at start. Results are memoised per request.
func (c *reqCtx) traverse(p *network.Path, start int64) *pathTiming {
	key := timingKey{p.ID, start}
	if pt, ok := c.timings[key]; ok {
		return pt
	}
	pt := c.computeTiming(p, start)
	c.timings[key] = pt
	return pt
}

func (c *reqCtx) computeTiming(p *network.Path, start int64) *pathTiming {
	clk := c.clk
	pt := c.newTiming(len(p.Legs))
	ready := start
	for i, l := range p.Legs {
		plan := l.Plan(c.dept)
		var dep int64
		var ok bool
		dep, ok = plan.NextDeparture(clk, ready)
		if !ok {
			pt.reason = "no departure for leg " + l.ID
			return pt
		}
		if l.Final {
			from, to, ok := plan.Delivery(clk, dep, int64(l.Transit.Seconds()))
			if !ok {
				pt.reason = "no delivery day for leg " + l.ID
				return pt
			}
			pt.legs = append(pt.legs, legTime{leg: l, dep: dep, arr: to})
			pt.window = win{from, to}
			pt.ok = true
			return pt
		}
		arr := dep + int64(l.Transit.Seconds())
		if plan.TransitMaxSec > 0 {
			arr = dep + plan.TransitMaxSec
		}
		pt.legs = append(pt.legs, legTime{leg: l, dep: dep, arr: arr})
		node := l.ToNode
		if node == nil || node.Hub == nil {
			pt.reason = "leg " + l.ID + " does not end at an active hub"
			return pt
		}
		recv, ok := c.hubReception(node.Hub, arr)
		if !ok {
			pt.reason = "hub " + node.ID + " closed"
			return pt
		}
		if i == len(p.Legs)-1 {
			// inbound path to a consolidation hub: stop at reception
			pt.window = win{arr, recv}
			pt.ok = true
			return pt
		}
		ready = recv + int64(node.Hub.SortingMinutes)*60
	}
	pt.reason = "empty path"
	return pt
}

// prepReady returns when a stock point has prepared an order placed at the
// request's order date (memoised per request; 0 = never).
func (c *reqCtx) prepReady(node *network.Node) (int64, bool) {
	if t := c.prep[node.Idx]; t != -1 {
		return t, t != 0
	}
	sp := node.StockPoint
	t, ok := c.clk.PreparationReady(node.PrepCal, c.orderU, sp.OpeningTime, sp.ClosingTime, sp.Cutoff, sp.PrepTimeMinutes)
	if !ok {
		t = 0
	}
	c.prep[node.Idx] = t
	return t, ok
}

var _ = model.CustomerNode

// newTiming carves path timings and their legs out of per-request chunks
// to keep the allocation count low on the hot path.
func (c *reqCtx) newTiming(nLegs int) *pathTiming {
	if len(c.ptPool) == cap(c.ptPool) {
		c.ptPool = make([]pathTiming, 0, 256)
	}
	c.ptPool = c.ptPool[:len(c.ptPool)+1]
	pt := &c.ptPool[len(c.ptPool)-1]
	if cap(c.legPool)-len(c.legPool) < nLegs {
		c.legPool = make([]legTime, 0, 1024)
	}
	start := len(c.legPool)
	c.legPool = c.legPool[:start+nLegs]
	pt.legs = c.legPool[start : start : start+nLegs]
	return pt
}
