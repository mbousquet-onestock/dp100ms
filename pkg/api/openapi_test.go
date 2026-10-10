package api

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// TestOpenAPICoversRoutes checks that every registered route is documented.
func TestOpenAPICoversRoutes(t *testing.T) {
	var spec struct {
		Paths map[string]map[string]any `json:"paths"`
	}
	if err := json.Unmarshal(openapiJSON, &spec); err != nil {
		t.Fatal(err)
	}
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{}
	for _, m := range regexp.MustCompile(`HandleFunc\("(GET|POST|PUT|PATCH|DELETE) /api/v1(/[^"]*)"`).FindAllStringSubmatch(string(src), -1) {
		want[strings.ToLower(m[1])+" "+m[2]] = true
	}
	for _, m := range regexp.MustCompile(`registerCRUD\(s, "([a-z-]+)"`).FindAllStringSubmatch(string(src), -1) {
		base := "/" + m[1]
		for _, k := range []string{"get " + base, "post " + base, "get " + base + "/{id}", "put " + base + "/{id}", "delete " + base + "/{id}"} {
			want[k] = true
		}
	}
	if len(want) < 50 {
		t.Fatalf("route extraction failed: %d", len(want))
	}
	for k := range want {
		parts := strings.SplitN(k, " ", 2)
		p, ok := spec.Paths[parts[1]]
		if !ok {
			t.Errorf("undocumented path %s", k)
			continue
		}
		if _, ok := p[parts[0]]; !ok {
			t.Errorf("undocumented operation %s", k)
		}
	}
}
