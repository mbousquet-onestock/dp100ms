package pricing

import (
	"fmt"
	"math"
	"strings"

	"github.com/onestock/dp100ms/pkg/model"
)

// Variable indexes of Vars.
const (
	VWeight = iota
	VVolume
	VVolumetric
	VChargeable
	VLength
	VWidth
	VHeight
	VGirth
	VSumDims
	VItems
	VParcels
	VOrderAmount
	VGoodsValue
	VDistance
	VLegs
	VTransitDays
	NVars
)

var varIndex = func() map[string]int {
	m := map[string]int{}
	for i, n := range model.RateVariables {
		m[n] = i
	}
	return m
}()

// Vars are the variables of one evaluation (parcel, shipment or order).
type Vars [NVars]float64

// Registry maps output names to dense indexes (cost, price, carbonKg first).
type Registry struct {
	Names []string
	idx   map[string]int
}

const (
	OutCost = iota
	OutPrice
	OutCarbon
)

func NewRegistry() *Registry {
	r := &Registry{idx: map[string]int{}}
	for _, n := range []string{model.OutCost, model.OutPrice, model.OutCarbon} {
		r.Index(n)
	}
	return r
}

// Index returns (registering if needed) the index of an output.
func (r *Registry) Index(name string) int {
	if i, ok := r.idx[name]; ok {
		return i
	}
	r.idx[name] = len(r.Names)
	r.Names = append(r.Names, name)
	return len(r.Names) - 1
}

// Lookup returns the index of an output or -1.
func (r *Registry) Lookup(name string) int {
	if i, ok := r.idx[name]; ok {
		return i
	}
	return -1
}

// Map converts an output vector to a name → value map (rounded, zeros of
// custom outputs omitted).
func (r *Registry) Map(v []float64) map[string]float64 {
	m := make(map[string]float64, len(v))
	for i, x := range v {
		if i > OutCarbon && x == 0 {
			continue
		}
		if i == OutCarbon {
			m[r.Names[i]] = math.Round(x*1000) / 1000
		} else {
			m[r.Names[i]] = math.Round(x*100) / 100
		}
	}
	return m
}

type cond struct {
	v              int // < NVars: built-in, else derived index + NVars
	min, max       float64
	hasMin, hasMax bool
}

type unitRate struct {
	v    int
	rate float64
}

type comp struct {
	out                                                        int
	fixed, perKg, perItem, perParcel, perKm, perKgKm, pctValue float64
	perUnit                                                    []unitRate
	min, max                                                   *float64
}

type row struct {
	conds []cond
	zones map[string]bool
	comps []comp
}

type surcharge struct {
	row
	rules []model.Rule
}

type derived struct {
	terms []unitRate
}

// Card is a compiled rate card.
type Card struct {
	ID         string
	Name       string
	Scope      model.RateScope
	divisor    float64
	derived    []derived
	derivedIdx map[string]int
	rows       []row
	surcharges []surcharge
	reject     bool
}

func (c *Card) resolveVar(name string) (int, bool) {
	if i, ok := varIndex[name]; ok {
		return i, true
	}
	if i, ok := c.derivedIdx[name]; ok {
		return NVars + i, true
	}
	return 0, false
}

func (c *Card) compileConds(prefix string, m map[string]model.Range) ([]cond, []string) {
	var out []cond
	var errs []string
	for name, r := range m {
		v, ok := c.resolveVar(name)
		if !ok {
			errs = append(errs, fmt.Sprintf("%s: unknown variable %s", prefix, name))
			continue
		}
		cd := cond{v: v}
		if r.Min != nil {
			cd.min, cd.hasMin = *r.Min, true
		}
		if r.Max != nil {
			cd.max, cd.hasMax = *r.Max, true
		}
		if cd.hasMin && cd.hasMax && cd.max <= cd.min {
			errs = append(errs, fmt.Sprintf("%s.%s: max must be greater than min", prefix, name))
		}
		out = append(out, cd)
	}
	return out, errs
}

func (c *Card) compileComps(prefix string, m map[string]model.Components, reg *Registry) ([]comp, []string) {
	var out []comp
	var errs []string
	for name, cp := range m {
		if name == "" {
			errs = append(errs, prefix+": empty output name")
			continue
		}
		k := comp{out: reg.Index(name), fixed: cp.Fixed, perKg: cp.PerKg, perItem: cp.PerItem, perParcel: cp.PerParcel,
			perKm: cp.PerKm, perKgKm: cp.PerKgKm, pctValue: cp.PercentOfValue, min: cp.Min, max: cp.Max}
		for vn, rate := range cp.PerUnit {
			v, ok := c.resolveVar(vn)
			if !ok {
				errs = append(errs, fmt.Sprintf("%s.%s.perUnit: unknown variable %s", prefix, name, vn))
				continue
			}
			k.perUnit = append(k.perUnit, unitRate{v, rate})
		}
		out = append(out, k)
	}
	return out, errs
}

func zoneSet(z []string) map[string]bool {
	if len(z) == 0 {
		return nil
	}
	m := make(map[string]bool, len(z))
	for _, x := range z {
		m[strings.TrimSpace(x)] = true
	}
	return m
}

// Compile validates and compiles a rate card; output names are registered.
func Compile(rc *model.RateCard, reg *Registry) (*Card, []string) {
	c := &Card{ID: rc.ID, Name: rc.Name, Scope: rc.Scope, divisor: rc.VolumetricDivisor, derivedIdx: map[string]int{}, reject: rc.NoMatch == "REJECT"}
	var errs []string
	if c.Scope == "" {
		c.Scope = model.ScopeParcel
	}
	if c.Scope != model.ScopeParcel && c.Scope != model.ScopeShipment && c.Scope != model.ScopeOrder {
		errs = append(errs, "scope: must be PARCEL, SHIPMENT or ORDER")
	}
	if c.divisor < 0 {
		errs = append(errs, "volumetricDivisor: must be >= 0")
	}
	for i, d := range rc.Derived {
		if d.Key == "" {
			errs = append(errs, fmt.Sprintf("derived[%d].key: required", i))
			continue
		}
		if _, clash := varIndex[d.Key]; clash {
			errs = append(errs, fmt.Sprintf("derived[%d].key: %s is a built-in variable", i, d.Key))
			continue
		}
		var dv derived
		for _, t := range d.Terms {
			v, ok := varIndex[t.Var]
			if !ok {
				errs = append(errs, fmt.Sprintf("derived[%d]: unknown variable %s (derived metrics combine built-in variables)", i, t.Var))
				continue
			}
			dv.terms = append(dv.terms, unitRate{v, t.Coef})
		}
		c.derivedIdx[d.Key] = len(c.derived)
		c.derived = append(c.derived, dv)
	}
	if len(rc.Rows) == 0 {
		errs = append(errs, "rows: at least one row is required")
	}
	for i, r := range rc.Rows {
		p := fmt.Sprintf("rows[%d]", i)
		conds, e1 := c.compileConds(p+".conditions", r.Conditions)
		comps, e2 := c.compileComps(p+".outputs", r.Outputs, reg)
		errs = append(errs, e1...)
		errs = append(errs, e2...)
		c.rows = append(c.rows, row{conds: conds, zones: zoneSet(r.Zones), comps: comps})
	}
	for i, s := range rc.Surcharges {
		p := fmt.Sprintf("surcharges[%d]", i)
		conds, e1 := c.compileConds(p+".conditions", s.Conditions)
		comps, e2 := c.compileComps(p+".outputs", s.Outputs, reg)
		errs = append(errs, e1...)
		errs = append(errs, e2...)
		errs = append(errs, ValidateRules(p+".rules", s.Rules)...)
		c.surcharges = append(c.surcharges, surcharge{row: row{conds: conds, zones: zoneSet(s.Zones), comps: comps}, rules: s.Rules})
	}
	return c, errs
}

// Complete fills the derived weight variables of vars for this card.
func (c *Card) complete(v *Vars) {
	if c.divisor > 0 {
		v[VVolumetric] = v[VLength] * v[VWidth] * v[VHeight] / c.divisor
		if alt := v[VVolume] * 1000 / c.divisor; alt > v[VVolumetric] {
			v[VVolumetric] = alt
		}
	} else {
		v[VVolumetric] = 0
	}
	v[VChargeable] = math.Max(v[VWeight], v[VVolumetric])
}

func (c *Card) value(v *Vars, d []float64, i int) float64 {
	if i < NVars {
		return v[i]
	}
	return d[i-NVars]
}

func (c *Card) matches(r *row, v *Vars, d []float64, zone string) bool {
	if r.zones != nil && !r.zones[zone] {
		return false
	}
	for _, cd := range r.conds {
		x := c.value(v, d, cd.v)
		if cd.hasMin && x < cd.min {
			return false
		}
		if cd.hasMax && x >= cd.max {
			return false
		}
	}
	return true
}

func (c *Card) apply(comps []comp, v *Vars, d []float64, out []float64) {
	for _, k := range comps {
		x := k.fixed + k.perKg*v[VChargeable] + k.perItem*v[VItems] + k.perParcel*v[VParcels] +
			k.perKm*v[VDistance] + k.perKgKm*v[VWeight]*v[VDistance]
		base := v[VGoodsValue]
		if c.Scope == model.ScopeOrder {
			base = v[VOrderAmount]
		}
		x += k.pctValue / 100 * base
		for _, u := range k.perUnit {
			x += u.rate * c.value(v, d, u.v)
		}
		if k.min != nil && x < *k.min {
			x = *k.min
		}
		if k.max != nil && x > *k.max {
			x = *k.max
		}
		out[k.out] += x
	}
}

// Eval adds the card outputs for vars to out. items are the articles
// concerned (for surcharge rules). It returns false when no row matches and
// the card rejects unmatched inputs.
func (c *Card) Eval(vars Vars, zone string, items []*model.SKU, out []float64) bool {
	c.complete(&vars)
	var dbuf [8]float64
	d := dbuf[:0]
	if len(c.derived) > len(dbuf) {
		d = make([]float64, 0, len(c.derived))
	}
	for _, dv := range c.derived {
		x := 0.0
		for _, t := range dv.terms {
			x += t.rate * vars[t.v]
		}
		d = append(d, x)
	}
	matched := false
	for i := range c.rows {
		if c.matches(&c.rows[i], &vars, d, zone) {
			c.apply(c.rows[i].comps, &vars, d, out)
			matched = true
			break
		}
	}
	if !matched && c.reject {
		return false
	}
	for i := range c.surcharges {
		s := &c.surcharges[i]
		if !c.matches(&s.row, &vars, d, zone) {
			continue
		}
		if len(s.rules) > 0 {
			any := false
			for _, it := range items {
				if MatchAll(s.rules, it) {
					any = true
					break
				}
			}
			if !any {
				continue
			}
		}
		c.apply(s.comps, &vars, d, out)
	}
	return true
}

// ItemQty is an article and a quantity.
type ItemQty struct {
	SKU *model.SKU
	Qty int
}

// Measure computes the physical variables of a set of articles packed
// together. The bounding box is approximated: length = longest article
// side, width = longest middle side, height = max(shortest side, volume /
// (length × width)).
func Measure(items []ItemQty) Vars {
	var v Vars
	var maxB, maxC float64
	for _, it := range items {
		if it.Qty <= 0 {
			continue
		}
		q := float64(it.Qty)
		v[VWeight] += it.SKU.WeightKg * q
		v[VVolume] += it.SKU.VolumeL * q
		v[VItems] += q
		v[VGoodsValue] += it.SKU.PriceEur * q
		a, b, c := sortedDims(it.SKU)
		v[VLength] = math.Max(v[VLength], a)
		maxB = math.Max(maxB, b)
		maxC = math.Max(maxC, c)
	}
	v[VWidth] = maxB
	h := maxC
	if v[VLength] > 0 && maxB > 0 {
		if byVol := v[VVolume] * 1000 / (v[VLength] * maxB); byVol > h {
			h = byVol
		}
	}
	v[VHeight] = math.Round(h*10) / 10
	v[VGirth] = v[VLength] + 2*(v[VWidth]+v[VHeight])
	v[VSumDims] = v[VLength] + v[VWidth] + v[VHeight]
	v[VParcels] = 1
	v[VChargeable] = v[VWeight]
	return v
}

// VarsMap exposes Vars for API quotes.
func VarsMap(v Vars) map[string]float64 {
	m := make(map[string]float64, NVars)
	for i, n := range model.RateVariables {
		m[n] = math.Round(v[i]*1000) / 1000
	}
	return m
}

// SetVar sets a variable by name (API quotes).
func (v *Vars) Set(name string, x float64) bool {
	i, ok := varIndex[name]
	if ok {
		v[i] = x
	}
	return ok
}
