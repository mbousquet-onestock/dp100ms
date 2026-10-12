# Deployment

The same code runs in three ways:

| Target | Entry point | Data | When to use |
|---|---|---|---|
| **Vercel** (first target) | `api/index.go` (Go serverless function) + static `web/dist` | Generated in memory at cold start (seed), or PostgreSQL if `DATABASE_URL` is set | Demo, review, first deployment |
| **GCP Cloud Run** (second target) | `Dockerfile` → `cmd/server` (API + frontend) | Cloud SQL for PostgreSQL | Stable environment, horizontal scaling, real benchmarks |
| **Docker Compose** (local) | `docker-compose.yml` | Local PostgreSQL | Development, `make benchmark` |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_TOKEN` | `dev-admin-token` | Bearer token of the admin API. **Set it in every shared environment.** |
| `SEED` | `42` | Dataset seed when generating in memory. |
| `DATABASE_URL` (or `POSTGRES_URL`) | unset | PostgreSQL URL used at runtime. Enables migrations, persistence and loading at boot. An empty database is initialised automatically at the first connection. |
| `DATABASE_URL_UNPOOLED` (or `POSTGRES_URL_NON_POOLING`) | runtime URL | Direct connection used for migrations and the initial load (advisory lock). Set automatically by the Vercel / Neon integration. |
| `STOCK_STORAGE` | `delta` | `delta`: the database stores the configuration, the catalog and only the stock lines changed since the initial load; the 1.2M-line baseline is regenerated from the seed at boot. `full`: all stock lines are stored. |
| `SYNC_INTERVAL_MS` | `1000` | With a database: how often an instance applies the changes written by the other instances (configuration, stock, articles, reseed). `0` disables. |
| `STOCK_SOURCE` | `database` | `generate` forces in-memory generation even with a database. |
| `STATIC_DIR` | unset (`/app/web` in the image) | Built frontend served by `cmd/server`. |
| `PLATFORM` | auto (`vercel`, `cloudrun`, `local`) | Label shown in the UI and benchmark reports. |
| `PORT` | `8080` | Listening port (`cmd/server`). |
| `GOGC` | `200` (set by the app) | Go GC target. |
| `BENCH_MAX_DURATION_SEC` | `600` (25 on Vercel) | Cap of built-in benchmark runs. |
| `PPROF_ADDR` | unset | e.g. `127.0.0.1:6060` to expose `net/http/pprof` (never public). |

## 1. Vercel

`vercel.json` declares:

- the build of the frontend (`web/`, Vite) into `web/dist`, served statically;
- the Go function `api/index.go` (1024 MB, 60 s max) receiving every `/api/*` request through a rewrite (`/api/index?__path=…`, the handler restores the original path);
- the SPA fallback to `index.html`.

### Steps

1. Import the GitHub repository in Vercel (**Add New → Project**). Framework preset: **Other**. Root directory: repository root. The build and output settings come from `vercel.json`.
2. In **Settings → Environment Variables**, add `ADMIN_TOKEN` (a long random value). Optionally `SEED`.
3. Deploy. The first request of each new instance generates the dataset (about 0.2-0.6 s depending on the function CPU), then requests are served from memory.

CLI equivalent:

```bash
npm i -g vercel
vercel link
vercel env add ADMIN_TOKEN production
vercel deploy --prod
```

### Database on Vercel (data saved, initialised at the first connection)

1. In the Vercel project: **Storage → Create Database → Neon (Postgres)**, or **Marketplace → Neon**, and connect it to the project for every environment. The integration adds `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`… to the project's environment variables. Any PostgreSQL 14+ works too: set `DATABASE_URL` yourself (with `sslmode=require`).
2. Redeploy (environment variables are read at deployment).
3. Open the application or call `GET /api/v1/health`. At the first connection the function:
   - connects with the direct (unpooled) URL and takes a PostgreSQL advisory lock, so that only one instance initialises the database even if several start together;
   - applies the migrations (`pkg/pg/migrations`);
   - if the database is empty, generates the reference dataset (seed `SEED`, default 42) and stores the configuration (stock points, carriers, services, hubs, legs, routes, delivery modes, rate cards, additional services, stock views, scenarios, settings) and the 12,000-article catalog with COPY. With the default `STOCK_STORAGE=delta` this takes well under a second locally and a few seconds on a remote database, so it fits within the function timeout;
   - releases the lock; other instances then load the data.
4. From then on, every change made in the admin (configuration, articles, stock) is written to PostgreSQL. With `delta` storage, a stock change is stored as a row of `stock_lines` that overrides the generated baseline. Check the state with `GET /api/v1/admin/database` (admin token): seed, stock storage, number of stored stock rows, initialisation date.

The same initialisation can be run from a machine (for example to choose the seed or the storage mode):

```bash
# re-initialise (replaces the content)
DATABASE_URL_UNPOOLED="postgres://…" go run ./cmd/seed -seed 42 -storage delta
# only if the database is empty
go run ./cmd/seed -db "postgres://…" -if-empty
# store all 1.2M stock lines (about 30 s locally, longer remotely)
go run ./cmd/seed -db "postgres://…" -storage full
```

`POST /api/v1/admin/reseed` with `{"seed": 42, "stockStorage": "delta"}` does it from the API (admin token).

The pooled URL (`…-pooler…`) is used at runtime with the simple query protocol; the direct URL is used for migrations, the lock and the COPY loads.

### What to know about Vercel

- **Several instances.** Vercel runs several instances of the function. With a database, every write (configuration, carrier routes, zones, stock, articles, reseed) is appended to a `change_log` table, and each instance applies the changes it has not seen yet, at most once per `SYNC_INTERVAL_MS` (1 s by default), on its next request: a creation made on one instance is visible on the others within about a second. Without a database, admin changes and the live metrics belong to the instance that handled them and are lost when it is recycled.
- **Built-in benchmarks** run synchronously inside one function invocation and are capped at 25 s (`maxDuration` 60 s). They measure the function instance, not Vercel's network. Run k6 from your machine against the deployment URL to measure end-to-end latency over the Internet: `BASE_URL=https://<project>.vercel.app make benchmark`.
- **Cold starts** add the dataset generation to the first request of an instance; k6 results include them (nothing is excluded).

## 2. GCP Cloud Run + Cloud SQL

### One-time setup

```bash
PROJECT=my-project
REGION=europe-west1
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

# container registry
gcloud artifacts repositories create dp100ms --repository-format=docker --location=$REGION

# PostgreSQL
gcloud sql instances create dp100ms --database-version=POSTGRES_16 --region=$REGION \
  --tier=db-custom-1-3840 --storage-size=20GB
gcloud sql databases create dp --instance=dp100ms
gcloud sql users create dp --instance=dp100ms --password='<db-password>'

# secrets (Cloud Run connects through the Cloud SQL Unix socket)
printf '%s' "postgres://dp:<db-password>@/dp?host=/cloudsql/$PROJECT:$REGION:dp100ms" | \
  gcloud secrets create dp100ms-database-url --data-file=-
openssl rand -hex 24 | tr -d '\n' | gcloud secrets create dp100ms-admin-token --data-file=-

# let Cloud Run read the secrets and reach Cloud SQL
SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for s in dp100ms-database-url dp100ms-admin-token; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/cloudsql.client
```

### Build and deploy

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=$REGION,_SERVICE=dp100ms,_SQL_INSTANCE=$PROJECT:$REGION:dp100ms,SHORT_SHA=$(git rev-parse --short HEAD)
```

`cloudbuild.yaml` builds the image (frontend + API), pushes it to Artifact Registry and deploys Cloud Run with 2 vCPU, 1 GiB, concurrency 250, min 1 instance (no cold start on the first request), CPU boost at startup, secrets as environment variables and the Cloud SQL connection. The empty database is migrated and seeded automatically at the first boot (30 to 90 s depending on CPU and database); later boots load it in a few seconds.

### Sizing notes

- One instance with 2 vCPU sustains the throughput measured in `docs/PERFORMANCE.md` for the 2-core configuration. Scale out with `--max-instances`.
- Stock and configuration updates are applied to the instance that receives them, persisted, and applied by the other instances within about `SYNC_INTERVAL_MS` (see `docs/ARCHITECTURE.md`, section 6).
- Keep `--min-instances=1` for latency-sensitive use: the boot loads 1.2M rows.

## 3. Docker Compose (local)

```bash
docker compose up -d      # PostgreSQL + app on http://localhost:8080 (seeded at first boot)
make seed                 # regenerate the dataset (SEED=42 by default), then: docker compose restart app
make test
make benchmark            # k6 matrix against http://localhost:8080
make benchmark-report     # docs/PERFORMANCE.md
```

Without Docker: `make dev` runs the API on :8080 with an in-memory dataset and `cd web && npm run dev` serves the frontend on :5173 with a proxy to the API.

## Response time diagnostics

Every response carries headers to tell the engine time from the platform and network time (visible in Postman → Headers or the browser devtools):

| Header | Meaning |
|---|---|
| `X-Calculation-Time-Ms`, `Server-Timing: engine` | time spent in the promise engine |
| `X-Instance-Cold-Start: true`, `Server-Timing: bootstrap` | first request of a new function instance: it paid the bootstrap (dataset generation, database load) |
| `X-Instance-Uptime-S` | age of the instance that answered |
| `X-Function-Region` | Vercel region of the function (`VERCEL_REGION`) |
| `x-vercel-id` (added by Vercel) | `<edge POP>::<function region>::<id>`, e.g. `cdg1::iad1::…` = entered in Paris, executed in Washington |

A Postman TTFB much larger than `X-Calculation-Time-Ms` comes from the network round trip to the function region (about 90-100 ms per round trip between France and the default US region `iad1`), Vercel routing and, on a cold start, the bootstrap (hundreds of ms to seconds). Pin the function next to the users and the database with `"regions": ["fra1"]` (or `["cdg1"]`) in `vercel.json`.
