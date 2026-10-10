# API guide

The complete reference is generated from the OpenAPI 3.1 document:

- in the application: **API documentation** page (`/docs`), with "Try it" requests;
- standalone page in the OneStock design system: `docs/api/index.html` (`python3 scripts/apidoc.py` regenerates it);
- raw document: `GET /api/v1/openapi.json` (source: `docs/openapi.yaml`, `make openapi` regenerates the embedded JSON).

This guide covers the main flows with `curl`. `BASE` is the server URL (`http://localhost:8080`, your Vercel or Cloud Run URL) and `TOKEN` the admin token.

## Conventions

- Base path `/api/v1`, JSON everywhere (CSV accepted by the stock import).
- Times: RFC 3339 instants in responses (Europe/Paris offset); `HH:MM` local times in the configuration; calendars use `1` = Monday … `7` = Sunday.
- Errors: `application/problem+json` (RFC 7807). `422` lists invalid fields in `errors[]`, `401` means a missing or invalid admin token, `404` an unknown resource, `409` a duplicate id or an already running benchmark.
- Lists: `?page=1&pageSize=50` → `{items, page, pageSize, total}`.
- Writes on administration resources need `Authorization: Bearer $TOKEN`. Promise, simulation and scenario runs are public.

## Compute a promise

```bash
curl -s -X POST $BASE/api/v1/delivery-promises -H 'Content-Type: application/json' -d '{
  "destination": {"country": "FR", "postalCode": "33000"},
  "orderDate": "2026-10-12T10:00:00+02:00",
  "items": [{"sku": "SKU-00001", "quantity": 2}, {"sku": "SKU-00002", "quantity": 1}, {"sku": "SKU-00003", "quantity": 3}],
  "deliveryModes": ["STANDARD", "EXPRESS"],
  "maxOptions": 5
}'
```

Each option contains:

- `estimatedDelivery {from, to}`: the promised window (end of the last leg);
- `strategy`: `SINGLE_SOURCE`, `MULTI_SOURCE_DIRECT` or `CONSOLIDATED`;
- `packages[]`: physical parcels delivered to the customer with their exact items, source stock points, weight, volume, hubs and full route (inbound legs of every contributing source, then the parcel's own legs) with carrier, service, departure, arrival and cost;
- `totalPackages` and `packagesBeforeConsolidation`;
- `allocations[]`, `preparationGroups[]`, `shipments[]`, `consolidations[]`, `timeline[]`;
- `criteria` (delivery hours, parcels, cost, legs, sources) and `score` (0 to 1, relative to the other options of the same mode).

Modes that cannot be served are listed in `unavailable[]` with a code: `DESTINATION_NOT_SERVED`, `NO_STOCK`, `INSUFFICIENT_STOCK`, `NO_FEASIBLE_PLAN`.

Optional request fields:

```json
{
  "constraints": {"maxPackages": 2, "maxWeightKg": 10, "maxItems": 5, "forbidConsolidation": false, "maxSources": 2},
  "weights": {"deliveryTime": 0.6, "packages": 0.2, "cost": 0.2, "legs": 0, "sources": 0}
}
```

`calculationTimeMs` is the engine time; the `X-Calculation-Time-Ms` header carries the same value. Client-side latency (HTTP + JSON) is what k6 measures.

## Update stock

```bash
# one line
curl -s -X PUT $BASE/api/v1/stock/STORE-001/SKU-00001 -H "Authorization: Bearer $TOKEN" -d '{"physical": 12, "reserved": 2}'

# batch (atomic for readers, one stock version)
curl -s -X PATCH $BASE/api/v1/stock -H "Authorization: Bearer $TOKEN" -d '[
  {"stockPointId": "STORE-001", "sku": "SKU-00001", "delta": -1},
  {"stockPointId": "WH-01", "sku": "SKU-00002", "physical": 250, "reserved": 10}
]'

# bulk CSV import (up to 2M lines per call)
curl -s -X POST $BASE/api/v1/stock/import -H "Authorization: Bearer $TOKEN" -H 'Content-Type: text/csv' \
  --data-binary @stock.csv     # stockPointId,sku,physical[,reserved]
```

`promisable = physical − reserved − safetyStock` is what the engine uses. A promise never reserves stock.

## Configure the network

```bash
# a consolidation hub
curl -s -X POST $BASE/api/v1/hubs -H "Authorization: Bearer $TOKEN" -d '{
  "id": "HUB-TEST", "name": "Hub test", "kind": "CONSOLIDATION", "postalCode": "45000", "city": "Orléans",
  "lat": 47.9, "lon": 1.9, "calendar": {"workingDays": [1,2,3,4,5], "honorHolidays": true},
  "openingTime": "00:00", "closingTime": "24:00", "sortingMinutes": 60,
  "consolidationEnabled": true, "consolidationMinutes": 90, "maxConsolidationWaitHours": 48, "consolidationCost": 0.8, "active": true}'

# a leg from a store to the hub (a leg ends at a hub or at CUSTOMER)
curl -s -X POST $BASE/api/v1/legs -H "Authorization: Bearer $TOKEN" -d '{
  "id": "LEG-TEST", "from": "STORE-001", "to": "HUB-TEST", "carrierId": "TRANSALP", "serviceId": "TRANSALP-LH",
  "departures": ["18:30"], "cutoffMinutesBefore": 30, "transitMinutes": 240, "active": true}'

# paths reaching a zone for a mode (automatic bounded search + explicit routes)
curl -s "$BASE/api/v1/network/routes?postalCode=69003&mode=STANDARD&origin=STORE-007"
```

Deactivating a hub (`active: false`) or adding an `unavailability` period makes it temporarily unavailable; the next request uses the new configuration (`configVersion` changes and caches are rebuilt).

## Simulations and scenarios

`POST /api/v1/simulations` takes the same body as the promise and adds node coordinates, basket stock availability and server timing. Saved scenarios (`/api/v1/scenarios`) store a request; `POST /api/v1/scenarios/{id}/run` replays it on the current data.

## Benchmarks

```bash
# start a built-in load test (202 + run; poll GET /benchmarks/{id})
curl -s -X POST $BASE/api/v1/benchmarks -H "Authorization: Bearer $TOKEN" -d '{
  "vus": 100, "durationSec": 30, "target": "inprocess",
  "baskets": {"count": 2000, "skusMin": 2, "skusMax": 5, "pctMono": 30, "pctMulti": 40, "pctMultiSource": 20, "pctConsolidation": 10}}'

# constant arrival rate
curl -s -X POST $BASE/api/v1/benchmarks -H "Authorization: Bearer $TOKEN" -d '{"rateRps": 500, "vus": 400, "durationSec": 30}'

curl -s $BASE/api/v1/benchmarks            # history
curl -s "$BASE/api/v1/benchmarks/baskets?count=1000&seed=1"   # basket pool used by k6
```

`target: "inprocess"` calls the handler directly (routing and JSON included, no network); `target: "http"` sends real HTTP requests to `baseUrl` (default: the server itself). k6 runs are imported into the same history by `bench/run.sh` when `ADMIN_TOKEN` is set.
