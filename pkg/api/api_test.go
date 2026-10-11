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

func TestRateCardEndpoints(t *testing.T) {
	s := server(t)
	card := `{"id":"RC-TEST","name":"Test","scope":"PARCEL","volumetricDivisor":5000,"active":true,
	  "derived":[{"key":"lw","terms":[{"var":"lengthCm","coef":1},{"var":"widthCm","coef":2}]}],
	  "rows":[{"conditions":{"chargeableWeightKg":{"max":2}},"outputs":{"cost":{"fixed":5},"co2Index":{"fixed":1}}},
	          {"outputs":{"cost":{"fixed":8,"perKg":0.5}}}],
	  "surcharges":[{"label":"long","conditions":{"lw":{"min":100}},"outputs":{"cost":{"fixed":3}}}]}`
	if rec := call(t, s, "POST", "/api/v1/rate-cards", card, true); rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	rec := call(t, s, "POST", "/api/v1/rate-cards/RC-TEST/quote", `{"vars":{"weightKg":1.5,"lengthCm":20,"widthCm":10,"heightCm":5}}`, false)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"cost":5`) || !strings.Contains(rec.Body.String(), `"co2Index":1`) {
		t.Fatalf("quote: %d %s", rec.Code, rec.Body)
	}
	rec = call(t, s, "POST", "/api/v1/rate-cards/quote", `{"card":`+card+`,"items":[{"sku":"SKU-00001","quantity":3}]}`, false)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"matched":true`) {
		t.Fatalf("inline quote: %d %s", rec.Code, rec.Body)
	}
	bad := `{"id":"RC-BAD","name":"Bad","scope":"MONTHLY","active":true,"rows":[{"conditions":{"color":{"min":1}},"outputs":{"cost":{"fixed":1}}}]}`
	if rec := call(t, s, "POST", "/api/v1/rate-cards", bad, true); rec.Code != 422 || !strings.Contains(rec.Body.String(), "unknown variable color") {
		t.Fatalf("validation: %d %s", rec.Code, rec.Body)
	}
}

func TestPricingConfigurationEndpoints(t *testing.T) {
	s := server(t)
	rec := call(t, s, "GET", "/api/v1/pricing/fields", "", false)
	if !strings.Contains(rec.Body.String(), "attributes.hazmat") || !strings.Contains(rec.Body.String(), "chargeableWeightKg") {
		t.Fatalf("fields: %s", rec.Body.String()[:200])
	}
	rec = call(t, s, "GET", "/api/v1/stock-views/WAREHOUSES/preview", "", false)
	if !strings.Contains(rec.Body.String(), `"stockPoints":10`) {
		t.Fatalf("preview: %s", rec.Body.String()[:200])
	}
	// a service restriction with an unknown field is refused
	svc := call(t, s, "GET", "/api/v1/services/RELAIS-STD", "", false).Body.String()
	svc = strings.Replace(svc, `"field":"longestSideCm"`, `"field":"colour"`, 1)
	if rec := call(t, s, "PUT", "/api/v1/services/RELAIS-STD", svc, true); rec.Code != 422 {
		t.Fatalf("restriction validation: %d", rec.Code)
	}
	// article update (attributes usable by rules)
	sku := `{"sku":"SKU-00001","name":"Article test","category":"Maison","weightKg":2,"volumeL":5,"lengthCm":40,"widthCm":30,"heightCm":20,"priceEur":79,"attributes":{"fragile":true}}`
	if rec := call(t, s, "PUT", "/api/v1/skus/SKU-00001", sku, true); rec.Code != 200 {
		t.Fatalf("sku update: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, s, "GET", "/api/v1/skus/SKU-00001", "", false); !strings.Contains(rec.Body.String(), `"fragile":true`) {
		t.Fatalf("sku not updated: %s", rec.Body)
	}
	// promise with services, alternatives and a stock view
	body := `{"destination":{"postalCode":"75011"},"orderDate":"2026-10-12T10:00:00+02:00","items":[{"sku":"SKU-00002","quantity":1}],
	  "deliveryModes":["STANDARD","ECO"],"stockViewId":"WAREHOUSES","alternatives":{"limit":3,"sortBy":"carbonKg"}}`
	rec = call(t, s, "POST", "/api/v1/delivery-promises", body, false)
	if rec.Code != 200 {
		t.Fatalf("promise: %d %s", rec.Code, rec.Body)
	}
	var resp model.PromiseResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Options) == 0 {
		t.Fatalf("no option: %+v", resp.Unavailable)
	}
	for _, o := range resp.Options {
		if _, ok := o.Metrics["price"]; !ok || o.StockViewID != "WAREHOUSES" || len(o.Packages[0].Alternatives) == 0 {
			t.Fatalf("incomplete option: %+v", o)
		}
		for _, a := range o.Allocations {
			if !strings.HasPrefix(a.StockPointID, "WH-") {
				t.Fatalf("stock view ignored: %s", a.StockPointID)
			}
		}
	}
	if rec := call(t, s, "POST", "/api/v1/delivery-promises", strings.Replace(body, `"WAREHOUSES"`, `"NOPE"`, 1), false); rec.Code != 422 {
		t.Fatalf("unknown stock view accepted: %d", rec.Code)
	}
}

func TestCarrierPlanningPreview(t *testing.T) {
	s := server(t)
	rec := call(t, s, "POST", "/api/v1/carriers/COLIVIA/schedule-preview", `{"serviceId":"COLIVIA-STD","postalCode":"20000","readyAt":"2026-10-12T15:00:00+02:00"}`, false)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"routeId":"COLIVIA-STD-CORSE"`) || !strings.Contains(rec.Body.String(), `"transitMaxHours":96`) || !strings.Contains(rec.Body.String(), "ROUTE:COLIVIA-STD-CORSE") {
		t.Fatalf("corsica preview: %d %s", rec.Code, rec.Body)
	}
	rec = call(t, s, "POST", "/api/v1/carriers/COLIVIA/schedule-preview", `{"serviceId":"COLIVIA-STD","postalCode":"33000","readyAt":"2026-10-12T15:00:00+02:00"}`, false)
	if !strings.Contains(rec.Body.String(), `"routeId":"COLIVIA-STD-LAST-MILE-HUB-FR"`) || !strings.Contains(rec.Body.String(), `"transitMaxHours":48`) {
		t.Fatalf("national preview: %s", rec.Body)
	}
	bad := `{"id":"COLIVIA","name":"Colivia","active":true,"schedules":[{"id":"X","name":"X","serviceIds":["EXPRESSO-EXP"],"pickupDays":[9],"active":true}]}`
	rec = call(t, s, "PUT", "/api/v1/carriers/COLIVIA", bad, true)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "not a service of carrier COLIVIA") {
		t.Fatalf("schedule validation: %d %s", rec.Code, rec.Body)
	}
}

func TestZonesAndCarrierRoutes(t *testing.T) {
	s := server(t)
	if rec := call(t, s, "GET", "/api/v1/carrier-routes?carrierId=COLIVIA&serviceId=COLIVIA-STD", "", false); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"total":5`) {
		t.Fatalf("list routes: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, s, "POST", "/api/v1/zones", `{"id":"BZH","name":"Bretagne","departments":["22","29","35","56"],"active":true}`, true); rec.Code != 201 {
		t.Fatalf("create zone: %d %s", rec.Code, rec.Body)
	}
	route := `{"id":"COL-BZH","carrierId":"COLIVIA","serviceId":"COLIVIA-STD","originZoneId":"FR","destinationZoneId":"BZH",
		"costs":{"rows":[{"conditions":{"weightKg":{"max":30}},"outputs":{"cost":{"fixed":20},"carbonKg":{"fixed":0.12}}}]},
		"transitMinHours":12,"transitMaxHours":12,"priority":1,"active":true,
		"planning":{"timezone":"Europe/Paris","days":[{"weekday":1,"pickups":["12:00","18:00"],"deliveryStart":"05:00","deliveryEnd":"22:00"},{"weekday":2,"deliveryStart":"05:00","deliveryEnd":"22:00"}]},
		"metadata":{"codeProduit":"BZH"}}`
	if rec := call(t, s, "POST", "/api/v1/carrier-routes", route, true); rec.Code != 201 {
		t.Fatalf("create route: %d %s", rec.Code, rec.Body)
	}
	rec := call(t, s, "POST", "/api/v1/carriers/COLIVIA/schedule-preview", `{"serviceId":"COLIVIA-STD","postalCode":"29200","readyAt":"2026-10-12T08:00:00+02:00"}`, false)
	if !strings.Contains(rec.Body.String(), `"routeId":"COL-BZH"`) || !strings.Contains(rec.Body.String(), `"delivery":{"from":"2026-10-13T05:00:00+02:00"`) {
		t.Fatalf("route preview: %s", rec.Body)
	}
	bad := strings.NewReplacer(`"serviceId":"COLIVIA-STD"`, `"serviceId":"EXPRESSO-EXP"`, `"transitMinHours":12`, `"transitMinHours":20`, `"weekday":2`, `"weekday":9`, `"destinationZoneId":"BZH"`, `"destinationZoneId":"NOPE"`).Replace(route)
	rec = call(t, s, "PUT", "/api/v1/carrier-routes/COL-BZH", bad, true)
	for _, f := range []string{"serviceId", "transitMaxHours", "planning.days[1].weekday", "destinationZoneId"} {
		if rec.Code != 422 || !strings.Contains(rec.Body.String(), `"`+f+`"`) {
			t.Fatalf("route validation (%s): %d %s", f, rec.Code, rec.Body)
		}
	}
}
