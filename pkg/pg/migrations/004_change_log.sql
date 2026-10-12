-- Change log shared by the instances: every write appends a row; each
-- instance applies the rows it has not seen yet (configuration entities,
-- stock lines, articles, full reloads after a reseed).
CREATE TABLE IF NOT EXISTS change_log (
    seq  bigserial PRIMARY KEY,
    kind text NOT NULL,
    id   text NOT NULL,
    op   text NOT NULL,
    at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_log_at ON change_log (at);
