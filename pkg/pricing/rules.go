// Package pricing evaluates article rules and multi-dimensional rate cards
// (transport cost, customer price, carbon or custom outputs).
package pricing

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/onestock/dp100ms/pkg/model"
)

// ArticleFields lists the built-in article fields usable in rules.
var ArticleFields = []string{"sku", "name", "category", "weightKg", "volumeL", "lengthCm", "widthCm", "heightCm",
	"longestSideCm", "girthCm", "sumDimensionsCm", "priceEur"}

// sortedDims returns the article dimensions, longest first.
func sortedDims(s *model.SKU) (float64, float64, float64) {
	a, b, c := s.LengthCm, s.WidthCm, s.HeightCm
	if a < b {
		a, b = b, a
	}
	if b < c {
		b, c = c, b
	}
	if a < b {
		a, b = b, a
	}
	return a, b, c
}

// FieldValue returns the value of an article field.
func FieldValue(s *model.SKU, field string) (any, bool) {
	switch field {
	case "sku":
		return s.Code, true
	case "name":
		return s.Name, true
	case "category":
		return s.Category, true
	case "weightKg":
		return s.WeightKg, true
	case "volumeL":
		return s.VolumeL, true
	case "lengthCm":
		return s.LengthCm, true
	case "widthCm":
		return s.WidthCm, true
	case "heightCm":
		return s.HeightCm, true
	case "priceEur":
		return s.PriceEur, true
	case "longestSideCm":
		a, _, _ := sortedDims(s)
		return a, true
	case "girthCm":
		a, b, c := sortedDims(s)
		return a + 2*(b+c), true
	case "sumDimensionsCm":
		return s.LengthCm + s.WidthCm + s.HeightCm, true
	}
	if k, ok := strings.CutPrefix(field, "attributes."); ok {
		v, ok := s.Attributes[k]
		return v, ok && v != nil
	}
	return nil, false
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case int32:
		return float64(x), true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil
	}
	return 0, false
}

func toString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return ""
	}
	return fmt.Sprint(v)
}

func equal(a, b any) bool {
	if fa, ok := toFloat(a); ok {
		if fb, ok := toFloat(b); ok {
			return math.Abs(fa-fb) < 1e-9
		}
	}
	return strings.EqualFold(toString(a), toString(b))
}

// MatchRule tests one rule on an article.
func MatchRule(r model.Rule, s *model.SKU) bool {
	v, ok := FieldValue(s, r.Field)
	switch r.Op {
	case model.OpExists:
		return ok
	case model.OpMissing:
		return !ok
	}
	if !ok {
		return false
	}
	switch r.Op {
	case model.OpEq:
		return equal(v, r.Value)
	case model.OpNeq:
		return !equal(v, r.Value)
	case model.OpIn, model.OpNotIn:
		in := false
		if list, isList := v.([]any); isList {
			for _, e := range list {
				for _, w := range r.Values {
					if equal(e, w) {
						in = true
					}
				}
			}
		} else {
			for _, w := range r.Values {
				if equal(v, w) {
					in = true
					break
				}
			}
		}
		return in == (r.Op == model.OpIn)
	case model.OpContains:
		if list, isList := v.([]any); isList {
			for _, e := range list {
				if equal(e, r.Value) {
					return true
				}
			}
			return false
		}
		return strings.Contains(strings.ToLower(toString(v)), strings.ToLower(toString(r.Value)))
	case model.OpLt, model.OpLte, model.OpGt, model.OpGte:
		a, ok1 := toFloat(v)
		b, ok2 := toFloat(r.Value)
		if !ok1 || !ok2 {
			return false
		}
		switch r.Op {
		case model.OpLt:
			return a < b
		case model.OpLte:
			return a <= b
		case model.OpGt:
			return a > b
		default:
			return a >= b
		}
	case model.OpBetween:
		a, ok := toFloat(v)
		if !ok || len(r.Values) != 2 {
			return false
		}
		lo, ok1 := toFloat(r.Values[0])
		hi, ok2 := toFloat(r.Values[1])
		return ok1 && ok2 && a >= lo && a <= hi
	}
	return false
}

// MatchAll reports whether an article matches every rule (true when empty).
func MatchAll(rules []model.Rule, s *model.SKU) bool {
	for _, r := range rules {
		if !MatchRule(r, s) {
			return false
		}
	}
	return true
}

// MatchAny reports whether an article matches at least one rule.
func MatchAny(rules []model.Rule, s *model.SKU) bool {
	for _, r := range rules {
		if MatchRule(r, s) {
			return true
		}
	}
	return false
}

// Allows reports whether restrictions accept an article.
func Allows(rs []model.Restriction, s *model.SKU) bool {
	for _, r := range rs {
		switch r.Mode {
		case model.RestrictRequire:
			if !MatchAll(r.Rules, s) {
				return false
			}
		default: // EXCLUDE_IF_ANY
			if MatchAny(r.Rules, s) {
				return false
			}
		}
	}
	return true
}

// ValidateRules checks rule syntax.
func ValidateRules(prefix string, rules []model.Rule) []string {
	var errs []string
	known := map[string]bool{}
	for _, f := range ArticleFields {
		known[f] = true
	}
	ops := map[model.RuleOp]bool{}
	for _, o := range model.RuleOps {
		ops[o] = true
	}
	for i, r := range rules {
		p := fmt.Sprintf("%s[%d]", prefix, i)
		if !known[r.Field] && !strings.HasPrefix(r.Field, "attributes.") {
			errs = append(errs, p+".field: unknown field "+r.Field+" (built-in field or attributes.<key>)")
		}
		if !ops[r.Op] {
			errs = append(errs, p+".op: unknown operator "+string(r.Op))
		}
		switch r.Op {
		case model.OpIn, model.OpNotIn:
			if len(r.Values) == 0 {
				errs = append(errs, p+".values: required for "+string(r.Op))
			}
		case model.OpBetween:
			if len(r.Values) != 2 {
				errs = append(errs, p+".values: [min, max] required for between")
			}
		case model.OpExists, model.OpMissing:
		default:
			if r.Value == nil {
				errs = append(errs, p+".value: required")
			}
		}
	}
	return errs
}
