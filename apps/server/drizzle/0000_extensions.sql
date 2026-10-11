-- Hand-written: drizzle-kit does not generate CREATE EXTENSION.
-- pg_trgm backs the search over items and section bodies. Content is largely
-- Japanese, which to_tsvector does not segment without a dictionary extension,
-- so search is trigram similarity over text rather than full-text search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
