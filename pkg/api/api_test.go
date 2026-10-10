package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/onestock/dp100ms/pkg/datagen"
	"github.com/onestock/dp100ms/pkg/model"
)

var (
	srvOnce sync.Once
	testSrv *Server
)

func server(t *testing.T) *Server {
	t.Helper()
	srvOnce.Do(func() {
		testSrv = New(datagen.Generate(datagen.DefaultConfig()), Options{AdminToken: "secret", Platform: "test"})
	})
	return testSrv
}

func call(t *testing.T, s *Server, method, path, body string, admin bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if admin {
		req.Header.Set("Authorization", "Bearer secret")
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

func TestPromiseEndpoint(t *testing.T) {
	s := server(t)
	body := `{"destination":{"country":"FR","postalCode":"33000"},"orderDate":"2026-10-12T10:00:00+02:00",
	  "items":[{"sku":"SKU-00001","quantity":2},{"sku":"SKU-00002","quantity":1},{"sku":"SKU-00003","quantity":3}],
	  "deliveryModes":["STANDARD","EXPRESS"],"maxOptions":5}`
	rec := call(t, s, "POST", "/api/v1/delivery-promises", body, false)
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var resp model.PromiseResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.RequestID == "" || len(resp.Options) == 0 || len(resp.Options) > 5 {
		t.Fatalf("unexpected response %+v", resp)
	}
	o := resp.Options[0]
	if o.Currency != "EUR" || len(o.Packages) == 0 || len(o.Packages[0].Route) == 0 || o.Packages[0].Route[0].Carrier == "" {
		t.Fatalf("incomplete option %+v", o)
	}
	if rec.Header().Get("X-Calculation-Time-Ms") == "" {
		t.Error("missing X-Calculation-Time-Ms")
	}
}

func TestPromiseValidation(t *testing.T) {
	s := server(t)
	rec := call(t, s, "POST", "/api/v1/delivery-promises", `{"destination":{"postalCode":"ABCDE"},"items":[{"sku":"NOPE","quantity":0}],"deliveryModes":["TELEPORT"]}`, false)
	if rec.Code != 422 || !strings.Contains(rec.Header().Get("Content-Type"), "problem+json") {
		t.Fatalf("status %d %s", rec.Code, rec.Header())
	}
	var p Problem
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	fields := map[string]bool{}
	for _, e := range p.Errors {
		fields[e.Field] = true
	}
	for _, f := range []string{"destination.postalCode", "orderDate", "items[0].quantity", "deliveryModes[0]"} {
		if !fields[f] {
			t.Errorf("missing field error %s in %+v", f, p.Errors)
		}
	}
	if rec := call(t, s, "POST", "/api/v1/delivery-promises", `{"bad json`, false); rec.Code != 400 {
		t.Errorf("malformed json: %d", rec.Code)
	}
	if rec := call(t, s, "POST", "/api/v1/delivery-promises", `{"unknownField":1}`, false); rec.Code != 400 {
		t.Errorf("unknown field: %d", rec.Code)
	}
}

func TestAdminAuth(t *testing.T) {
	s := server(t)
	if rec := call(t, s, "POST", "/api/v1/carriers", `{"id":"X","name":"X","active":true}`, false); rec.Code != 401 {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if rec := call(t, s, "GET", "/api/v1/carriers", "", false); rec.Code != 200 {
		t.Fatalf("reads are public, got %d", rec.Code)
	}
}

func TestCarrierCRUD(t *testing.T) {
	s := server(t)
	rec := call(t, s, "POST", "/api/v1/carriers", `{"id":"TEST-CAR","name":"Test","active":true}`, true)
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, s, "POST", "/api/v1/carriers", `{"id":"TEST-CAR","name":"Test","active":true}`, true); rec.Code != 409 {
		t.Fatalf("duplicate: %d", rec.Code)
	}
	if rec := call(t, s, "PUT", "/api/v1/carriers/TEST-CAR", `{"id":"TEST-CAR","name":"Renamed","active":false}`, true); rec.Code != 200 {
		t.Fatalf("update: %d", rec.Code)
	}
	if rec := call(t, s, "GET", "/api/v1/carriers/TEST-CAR", "", false); !strings.Contains(rec.Body.String(), "Renamed") {
		t.Fatalf("get: %s", rec.Body)
	}
	if rec := call(t, s, "DELETE", "/api/v1/carriers/TEST-CAR", "", true); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := call(t, s, "GET", "/api/v1/carriers/TEST-CAR", "", false); rec.Code != 404 {
		t.Fatalf("get after delete: %d", rec.Code)
	}
}

func TestPaginationAndFilters(t *testing.T) {
	s := server(t)
	rec := call(t, s, "GET", "/api/v1/stock-points?type=WAREHOUSE&page=2&pageSize=4", "", false)
	var page Page[model.StockPoint]
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if page.Total != 10 || len(page.Items) != 4 || page.Page != 2 || page.Items[0].ID != "WH-05" {
		t.Fatalf("unexpected page %+v", page)
	}
}

func TestLegAndRouteValidation(t *testing.T) {
	s := server(t)
	rec := call(t, s, "POST", "/api/v1/legs", `{"id":"L-X","from":"STORE-001","to":"STORE-002","carrierId":"COLIVIA","serviceId":"EXPRESSO-EXP","departures":["17:00"],"active":true}`, true)
	if rec.Code != 422 {
		t.Fatalf("expected 422, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "must be CUSTOMER or a hub id") || !strings.Contains(rec.Body.String(), "belongs to EXPRESSO") {
		t.Fatalf("missing messages: %s", rec.Body)
	}
	rec = call(t, s, "POST", "/api/v1/routes", `{"id":"R-X","name":"broken","legIds":["LEG-0001","LEG-0500"],"active":true}`, true)
	if rec.Code != 422 {
		t.Fatalf("expected 422 for a discontinuous route, got %d %s", rec.Code, rec.Body)
	}
}

func TestStockEndpoints(t *testing.T) {
	s := server(t)
	rec := call(t, s, "PUT", "/api/v1/stock/STORE-001/SKU-00010", `{"physical":12,"reserved":2}`, true)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"promisable":9`) {
		t.Fatalf("put stock: %d %s", rec.Code, rec.Body)
	}
	req := httptest.NewRequest("POST", "/api/v1/stock/import", strings.NewReader("stockPointId,sku,physical,reserved\nSTORE-001,SKU-00011,4,0\nSTORE-404,SKU-00011,4,0\n"))
	req.Header.Set("Content-Type", "text/csv")
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, req)
	var res stockBatchResult
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if w.Code != 200 || res.Applied != 1 || res.Rejected != 1 {
		t.Fatalf("import: %d %s", w.Code, w.Body)
	}
	rec = call(t, s, "GET", "/api/v1/stock-points/STORE-001/stock?sku=SKU-00011", "", false)
	if !strings.Contains(rec.Body.String(), `"physical":4`) {
		t.Fatalf("stock list: %s", rec.Body)
	}
}

func TestNetworkAndSimulation(t *testing.T) {
	s := server(t)
	rec := call(t, s, "GET", "/api/v1/network/routes?postalCode=69003&mode=STANDARD", "", false)
	var routes struct {
		Count int `json:"count"`
		Paths []compiledPath
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &routes)
	if rec.Code != 200 || routes.Count == 0 {
		t.Fatalf("routes: %d %s", rec.Code, rec.Body.String()[:200])
	}
	three := false
	for _, p := range routes.Paths {
		if len(p.Legs) == 3 {
			three = true
		}
	}
	if !three {
		t.Error("no three-leg path to Lyon")
	}
	rec = call(t, s, "POST", "/api/v1/scenarios/SCN-003/run", "", false)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"nodes"`) {
		t.Fatalf("scenario run: %d", rec.Code)
	}
}

func TestBenchmarkRun(t *testing.T) {
	s := server(t)
	cfg := `{"vus":4,"durationSec":1,"baskets":{"count":50}}`
	req := httptest.NewRequest("POST", "/api/v1/benchmarks?wait=true", bytes.NewBufferString(cfg))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("benchmark: %d %s", w.Code, w.Body)
	}
	var run struct {
		Status  string `json:"status"`
		Summary struct {
			Requests int     `json:"requests"`
			Errors   int     `json:"errors"`
			P95Ms    float64 `json:"p95Ms"`
		} `json:"summary"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &run)
	if run.Status != "completed" || run.Summary.Requests == 0 || run.Summary.Errors != 0 {
		t.Fatalf("unexpected run %s", w.Body.String()[:300])
	}
}

func TestNotFoundRoute(t *testing.T) {
	s := server(t)
	if rec := call(t, s, "GET", "/api/v1/nope", "", false); rec.Code != 404 || !strings.Contains(rec.Header().Get("Content-Type"), "problem") {
		t.Fatalf("got %d", rec.Code)
	}
	if rec := call(t, s, "OPTIONS", "/api/v1/delivery-promises", "", false); rec.Code != http.StatusNoContent {
		t.Fatalf("preflight %d", rec.Code)
	}
}
