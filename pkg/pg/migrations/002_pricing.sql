-- Rate cards, additional services and stock views (JSONB documents), and
-- the stock storage mode of the dataset.

CREATE TABLE IF NOT EXISTS rate_cards (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    scope      text GENERATED ALWAYS AS (data->>'scope') STORED,
    carrier_id text GENERATED ALWAYS AS (data->>'carrierId') STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS additional_services (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_views (
    id         text PRIMARY KEY,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 'full': every stock line is stored in stock_lines.
-- 'delta': stock_lines only holds the lines changed since the initial
-- generation; the baseline is regenerated from the seed at boot.
ALTER TABLE dataset_meta ADD COLUMN IF NOT EXISTS stock_mode text NOT NULL DEFAULT 'full';
ALTER TABLE dataset_meta ADD COLUMN IF NOT EXISTS initialized_at timestamptz;

-- article dimensions, price and free attributes (rules may use any of them)
ALTER TABLE skus ADD COLUMN IF NOT EXISTS length_cm numeric(8,1) NOT NULL DEFAULT 0;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS width_cm numeric(8,1) NOT NULL DEFAULT 0;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS height_cm numeric(8,1) NOT NULL DEFAULT 0;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS price_eur numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS attributes jsonb;
