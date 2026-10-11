# Delivery Promise · web admin

Back-office of the delivery promise and multi-leg routing engine, built with the OneStock design system
(React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6, TanStack Query 5, React Flow 12, Leaflet, Recharts).
The UI copy is in French.

## Scripts

| Command           | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `npm install`     | Install the pinned dependencies (`package-lock.json`)        |
| `npm run dev`     | Dev server on http://localhost:5173, `/api` proxied to the Go API |
| `npm run build`   | Type-check (`tsc -b`) and build into `dist/`                 |
| `npm run preview` | Serve `dist/` on http://localhost:4173 with the same proxy   |
| `npm run lint`    | Type-check only (`tsc --noEmit`)                             |

Start the backend first: `cd .. && go run ./cmd/server` (listens on :8080).

## Environment

- `VITE_API_PROXY`: target of the `/api` proxy for `dev` and `preview` (default `http://localhost:8080`).
- The app always calls relative URLs (`/api/v1/...`), so in production the API must be served on the same origin
  (Go server with `StaticDir`, Cloud Run, or Vercel rewrites).
- The admin token used for write operations is stored in `localStorage` (`dp.adminToken`, default `dev-admin-token`)
  and can be changed from the top bar.

## Structure

```
src/
  api/          types.ts (mirror of the Go JSON), client.ts (fetch + RFC 7807 ApiError), hooks.ts (react-query)
  components/   Layout (top bar, sidebar), ui.tsx (OneStock primitives), Icons, FranceMap, forms, sim/ (journey map, flow diagram)
  lib/          format (fr-FR dates, €), labels, departments (centroids, regions), openapi helpers, simulator state
  pages/        one lazily loaded module per route
  styles/       tokens.css (OneStock tokens), index.css (Tailwind layers and components)
```

Routes: `/` dashboard, `/simulator`, `/scenarios`, `/stock-points` (+ `/stock-points/:id`), `/network`, `/hubs`,
`/carriers`, `/delivery-modes`, `/skus` (articles), `/rate-cards` (+ `?id=` editor with quote simulation), `/additional-services`,
`/stock-views`, `/benchmarks`, `/docs` (OpenAPI renderer for `/api/v1/openapi.json`), `/settings`.

Shared pricing editors live in `src/components/pricing/`: `RuleBuilder` (article rules and restrictions), `Outputs`
(rate card components, ranges, outputs list) and `CriteriaEditor` (delivery mode selection criteria).
