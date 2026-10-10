-- Delivery Promise Engine — initial schema.
-- Configuration entities are stored as JSONB documents with generated key
-- columns (schema evolves with the Go model without migrations for every
-- new optional field); the high-volume catalog and stock lines are
-- relational.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_points (
    id          text PRIMARY KEY,
    data        jsonb NOT NULL,
    type        text GENERATED ALWAYS AS (data->>'type') STORED,
    postal_code text GENERATED ALWAYS AS (data->'address'->>'postalCode') STORED,
    active      boolean GENERATED ALWAYS AS ((data->>'active')::boolean) STORED,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_points_type_idx ON stock_points (type);

CREATE TABLE IF NOT EXISTS carriers (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carrier_services (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    carrier_id text GENERATED ALWAYS AS (data->>'carrierId') STORED,
    kind       text GENERATED ALWAYS AS (data->>'kind') STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_services_carrier_idx ON carrier_services (carrier_id);

CREATE TABLE IF NOT EXISTS hubs (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    kind       text GENERATED ALWAYS AS (data->>'kind') STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legs (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    from_node  text GENERATED ALWAYS AS (data->>'from') STORED,
    to_node    text GENERATED ALWAYS AS (data->>'to') STORED,
    service_id text GENERATED ALWAYS AS (data->>'serviceId') STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legs_from_idx ON legs (from_node);
CREATE INDEX IF NOT EXISTS legs_to_idx ON legs (to_node);

CREATE TABLE IF NOT EXISTS routes (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_modes (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenarios (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS benchmarks (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    started_at text GENERATED ALWAYS AS (data->>'startedAt') STORED, -- RFC 3339, sortable
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_meta (
    id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    seed       bigint NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),
    config     jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS skus (
    position  integer NOT NULL UNIQUE,
    code      text PRIMARY KEY,
    name      text NOT NULL,
    category  text NOT NULL,
    weight_kg numeric(8,3) NOT NULL CHECK (weight_kg >= 0),
    volume_l  numeric(8,2) NOT NULL CHECK (volume_l >= 0)
);

CREATE TABLE IF NOT EXISTS stock_lines (
    stock_point_id text NOT NULL REFERENCES stock_points(id) ON DELETE CASCADE,
    sku            text NOT NULL REFERENCES skus(code),
    physical       integer NOT NULL CHECK (physical >= 0),
    reserved       integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    listed         boolean NOT NULL DEFAULT true,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (stock_point_id, sku)
);
CREATE INDEX IF NOT EXISTS stock_lines_sku_idx ON stock_lines (sku);
