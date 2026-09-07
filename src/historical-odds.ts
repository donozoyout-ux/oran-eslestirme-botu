import type { EventPhase, FixtureResultStatus, MarketKey, PeriodKey } from "./domain.js";

export type HistoricalSnapshotType = "opening" | "prematch" | "closing" | "halftime" | "live";

export interface ProviderEventReference {
  provider: string;
  eventId: string;
}

/** Bir gercek mac icin tek kayit; oran gozlemleri ayri tutulur. */
export interface HistoricalCompletedFixture {
  canonicalEventId: string;
  providerEventIds: ProviderEventReference[];
  league: string;
  normalizedLeagueKey: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  fixtureResult: FixtureResultStatus;
  homeScore?: number;
  awayScore?: number;
  halftimeHomeScore?: number;
  halftimeAwayScore?: number;
  archivedAt: string;
  resultConflict?: boolean;
  resultConflicts?: Array<{
    provider: string;
    homeScore: number;
    awayScore: number;
    observedAt: string;
  }>;
}

/** Bir mac kaydindan bagimsiz, tek bookmaker/market/secim fiyat gozlemi. */
export interface HistoricalOddsSnapshot {
  id: string;
  canonicalEventId: string;
  provider: string;
  sourceEventId: string;
  league: string;
  normalizedLeagueKey: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  snapshotAt: string;
  providerUpdatedAt: string;
  snapshotType: HistoricalSnapshotType;
  phase: EventPhase;
  marketKey: MarketKey;
  market: string;
  period: PeriodKey;
  selectionKey: string;
  selection: string;
  line: number | null;
  bookmakerKey: string;
  bookmaker: string;
  price: number;
}

export interface HistoricalEventData {
  fixture?: HistoricalCompletedFixture;
  snapshots: HistoricalOddsSnapshot[];
}

export interface HistoricalQuery {
  normalizedLeagueKey?: string;
  after?: string;
  before?: string;
  excludeCanonicalEventId?: string;
  limit?: number;
}

export interface HistoricalRepositoryStats {
  storage: "memory" | "json" | "postgres";
  completedFixtures: number;
  oddsSnapshots: number;
  oldestEvent: string | null;
  newestEvent: string | null;
  lastArchiveWrite: string | null;
  health: "ok" | "error";
  lastError: string | null;
}

export interface HistoricalEventCompleteness {
  canonicalEventId: string;
  hasResult: boolean;
  hasHalftimeScore: boolean;
  hasPrematchOdds: boolean;
  hasAsianHandicap: boolean;
  hasTotalGoals: boolean;
  hasOpeningOdds: boolean;
  hasClosingOdds: boolean;
  hasAhAndOuClosing: boolean;
  bookmakerCount: number;
  snapshotCount: number;
  patternEligible: boolean;
}

export interface HistoricalCompletenessSummary {
  totalEvents: number;
  withResults: number;
  withClosingOdds: number;
  withAhAndOuClosing: number;
  patternEligible: number;
}
