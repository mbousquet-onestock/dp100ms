# Delivery Promise & Multi-Leg Routing Engine

Configure a French logistic network (stores, warehouses, last-mile hubs, carriers, services, multi-leg routes, consolidation hubs), then compute realistic delivery promises for multi-item baskets: stock allocation across several sources, physical parcels, multi-carrier legs with calendars and cut-offs, consolidation at hubs, and weighted ranking of the options. The web admin uses the **OneStock design system**.

- **Backend**: Go 1.22+ (standard library HTTP), in-memory engine, optional PostgreSQL.
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, React Flow, Leaflet, Recharts.
- **Deployment**: Vercel first (Go function + static frontend), then GCP Cloud Run + Cloud SQL; Docker Compose locally.
- **Load tests**: k6 scripts plus a built-in load generator with history in the UI.

## Quick start

```bash
docker compose up -d     # PostgreSQL + app → http://localhost:8080 (dataset seeded at first boot)
make seed                # regenerate the reference dataset (SEED=42), then: docker compose restart app
make test                # Go tests + frontend type check
make benchmark           # k6 reference matrix against http://localhost:8080
make benchmark-report    # writes docs/PERFORMANCE.md from the k6 results
```

Without Docker:

```bash
make dev                         # API on :8080 with an in-memory dataset (≈150 ms to generate 1.2M lines)
cd web && npm ci && npm run dev  # frontend on :5173, proxied to the API
```

The admin token defaults to `dev-admin-token` (set `ADMIN_TOKEN` everywhere else). Deployment to Vercel and GCP: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## What is in the repository

| Path | Content |
|---|---|
| `pkg/engine` | Promise engine: candidate prefilter, beam-search sourcing, packing, multi-leg timing, consolidation, scoring |
| `pkg/network` | Graph compiler, bounded path search cached per (department, mode) |
| `pkg/calendar` | French public holidays, working days, cut-offs, departures, integer clock (DST-safe) |
| `pkg/store` | Configuration repository and dense stock matrix with availability bitmaps and snapshots |
| `pkg/api` | REST API `/api/v1`, OpenAPI document, validation, auth, RFC 7807 errors |
| `pkg/datagen` | Reproducible French dataset generator |
| `pkg/bench` | Live metrics, basket generator, built-in load generator |
| `pkg/pg` | PostgreSQL persistence and migrations (`pkg/pg/migrations`) |
| `cmd/server`, `cmd/seed`, `cmd/benchreport` | Server, seed / export / verification tool, report generator |
| `api/index.go`, `vercel.json` | Vercel entry point |
| `Dockerfile`, `docker-compose.yml`, `cloudbuild.yaml` | Containers, local stack, Cloud Run deployment |
| `web/` | Admin web application |
| `bench/` | k6 scripts, matrix runner, results |
| `docs/` | Architecture, API guide and reference, deployment, performance report |

## Features

**Configuration** (admin API and screens): stock points with coordinates, opening hours, preparation calendar and time, cut-off, capacity, safety stock and allowed modes; carriers and services (coverage by department with exclusions or postal codes, transit, pickup and delivery calendars, cut-off, delivery window, weight / volume / item limits, costs); hubs (consolidation, sorting, opening hours, maximum wait, unavailability periods, active flag); legs (scheduled departures, cut-off before departure, overrides); explicit multi-leg routes; delivery modes (max legs, max sources, consolidation, split); stock (line, batch, CSV import of up to 2M lines); engine settings (weights, beam width, limits).

**Carrier routes** ([docs/PRICING.md](docs/PRICING.md#1-ter-zones-and-carrier-routes-routes-transporteur)): zones (departments with exclusions, postal codes, stock points) and, per carrier, delivery routes = origin zone + destination zone + delivery service + delivery time + cost grid (transport cost, shipping fees, carbon footprint) + weekly delivery planning (pickup times and delivery slots, holidays) + metadata. Routes define which stock points ship with which service where. Article restrictions per carrier and per service.

**Delivery modes**: stock view, transport services to compare, operations (payment, validation, preparation, packing, reception) and priorities to find the best route. The promise API returns, for the selected modes, the best route with its cost, delay, carrier, service, route and shipping points (`bestByMode`), plus the detailed options.

**Pricing and rules** ([docs/PRICING.md](docs/PRICING.md)): multi-dimensional rate cards per carrier, carrier route, service or leg (weight, volumetric and chargeable weight, dimensions, girth, linear combinations of dimensions, item count, order amount for free shipping, distance, zones, article surcharges) returning transport cost, customer price, carbon or custom outputs; article restrictions on any article field or attribute; associated services (installation, floor delivery, take-back, appointment) priced with their delay; stock views per delivery mode; delivery mode criteria (weighted or by priority, with hard limits) choosing the most suitable route; package-level metrics and sortable alternative shipping points.

**Promise engine**: for every requested mode it returns options with the promised window, the exact composition of every parcel, the source stock points, the legs with carriers, services, departures and arrivals, the consolidations, the preparation groups, a chronological timeline, the cost and a score. Strategies: single source, multi-source direct, consolidated at a hub. Parcels are independent from stock points: a point can produce several parcels, a consolidated parcel can mix several points; the parcel count before and after consolidation is returned. Unservable modes are explained (`DESTINATION_NOT_SERVED`, `NO_STOCK`, `INSUFFICIENT_STOCK`, `NO_FEASIBLE_PLAN`).

**Time**: business days, French public holidays (including Easter Monday, Ascension and Whit Monday), opening hours, preparation spill-over, cut-offs, carrier pickup and delivery calendars, scheduled departures, hub reception hours and unavailability, sorting and consolidation times, Europe/Paris time zone with DST.

**Web admin** (OneStock design system): dashboard (counts, live P50/P95/P99, RPS, error rate, cache hit rate), stock points on a map of France with filters, properties, stock and connections, carriers and services, hubs, delivery modes, visual route editor (React Flow) with paths towards a delivery zone, promise simulator with option comparison and parcel journey visualisation, scenarios, benchmarks with live charts and history, API documentation, settings.

## Reference dataset

`make seed` (or the first boot) generates, from a seed:

- 100 stores, 10 central warehouses, 10 last-mile hubs (120 stock points) placed in metropolitan France, with more stores in Paris, Lyon, Marseille, Bordeaux, Lille, Toulouse, Nantes, Strasbourg, Nice and Rennes;
- a shared catalog of 12,000 SKUs (8 categories, weights from 50 g to 22 kg); every stock point lists exactly 10,000 of them (warehouses carry the first 10,000, stores and hubs a random assortment including a store-exclusive collection) → **1,200,000 stock lines**;
- zero stock (≈ 22 %), partial stock, reservations (≈ 9 % of lines), safety stock in stores;
- article dimensions, prices and attributes (fragile, hazardous, lithium battery, installable, bulky, store collection);
- 13 rate cards (cost grids per carrier with volumetric weight, oversize and Corsica surcharges, carbon; customer prices with free shipping per mode), restrictions (pick-up point format, cargo bike format, no hazardous goods or lithium batteries by air), 4 associated services, 5 stock views, 5 delivery modes with criteria (STANDARD, EXPRESS, SAME_DAY, RELAY, ECO);
- 129 carrier routes with weekly plannings: 61 delivery routes over origin zones of shipping points and destination zones (France, Corsica, mountain areas, remote departments, metropolitan areas, regions) and 68 inter-site routes (line-haul, shuttles); every transport is configured as routes;
- 6 fictitious carriers, 11 services, 6 regional consolidation platforms + 10 last-mile hubs, 553 legs generated from the carrier routes (322 to the customer, 231 between sites), 12 explicit three-leg itineraries;
- varied opening hours, preparation calendars (some stores closed on Monday, some open on Sunday) and cut-offs; restricted zones (no express in Corsica and some mountain departments, same day only in large cities, overseas not served);
- 8 reference scenarios (single item, multi-source, after cut-off on a Friday, before public holidays, Corsica, overseas, large quantity).

`go run ./cmd/seed` prints the verification summary; `make seed-csv` exports the dataset as CSV.

## Tests

`make test` runs:

- the **18 functional scenarios** of the specification (`pkg/engine/functional_test.go`) on a controlled network, each followed by an **invariant check** of every option: no forgotten or duplicated item, allocations equal to the basket and within the snapshot stock, continuous routes on scheduled departures and working days, no consolidation before all components arrive, no promise before the end of the last leg;
- a property test running 400 generated baskets through the full reference dataset with the same invariant checks;
- calendar tests (holidays, Easter, cut-offs, spill-over, DST) and an equivalence test of the integer clock against the `time` package;
- stock matrix, repository, generator (volumes, reproducibility), REST API (validation, auth, CRUD, pagination, import, benchmark) and OpenAPI coverage tests;
- a PostgreSQL round-trip test (`TEST_DATABASE_URL=… go test ./pkg/pg/`).

`make test-race` runs the suite with the race detector (including the concurrent stock update scenario).

## Performance

The objective is a P95 below 100 ms for `POST /api/v1/delivery-promises`, measured by k6 on the client side (JSON included, loopback). Reference run: server on 2 dedicated vCPUs, k6 on 2 others, 5,000 varied baskets, 0 failed requests out of about 585,000:

| Scenario | Throughput | P50 | P95 | P99 | Target |
|---|---:|---:|---:|---:|:---:|
| 10 concurrent users | 1,874 req/s | 4.2 ms | 12.1 ms | 18.3 ms | met |
| 50 concurrent users | 1,918 req/s | 24.4 ms | 47.3 ms | 60.9 ms | met |
| 100 concurrent users | 1,906 req/s | 50.9 ms | 87.9 ms | 112.9 ms | met |
| 250 / 500 / 1,000 concurrent users | ≈1,800-1,900 req/s | 139 / 270 / 589 ms | 215 / 386 / 721 ms | | missed (CPU saturation, see below) |
| constant 500 req/s | 500 req/s | 1.5 ms | 4.5 ms | 12.0 ms | met |
| constant 1,000 req/s | 1,000 req/s | 1.5 ms | 12.0 ms | 37.4 ms | met |
| constant 1,500 req/s | 1,498 req/s | 3.1 ms | 39.4 ms | 93.6 ms | met |
| constant 2,000 req/s | 1,803 req/s (5,074 dropped) | 547 ms | 683 ms | 1,177 ms | missed (above capacity) |

A 2-core instance saturates at about 1,900 req/s (≈1 ms of CPU per request, of which 0.6-0.8 ms is the engine). Beyond that, closed-loop users with zero think time queue (latency ≈ users / throughput), so 250 or more such users need more cores or instances. Methodology, hardware, per-category latency, optimisation history and limits: [docs/PERFORMANCE.md](docs/PERFORMANCE.md) (`make benchmark-report`).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): decisions (Go for Vercel, in-memory engine, no Redis), components, data model, algorithms, heuristic quality, stock consistency, limitations.
- [docs/API.md](docs/API.md): API guide with examples. Reference: `/docs` in the app, `docs/api/index.html`, `GET /api/v1/openapi.json`.
- [docs/PRICING.md](docs/PRICING.md): zones and carrier routes, rate cards, franco, carbon, article restrictions, associated services, stock views, delivery mode criteria, package information.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Vercel (with Vercel Postgres / Neon initialised at the first connection), GCP Cloud Run + Cloud SQL, Docker Compose, environment variables.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): benchmark report.

## Known limitations

Summarised from [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#8-known-limitations): stock and caches are in memory per process, kept in sync between instances through the database change log (about 1 s); without a database on Vercel, admin changes are per instance and lost at cold start; capacities are stored but not consumed; packing uses weight, volume and item count (no 3D); one time zone per deployment; the search is heuristic (measured quality in the architecture document).
