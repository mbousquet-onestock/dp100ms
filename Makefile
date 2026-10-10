# Delivery Promise Engine — developer commands.
SHELL := /bin/bash
DATABASE_URL ?= postgres://dp:dp@localhost:5432/dp?sslmode=disable
BASE_URL ?= http://localhost:8080
SEED ?= 42
GO ?= go

.PHONY: up down dev run build web seed seed-csv test test-race test-short lint openapi benchmark benchmark-quick benchmark-report bench-go clean

up: ## Start PostgreSQL + app (http://localhost:8080)
	docker compose up -d --build

down:
	docker compose down

dev: ## Run the API locally (in-memory dataset) on :8080
	$(GO) run ./cmd/server

run: build
	STATIC_DIR=web/dist ./bin/server

build: web
	$(GO) build -o bin/server ./cmd/server
	$(GO) build -o bin/seed ./cmd/seed

web:
	cd web && npm ci && npm run build

seed: ## Generate the reference dataset (seed $(SEED)) and write it to PostgreSQL
	@if command -v $(GO) >/dev/null 2>&1; then \
		DATABASE_URL="$(DATABASE_URL)" $(GO) run ./cmd/seed -seed $(SEED); \
	else \
		SEED=$(SEED) docker compose run --rm seed; \
	fi
	@echo "Restart the app to load the new dataset: docker compose restart app"

seed-csv: ## Export the dataset as CSV into data/
	$(GO) run ./cmd/seed -seed $(SEED) -csv data

test: ## Go tests (unit, functional, integration, API) + frontend type check
	$(GO) vet ./...
	$(GO) test -count=1 ./...
	@if [ -d web/node_modules ]; then cd web && npm run lint; fi

test-race:
	$(GO) test -race -count=1 ./...

test-short:
	$(GO) test -short ./...

lint:
	$(GO) vet ./...
	test -z "$$(gofmt -l pkg cmd api)"

openapi: ## Regenerate pkg/api/openapi.json from docs/openapi.yaml
	python3 scripts/openapi.py

benchmark: ## k6 load tests (reference matrix) against $(BASE_URL)
	BASE_URL=$(BASE_URL) ./bench/run.sh

benchmark-quick:
	BASE_URL=$(BASE_URL) QUICK=1 ./bench/run.sh

benchmark-report: ## Build docs/PERFORMANCE.md from bench/results
	$(GO) run ./cmd/benchreport -in bench/results -out docs/PERFORMANCE.md

bench-go: ## Go micro-benchmark of the engine (no HTTP)
	$(GO) test -run xxx -bench BenchmarkPromiseReference -benchmem ./pkg/engine/

clean:
	rm -rf bin web/dist
