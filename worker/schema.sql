CREATE TABLE IF NOT EXISTS crawled_pages (
  url_hash     TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  title        TEXT,
  content      TEXT,
  raw_markdown TEXT,
  crawled_at   INTEGER NOT NULL,
  ttl_hours    INTEGER DEFAULT 24
);

CREATE TABLE IF NOT EXISTS search_log (
  id           TEXT PRIMARY KEY,
  query        TEXT NOT NULL,
  urls         TEXT NOT NULL,
  summary      TEXT,
  neurons_used INTEGER,
  latency_ms   INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_log_query ON search_log(query);
