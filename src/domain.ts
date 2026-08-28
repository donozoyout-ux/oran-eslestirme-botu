export type EventPhase = "prematch" | "live";

export type MarketKey =
  | "match_winner_3way"
  | "match_winner_2way"
  | "total_goals"
  | "handicap"
  | "both_teams_to_score"
  | "double_chance"
  | "correct_score"
  | "corners"
  | "cards"
  | "player_prop"
  | `custom:${string}`;

export type PeriodKey = "full_time" | "first_half" | "second_half" | `custom:${string}`;

export interface OddsQuote {
  provider: string;
  bookmakerKey: string;
  bookmakerName: string;
  sourceEventId: string;
  sportKey: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  phase: EventPhase;
  marketKey: MarketKey;
  marketName: string;
  period: PeriodKey;
  selectionKey: string;
  selectionName: string;
  line: number | null;
  price: number;
  updatedAt: string;
  sourceUrl?: string;
}

export interface MatchFixture {
  provider: string;
  sourceEventId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  phase: EventPhase;
  sourceUrl?: string;
  lastOddsCheckAt?: string;
  nextOddsCheckAt?: string;
}

export interface OddsMatch {
  id: string;
  eventKey: string;
  marketSignature: string;
  phase: EventPhase;
  relativeDifferencePercent: number;
  quoteA: OddsQuote;
  quoteB: OddsQuote;
  detectedAt: string;
}

export interface OddsProvider {
  readonly name: string;
  fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]>;
  getLastFixtures?(): MatchFixture[];
  close?(): Promise<void>;
}

export interface Notifier {
  readonly name: string;
  send(match: OddsMatch): Promise<void>;
}

export interface AlertStore {
  shouldSend(alertId: string, now: Date): boolean;
  markSent(alertId: string, now: Date): Promise<void>;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  quotesFetched: number;
  quotesFresh: number;
  matchesFound: number;
  alertsSent: number;
  alertsSuppressed: number;
}
