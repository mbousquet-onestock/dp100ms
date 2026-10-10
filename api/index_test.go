package handler

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// The Vercel rewrite sends /api/v1/... to /api/index?__path=v1/...; the
// handler must restore the original path and query.
func TestVercelRewrite(t *testing.T) {
	cases := []string{
		"/api/index?__path=v1/health",
		"/api/v1/health?__path=v1/health", // original path preserved by the platform
	}
	for _, u := range cases {
		rec := httptest.NewRecorder()
		Handler(rec, httptest.NewRequest("GET", u, nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
			t.Fatalf("%s: %d %s", u, rec.Code, rec.Body)
		}
	}
	rec := httptest.NewRecorder()
	Handler(rec, httptest.NewRequest("GET", "/api/index?__path=v1/stock-points&type=WAREHOUSE&pageSize=2", nil))
	if !strings.Contains(rec.Body.String(), `"total":10`) || !strings.Contains(rec.Body.String(), `"pageSize":2`) {
		t.Fatalf("query not preserved: %s", rec.Body.String()[:200])
	}
}
