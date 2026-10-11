# Pricing, restrictions, services, stock views and criteria

This guide explains how to configure, per carrier and per route, the tariff grids, the article restrictions and the associated services, and how delivery modes choose the most suitable route and the stock to use. Everything is available in the admin screens and in the API (`docs/API.md`, reference in `/docs`).

## 1. Rate cards (grilles tarifaires)

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

| Attached to | Scope | Effect |
|---|---|---|
| carrier service (`rateCardIds`) | PARCEL or SHIPMENT | every leg operated with the service |
| leg (`rateCardIds`) | PARCEL or SHIPMENT | overrides the service cards for that route segment |
| delivery mode (`priceRateCardIds`) | ORDER | customer price of the option (franco) |

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

Restrictions are set on carrier services and, in addition, on legs. A route is used for a parcel only if every leg accepts every article of the parcel. Parcel-level limits (max weight, volume, items per parcel) still apply through packing and through rate cards with `noMatch: "REJECT"`.

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

## 5. Delivery mode criteria

A delivery mode ranks its options and picks each shipment's route with **criteria**: `deliveryHours`, `cost`, `price`, `carbonKg`, `packages`, `legs`, `sources` or any custom output, each with a direction (`MIN` by default), a weight, a priority, an optional hard limit `max` and a tolerance.

- `selection: "WEIGHTED"`: score = 1 − Σ weight × normalised value / Σ weights (min-max within the mode);
- `selection: "LEXICOGRAPHIC"`: options are compared on the priority 1 criterion, then priority 2 when equal within the tolerance, and so on.

For every allocation the engine builds the plan where each shipment takes its fastest route, its cheapest route, its lowest-carbon route and its best route for each custom output used by the criteria; the criteria then choose among them. A request may override the criteria (`criteria`, `selection`).

Reference dataset: STANDARD (weighted: time, price, cost, parcels, carbon; franco 60 €), EXPRESS (by priority: time then price; stock view keeping one unit in stores; franco 150 €), SAME_DAY (time then cost), RELAY (price then time; web catalog only; franco 40 €) and ECO (carbon first, then parcels and time; franco 50 €).

## 6. Package-level information

Each package of an option returns its exact items, source points, weight, volume, delivery window, `leadTimeHours`, `distanceKm`, `metrics` (its share of cost, price, carbon and custom outputs: own legs, plus order-level outputs shared by weight), and its full route with per-leg distance and metrics.

With `"alternatives": {"limit": 5, "sortBy": "cost"}` (`deliveryHours`, `distanceKm`, `cost`, `carbonKg` or a custom output), each package also lists the other stock points able to ship its whole content directly for this mode (among the candidates evaluated for the mode), with their delivery window, distance, parcels, carriers and metrics; the current origin is flagged. This is opt-in because it evaluates extra routes.

## 7. Limits

- Parcel dimensions are a bounding-box approximation (no 3D packing).
- Package metrics of consolidated parcels share inbound and order-level outputs by weight.
- Additional service delays move the delivery day by `extraDays` delivery working days of the final carrier.
- Alternatives cover direct shipments from the candidates evaluated for the mode (`maxCandidates`, default 48).
