# Pricing, restrictions, services, stock views and criteria

This guide explains how to configure, per carrier and per route, the tariff grids, the article restrictions and the associated services, and how delivery modes choose the most suitable route and the stock to use. Everything is available in the admin screens and in the API (`docs/API.md`, reference in `/docs`).

## 1. Rate cards (grilles tarifaires)

In the admin, carrier cost grids are edited on each carrier route (Transporteurs → carrier → Routes → Coûts, section 1 ter) and customer price grids (scope `ORDER`) inline in the delivery mode form (Configuration de la livraison). Standalone rate cards remain available in the API.

A rate card is a grid evaluated on a **parcel**, a **shipment** (the parcels sharing a path) or the whole **order**. It returns one or more **outputs**:

| Output | Meaning |
|---|---|
| `cost` | transport cost paid to the carrier |
| `price` | amount billed to the customer |
| `carbonKg` | CO2e emissions |
| any other key | custom output (insurance, handling time, points…), summed the same way and usable in criteria |

### Variables

Conditions, derived metrics and `perUnit` rates can use:

| Variable | Definition |
|---|---|
| `weightKg`, `volumeL` | actual weight and volume of the articles |
| `volumetricWeightKg` | `lengthCm × widthCm × heightCm / volumetricDivisor` (0 without divisor) |
| `chargeableWeightKg` | max(actual, volumetric) |
| `lengthCm`, `widthCm`, `heightCm` | parcel bounding box, longest side first: length = longest article side, width = longest middle side, height = max(shortest side, volume / (length × width)) |
| `girthCm` | length + 2 × (width + height) |
| `sumDimensionsCm` | length + width + height |
| `itemCount`, `parcelCount` | units, parcels (1 for PARCEL scope) |
| `orderAmount`, `goodsValue` | order amount (Σ article price × quantity, or `orderAmount` of the request), value of the goods evaluated |
| `distanceKm` | leg distance (road ≈ 1.25 × great circle; final legs to the department centroid) |
| `legs`, `transitDays` | legs of the path, transit days of the service (business days to delivery for ORDER scope) |
| derived metrics | linear combinations defined on the card, e.g. `longueurPlusPourtour = lengthCm + 2 × widthCm + 2 × heightCm` |

### Rows, surcharges, components

- **Rows** are tried in order; the **first** row whose conditions (`[min, max)` ranges) and zones (destination departments) match gives the outputs. With `noMatch: "REJECT"`, a parcel outside the grid makes the route infeasible (e.g. too heavy); with `ZERO` nothing is added.
- **Surcharges** add outputs whenever their conditions, zones and article rules match (cumulative), e.g. oversize, Corsica, fragile article.
- Each output is computed by **components**: `fixed + perKg × chargeableWeightKg + perItem × itemCount + perParcel × parcelCount + perKm × distanceKm + perKgKm × weightKg × distanceKm + percentOfValue % × value + Σ perUnit[var] × var`, then clamped to `min` / `max`.

### Where cards apply

Cost grids are managed **at the carrier level**, mainly on its routes (section 1 ter), and can be refined:

| Attached to | Scope | Effect | Priority |
|---|---|---|---|
| leg (`rateCardIds`) | PARCEL or SHIPMENT | one route segment | 1 (highest) |
| carrier route (`costs`, inline grid) | PARCEL or SHIPMENT | the service from the origin zone to the destination zone | 2 |
| carrier delivery schedule (`schedules[].rateCardIds`) | PARCEL or SHIPMENT | the services / zones of the schedule (e.g. Corsica grid) | 3 |
| carrier service (`rateCardIds`) | PARCEL or SHIPMENT | every leg operated with the service | 4 |
| carrier (`rateCardIds`) | PARCEL or SHIPMENT | default of every service of the carrier | 5 |
| delivery mode (`priceRateCardIds`) | ORDER | customer price of the option (franco) | — |

Without a card producing `cost`, the service `baseCost + costPerKg × weight` is used; without a card producing `carbonKg`, the emission factor `carbonGramsPerKgKm` (or a default per service kind) × weight × distance is used. Preparation and consolidation costs are added to `cost`.

### Example: weight bands, oversize surcharge, carbon

```json
{
  "id": "RC-COLIVIA-STD", "name": "Colivia Domicile — coût", "carrierId": "COLIVIA",
  "scope": "PARCEL", "volumetricDivisor": 5000, "noMatch": "REJECT", "active": true,
  "derived": [{"key": "longueurPlusPourtour", "terms": [{"var": "lengthCm", "coef": 1}, {"var": "widthCm", "coef": 2}, {"var": "heightCm", "coef": 2}]}],
  "rows": [
    {"label": "0 – 1 kg", "conditions": {"chargeableWeightKg": {"max": 1}}, "outputs": {"cost": {"fixed": 5.2}, "carbonKg": {"fixed": 0.08, "perKgKm": 0.00025}}},
    {"label": "1 – 5 kg", "conditions": {"chargeableWeightKg": {"min": 1, "max": 5}}, "outputs": {"cost": {"fixed": 7.9}, "carbonKg": {"fixed": 0.08, "perKgKm": 0.00025}}},
    {"label": "5 – 30 kg", "conditions": {"chargeableWeightKg": {"min": 5, "max": 30}}, "outputs": {"cost": {"fixed": 10.9, "perKg": 0.35}, "carbonKg": {"fixed": 0.08, "perKgKm": 0.00025}}}
  ],
  "surcharges": [
    {"label": "Hors gabarit", "conditions": {"longueurPlusPourtour": {"min": 150}}, "outputs": {"cost": {"fixed": 12}}},
    {"label": "Corse", "zones": ["20"], "outputs": {"cost": {"fixed": 9.5}}},
    {"label": "Fragile", "rules": [{"field": "attributes.fragile", "op": "eq", "value": true}], "outputs": {"cost": {"fixed": 3}}}
  ]
}
```

### Example: customer price with free shipping (franco)

```json
{
  "id": "PRICE-STANDARD", "name": "Prix client standard", "scope": "ORDER", "active": true,
  "rows": [
    {"label": "Franco ≥ 60 €", "conditions": {"orderAmount": {"min": 60}}, "outputs": {"price": {}}},
    {"label": "Colis lourd", "conditions": {"weightKg": {"min": 20}}, "outputs": {"price": {"fixed": 9.9}}},
    {"label": "Tarif de base", "outputs": {"price": {"fixed": 4.9}}}
  ]
}
```

Test a card without saving it: `POST /api/v1/rate-cards/quote` with `{"card": {…}, "items": [{"sku": "SKU-00001", "quantity": 2}], "vars": {"distanceKm": 400}, "zone": "33"}`; or a saved one with `POST /api/v1/rate-cards/{id}/quote`.

## 1 bis. Carrier delivery schedules (plannings de livraison)

Each carrier holds its delivery schedules (`schedules`): pickup days and **cut-off**, **delivery days**, transit in delivery days (0 = same day), delivery window, holidays and closed dates, and optionally cost grids. A schedule can target some services (`serviceIds`) and/or destination departments (`zones`).

Schedules are **layered** on top of the service values, from the most general to the most specific: carrier-wide → service → zone → service + zone. Each layer only overrides the fields it sets, so a "Corse J+4" zone schedule changes the transit (and the grid) while keeping the cut-off of the national schedule. The cut-off caps the pickup times of the legs: a warehouse pickup scheduled at 20:00 with a 18:00 cut-off leaves at 18:00 (and an order ready after the cut-off waits for the next pickup day).

```json
{
  "id": "COLIVIA", "name": "Colivia", "active": true,
  "rateCardIds": ["RC-COLIVIA-STD"],
  "schedules": [
    {"id": "COLIVIA-NATIONAL", "name": "National", "pickupDays": [1,2,3,4,5], "cutoff": "20:00", "deliveryDays": [1,2,3,4,5,6], "honorHolidays": true, "active": true},
    {"id": "COLIVIA-DOMICILE", "name": "Domicile J+2", "serviceIds": ["COLIVIA-STD"], "transitDays": 2, "windowStart": "09:00", "windowEnd": "18:00", "honorHolidays": true, "active": true},
    {"id": "COLIVIA-CORSE", "name": "Corse J+4", "zones": ["20"], "transitDays": 4, "deliveryDays": [1,2,3,4,5], "rateCardIds": ["RC-COLIVIA-CORSE"], "honorHolidays": true, "active": true}
  ]
}
```

`POST /api/v1/carriers/{id}/schedule-preview` with `{"serviceId": "COLIVIA-STD", "postalCode": "20000", "readyAt": "2026-10-12T15:00:00+02:00"}` shows the layers applied, the departure, the delivery window and the grids used. In the admin, the carrier screen (Transporteurs → carrier) groups its routes, its services, its restrictions and these schedules (tab "Plannings avancés"; routes take precedence).

## 1 ter. Zones and carrier routes (routes transporteur)

This is the main way to configure a carrier, as in the OneStock Delivery screens: **Carrier → Routes → Costs / Attributes / Planning / Metadata**, plus carrier **Restrictions**.

A **zone** (`/api/v1/zones`) is a named set of places: departments (`"*"` = metropolitan France), postal code prefixes and stock points or hubs. Origins match the stock point or hub (by id or postal code); destinations match the customer department (postal code prefixes of a destination zone are matched at department level).

A **carrier route** (`/api/v1/carrier-routes`) links an origin zone to a destination zone for one carrier service. For a service delivering the customer, the routes are the **source of truth**: every stock point of the origin zone can ship with the service to the destination zone. The engine generates one direct leg per (stock point, service), named `RT-<service>-<stock point>`, covering the union of the destination zones of its routes; stored legs to the customer of a routed service are ignored. Platforms (hubs that are not stock points) ship only when the zone lists them. Line-haul and shuttle services are configured the same way: a route from an origin zone of sites to a destination zone naming hubs generates one leg per (site, hub), named `RT-<service>-<site>-<hub>`, used by multi-leg paths and consolidation. Stored legs of a routed service are ignored, so the whole network comes from the carrier screens; the "Réseau" screen shows the resulting legs with links to their routes. A route contains:

- `costs`: an inline cost grid (same format as a rate card: rows with conditions on weight, dimensions, item count, order amount…, outputs `cost` = transport cost, `price` = shipping fees, `carbonKg` = carbon footprint, or custom outputs; surcharges; `noMatch`);
- `transitMinHours` / `transitMaxHours`: transit time from pickup to delivery in elapsed hours (0/0 keeps the service transit in delivery days);
- `planning`: the weekly planning, per weekday (1 = Monday … 7 = Sunday) the **pickup times** at the origin and the **delivery slot**, with holidays and closed dates (`timezone` is the deployment time zone);
- `restrictions`: article restrictions of the route (added to those of the carrier, the service and the leg);
- `metadata`: free key/value pairs (product code, contract…), returned as is;
- `priority`, `active`.

```json
{
  "id": "COLIVIA-STD-FR-FR", "name": "Domicile national", "carrierId": "COLIVIA", "serviceId": "COLIVIA-STD",
  "originZoneId": "FR", "destinationZoneId": "FR",
  "costs": {"volumetricDivisor": 5000, "noMatch": "REJECT", "rows": [
    {"conditions": {"chargeableWeightKg": {"max": 1}}, "outputs": {"cost": {"fixed": 5.2}, "carbonKg": {"fixed": 0.08}}},
    {"conditions": {"chargeableWeightKg": {"min": 1, "max": 30}}, "outputs": {"cost": {"fixed": 21.4}, "carbonKg": {"fixed": 0.08}}}
  ]},
  "transitMinHours": 24, "transitMaxHours": 48,
  "planning": {"timezone": "Europe/Paris", "honorHolidays": true, "days": [
    {"weekday": 1, "pickups": ["12:00", "19:00"], "deliveryStart": "09:00", "deliveryEnd": "18:00"},
    {"weekday": 6, "deliveryStart": "09:00", "deliveryEnd": "18:00"}
  ]},
  "metadata": {"codeProduit": "DOM"}, "priority": 0, "active": true
}
```

How a route is applied to a leg operated with its service:

1. the route must belong to the leg carrier and service, and its origin zone must contain the leg origin;
2. for legs delivering the customer, the destination zone must contain the customer department; for hub-bound legs, it must contain the destination hub;
3. among the matching routes, the highest `priority` wins, then a destination zone naming the department beats `"*"`, then the smallest zone;
4. the route is the **last layer** of the leg planning, after the carrier schedules (section 1 bis): its planning replaces the pickup times and delivery days and slots, its transit replaces the service transit, its grid replaces the schedule / service / carrier grids (a grid set on the leg itself still wins), its restrictions are added.

Timing with a route: the parcel leaves at the first pickup time of a pickup day after it is ready (minus the leg cut-off margin); it is delivered in the first delivery slot of a delivery day that ends after `departure + transitMaxHours`, and not before `departure + transitMinHours`. Example: pickup Monday 18:00, transit 12 h, slots 05:00-22:00 → delivered Tuesday 05:00-22:00.

`POST /api/v1/carriers/{id}/schedule-preview` returns the route applied (`routeId`, `transitMinHours`, `transitMaxHours`) with the departure and the delivery slot; pass `originId` to choose the origin.

Article restrictions are set per carrier (`restrictions`, every service and route) and per delivery service; a route may add its own.

The reference dataset configures every transport as routes (no stored legs): 61 delivery routes and 68 inter-site routes (line-haul to platforms and last-mile hubs, shuttles from stores to last-mile hubs, grouped by destination hub, pickup times and transit). Delivery routes use origin zones of shipping points (all warehouses, the stores shipping with a service, each last-mile hub or platform), national destination zones (France, France without Corsica, express zone without Corsica and mountain areas), Corsica, mountain areas, remote departments, metropolitan areas and regions.

## 2. Article rules and restrictions

Articles have a weight, volume, dimensions (`lengthCm`, `widthCm`, `heightCm`), a price and free **attributes** (`fragile`, `hazmat`, `battery`, `installable`, `bulky`, `collection`… or anything you add with `PUT /api/v1/skus/{sku}`). A rule tests any of them:

```json
{"field": "attributes.hazmat", "op": "exists"}
{"field": "longestSideCm", "op": "lte", "value": 100}
{"field": "category", "op": "in", "values": ["High-tech", "Maison"]}
{"field": "priceEur", "op": "between", "values": [100, 500]}
```

Built-in fields: `sku`, `name`, `category`, `weightKg`, `volumeL`, `lengthCm`, `widthCm`, `heightCm`, `longestSideCm`, `girthCm`, `sumDimensionsCm`, `priceEur`; operators: `eq`, `neq`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `between`, `exists`, `missing`, `contains`.

A **restriction** groups rules with a mode:

- `EXCLUDE_IF_ANY`: the article is refused if it matches any rule (e.g. hazardous goods);
- `REQUIRE_ALL`: the article is accepted only if it matches every rule (e.g. pick-up point format: longest side ≤ 100 cm and weight ≤ 20 kg).

Restrictions are set on carriers (every service and route of the carrier), carrier services, carrier routes and legs; they add up. A route is used for a parcel only if every leg accepts every article of the parcel. Parcel-level limits (max weight, volume, items per parcel) still apply through packing and through rate cards with `noMatch: "REJECT"`.

## 3. Associated services (livraison, installation…)

An additional service (`/additional-services`) has a kind (`DELIVERY`, `INSTALLATION`, `ASSEMBLY`, `TAKE_BACK`, `APPOINTMENT`, `OTHER`), applicability rules (which articles), outputs (`fixed` per order, `perItem` per concerned unit, `percentOfValue` of the concerned goods) and `extraDays` of delay. Carrier services list the services they offer (`additionalServiceIds`).

- Every option lists the services offered by its delivering carriers for its articles (`additionalServices[]` with `requested: false`) and their price.
- When the request asks for services (`"additionalServices": ["INSTALLATION"]`), options whose delivering carrier cannot provide them for the concerned articles are removed; the others include the service outputs (price, cost, carbon) and the delay.

## 4. Stock views

A stock view selects the stock usable by a delivery mode (`stockViewId`) or by one request (`stockViewId` in the request):

- stock points: explicit list, types (`STORE`, `WAREHOUSE`, `LAST_MILE_HUB`), departments (postal code prefixes), exclusions;
- articles: rules (e.g. web catalog only: `attributes.collection` `missing`);
- `reserve`: units kept back on every line on top of the safety stock.

`GET /api/v1/stock-views/{id}/preview` shows how many points and articles a view selects.

## 5. Delivery modes: stock view, services compared, operations, priorities

A delivery mode defines:

- a **stock view** (`stockViewId`, section 4): the stock points and articles it may use;
- the **transport services to compare** (`serviceIds`): the engine evaluates the routes of these services from the shipping points of the stock view and keeps the best one for the mode (empty = the services listing the mode in their own `modes`);
- **operations** (`operations`): timed steps around the transport:

| Kind | Effect |
|---|---|
| `PAYMENT` | payment authorisation: delays the start of preparation (elapsed minutes) |
| `VALIDATION` | order validation, fraud check: delays the start of preparation (elapsed minutes) |
| `PREPARATION` | replaces the preparation time of the stock points (minutes within opening hours) |
| `PACKING` | added to the preparation time (minutes within opening hours) |
| `RECEPTION` | reception after delivery (pick-up point, store): delays the delivery slot (elapsed minutes) |

- **priorities** (`criteria`, `selection`) to find the best route, below.

```json
{"id": "RELAY", "stockViewId": "WEB-CATALOG", "serviceIds": ["RELAIS-STD"],
 "operations": [{"kind": "PAYMENT", "name": "Autorisation de paiement", "minutes": 15},
                {"kind": "RECEPTION", "name": "Réception au point relais", "minutes": 120}],
 "selection": "LEXICOGRAPHIC", "criteria": [{"metric": "price", "priority": 1}, {"metric": "deliveryHours", "priority": 2}]}
```

### Priorities

A delivery mode ranks its options and picks each shipment's route with **criteria**: `deliveryHours`, `cost`, `price`, `carbonKg`, `packages`, `legs`, `sources` or any custom output, each with a direction (`MIN` by default), a weight, a priority, an optional hard limit `max` and a tolerance.

- `selection: "WEIGHTED"`: score = 1 − Σ weight × normalised value / Σ weights (min-max within the mode);
- `selection: "LEXICOGRAPHIC"`: options are compared on the priority 1 criterion, then priority 2 when equal within the tolerance, and so on.

For every allocation the engine builds the plan where each shipment takes its fastest route, its cheapest route, its lowest-carbon route and its best route for each custom output used by the criteria; the criteria then choose among them. A request may override the criteria (`criteria`, `selection`).

Reference dataset: STANDARD (weighted: time, price, cost, parcels, carbon; franco 60 €), EXPRESS (by priority: time then price; stock view keeping one unit in stores; franco 150 €), SAME_DAY (time then cost), RELAY (price then time; web catalog only; franco 40 €) and ECO (carbon first, then parcels and time; franco 50 €).

## 6. Best route per mode and package-level information

`bestByMode[]` in the response gives, for every requested mode, the best delivery route: delivery window, lead time, cost, customer price, carbon, parcels, carriers / services / carrier routes delivering the customer, shipping points and alternative shipping points (with `alternatives`). Its `optionId` points to the detailed option.

Each package of an option returns its exact items, source points, weight, volume, delivery window, `leadTimeHours`, `distanceKm`, `metrics` (its share of cost, price, carbon and custom outputs: own legs, plus order-level outputs shared by weight), and its full route with per-leg distance and metrics.

With `"alternatives": {"limit": 5, "sortBy": "cost"}` (`deliveryHours`, `distanceKm`, `cost`, `carbonKg` or a custom output), each package also lists the other stock points able to ship its whole content directly for this mode (among the candidates evaluated for the mode), with their delivery window, distance, parcels, carriers and metrics; the current origin is flagged. This is opt-in because it evaluates extra routes.

## 7. Limits

- Parcel dimensions are a bounding-box approximation (no 3D packing).
- Package metrics of consolidated parcels share inbound and order-level outputs by weight.
- Additional service delays move the delivery day by `extraDays` delivery working days of the final carrier.
- Alternatives cover direct shipments from the candidates evaluated for the mode (`maxCandidates`, default 48).
