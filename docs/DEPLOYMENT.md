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
| `DATABASE_URL` | unset | PostgreSQL URL. Enables migrations, persistence and loading at boot (auto-seeded when empty). |
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

### Optional database on Vercel

Add a PostgreSQL database (Vercel Marketplace → Neon, or any PostgreSQL 14+) and set `DATABASE_URL` (with `sslmode=require`). Run the seed once from your machine: `DATABASE_URL=… make seed`. Each cold start then loads the 1.2M stock lines from the database (about 1-3 s depending on the database location) and admin changes are persisted.

### What to know about Vercel

- **State is per instance.** Without a database, admin changes and the live metrics belong to the instance that handled them, and are lost when the instance is recycled. Several instances can coexist under load.
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
- Stock updates are applied to the instance that receives them and persisted; other instances see them after a restart (see `docs/ARCHITECTURE.md`, section 6). For multi-instance freshness, add a Pub/Sub topic of stock batches consumed by every instance.
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
