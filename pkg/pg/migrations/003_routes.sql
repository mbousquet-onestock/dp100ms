-- Zones and carrier routes (origin zone -> destination zone per carrier
-- service, with cost grid, transit, weekly planning and metadata).

CREATE TABLE IF NOT EXISTS zones (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carrier_routes (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    carrier_id text GENERATED ALWAYS AS (data->>'carrierId') STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS carrier_routes_carrier ON carrier_routes (carrier_id);
