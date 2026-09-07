export const HISTORICAL_POSTGRES_MIGRATION = `
CREATE TABLE IF NOT EXISTS historical_events (
  canonical_event_id text PRIMARY KEY,
  normalized_league_key text NOT NULL,
  league_name text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  kickoff timestamptz NOT NULL,
  result_status text NOT NULL,
  home_score integer,
  away_score integer,
  halftime_home_score integer,
  halftime_away_score integer,
  result_conflict boolean NOT NULL DEFAULT false,
  result_conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_provider_events (
  canonical_event_id text NOT NULL REFERENCES historical_events(canonical_event_id) ON DELETE CASCADE,
  provider text NOT NULL,
  source_event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, source_event_id)
);

CREATE TABLE IF NOT EXISTS historical_odds_snapshots (
  id text PRIMARY KEY,
  canonical_event_id text NOT NULL,
  provider text NOT NULL,
  source_event_id text NOT NULL,
  league_name text NOT NULL,
  normalized_league_key text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  kickoff timestamptz NOT NULL,
  snapshot_type text NOT NULL,
  phase text NOT NULL,
  market_key text NOT NULL,
  market_name text NOT NULL,
  period text NOT NULL,
  selection_key text NOT NULL,
  selection_name text NOT NULL,
  line double precision,
  bookmaker_key text NOT NULL,
  bookmaker_name text NOT NULL,
  price double precision NOT NULL,
  captured_at timestamptz NOT NULL,
  provider_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_ingestion_checkpoints (
  source text PRIMARY KEY,
  cursor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS historical_events_league_kickoff_idx ON historical_events(normalized_league_key, kickoff DESC);
CREATE INDEX IF NOT EXISTS historical_events_kickoff_idx ON historical_events(kickoff DESC);
CREATE INDEX IF NOT EXISTS historical_provider_events_canonical_idx ON historical_provider_events(canonical_event_id);
CREATE INDEX IF NOT EXISTS historical_snapshots_canonical_idx ON historical_odds_snapshots(canonical_event_id);
CREATE INDEX IF NOT EXISTS historical_snapshots_market_line_idx ON historical_odds_snapshots(market_key, line);
CREATE INDEX IF NOT EXISTS historical_snapshots_type_bookmaker_idx ON historical_odds_snapshots(snapshot_type, bookmaker_key);
CREATE INDEX IF NOT EXISTS historical_snapshots_provider_event_idx ON historical_odds_snapshots(provider, source_event_id);
`;
