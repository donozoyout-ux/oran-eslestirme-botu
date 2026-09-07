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
  /** Providerlar arasi resolver tarafindan atanan, kaynak ID'sinden bagimsiz mac kimligi. */
  canonicalEventId?: string;
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

export type FixtureResultStatus = "scheduled" | "live" | "finished" | "cancelled";

export interface MatchFixture {
  provider: string;
  sourceEventId: string;
  canonicalEventId?: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  phase: EventPhase;
  sourceUrl?: string;
  lastOddsCheckAt?: string;
  nextOddsCheckAt?: string;
  resultStatus?: FixtureResultStatus;
  homeScore?: number;
  awayScore?: number;
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

export interface OddsAnalysisSignal {
  id: string;
  type: "close_odds" | "odds_drop" | "odds_rise" | "source_outlier" | "arbitrage";
  event: string;
  market: string;
  selection: string;
  line: number | null;
  detail: string;
  detectedAt: string;
  bookmaker?: string;
  openingPrice?: number;
  currentPrice?: number;
  changePercent?: number;
  consensusPrice?: number;
  fairProbabilityPercent?: number;
  sourceCount?: number;
  confidenceScore?: number;
  arbitrageMarginPercent?: number;
  notifiedAt?: string;
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
  sendAnalysisSignal?(signal: OddsAnalysisSignal): Promise<void>;
}

export interface AlertStore {
  shouldSend(alertId: string, now: Date, state?: AlertSignalState): boolean;
  markSent(alertId: string, now: Date, state?: AlertSignalState): Promise<void>;
}

export interface AlertMetricThreshold {
  absolute?: number;
  relativePercent?: number;
}

/**
 * Alert ID'sini degistirmeden, ayni sinyalin gercekten yeni bir duruma gecip
 * gecmedigini olcmek icin saklanan kucuk durum ozeti.
 */
export interface AlertSignalState {
  stateKey: string;
  metrics: Record<string, number>;
  thresholds: Record<string, AlertMetricThreshold>;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  quotesFetched: number;
  quotesFresh: number;
  matchesFound: number;
  alertsSent: number;
  movementAlertsSent: number;
  marketAnalysisAlertsSent?: number;
  consensusSignalsFound?: number;
  arbitrageFound?: number;
  alertsSuppressed: number;
}
