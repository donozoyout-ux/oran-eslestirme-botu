import type {
  EventPhase,
  FixtureResultStatus,
  MarketKey,
  MatchFixture,
  OddsProvider,
  OddsQuote,
  PeriodKey,
} from "../domain.js";
import { isLeagueLabelInScope, type LeagueScope } from "../league-scope.js";
import { logger } from "../logger.js";
import { setProviderDiagnostic } from "../provider-diagnostics.js";

interface SportmonksEnvelope<T> {
  data?: T[];
  pagination?: {
    current_page?: number;
    has_more?: boolean;
    next_page?: string | null;
  };
  rate_limit?: {
    remaining?: number;
    resets_in_seconds?: number;
    requested_entity?: string;
  };
  message?: string;
  error?: string;
}

interface SportmonksParticipant {
  id?: number;
  name?: string;
  meta?: { location?: string };
}

interface SportmonksScore {
  participant_id?: number;
  description?: string;
  score?: {
    goals?: number;
    participant?: string;
  };
}

interface SportmonksOdd {
  id?: number;
  fixture_id?: number;
  market_id?: number;
  bookmaker_id?: number;
  label?: string;
  value?: string | number;
  name?: string;
  market_description?: string;
  total?: string | number | null;
  handicap?: string | number | null;
  original_label?: string | number | null;
  suspended?: boolean;
  stopped?: boolean;
  updated_at?: string;
  bookmaker?: { id?: number; name?: string };
  market?: { id?: number; name?: string; developer_name?: string };
}

interface SportmonksFixture {
  id?: number;
  league_id?: number;
  state_id?: number;
  name?: string;
  starting_at?: string;
  starting_at_timestamp?: number;
  participants?: SportmonksParticipant[];
  league?: {
    id?: number;
    name?: string;
    country?: { name?: string; official_name?: string };
  };
  state?: { id?: number; name?: string; short_name?: string; developer_name?: string };
  scores?: SportmonksScore[];
  odds?: SportmonksOdd[];
  inplayOdds?: SportmonksOdd[];
  inplay_odds?: SportmonksOdd[];
}

export interface SportmonksProviderOptions {
  apiToken: string;
  bookmakerKeys: string[];
  refreshMinutes: number;
  maxPages: number;
  leagueScope: LeagueScope;
  maxLiveEventAgeMinutes: number;
  includeOdds?: boolean;
  baseUrl?: string;
  requestTimeoutMs?: number;
}

class SportmonksHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Sportmonks ${status}: ${body.slice(0, 400)}`);
  }
}

const LIVE_STATES = new Set([
  "inplay", "in_play", "live", "1h", "2h", "ht", "et", "break", "pen_live",
]);
const FINISHED_STATES = new Set(["ft", "finished", "aet", "after_extra_time", "pen", "ended"]);
const CANCELLED_STATES = new Set([
  "cancelled", "canceled", "postponed", "suspended", "abandoned", "walkover", "deleted",
]);

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function canonical(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function bookmakerKey(name: string, id: number | undefined): string {
  const key = canonical(name);
  if (key === "betfair_exchange" || key === "betfair_ex") return "betfair_ex_eu";
  return key || `sportmonks_bookmaker_${id ?? "unknown"}`;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function commenceTime(fixture: SportmonksFixture): string | null {
  if (typeof fixture.starting_at_timestamp === "number" && Number.isFinite(fixture.starting_at_timestamp)) {
    return new Date(fixture.starting_at_timestamp * 1_000).toISOString();
  }
  const raw = fixture.starting_at?.trim();
  if (!raw) return null;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    ? raw
    : `${raw.replace(" ", "T")}+03:00`;
  const timestamp = Date.parse(withZone);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stateKey(fixture: SportmonksFixture): string {
  return canonical(
    fixture.state?.developer_name
      ?? fixture.state?.short_name
      ?? fixture.state?.name
      ?? "",
  );
}

function resultStatus(fixture: SportmonksFixture, kickoff: string, now: Date): FixtureResultStatus {
  const state = stateKey(fixture);
  if (FINISHED_STATES.has(state)) return "finished";
  if (CANCELLED_STATES.has(state)) return "cancelled";
  if (LIVE_STATES.has(state)) return "live";
  const kickoffMs = Date.parse(kickoff);
  if (Number.isFinite(kickoffMs) && kickoffMs <= now.getTime() && now.getTime() - kickoffMs <= 4 * 60 * 60_000) {
    return "live";
  }
  return "scheduled";
}

function fixtureTeams(fixture: SportmonksFixture): {
  home?: SportmonksParticipant;
  away?: SportmonksParticipant;
} {
  const participants = fixture.participants ?? [];
  const home = participants.find((participant) => canonical(participant.meta?.location ?? "") === "home")
    ?? participants[0];
  const away = participants.find((participant) => canonical(participant.meta?.location ?? "") === "away")
    ?? participants.find((participant) => participant.id !== home?.id);
  return { home, away };
}

function currentScore(
  scores: SportmonksScore[] | undefined,
  side: "home" | "away",
  participantId: number | undefined,
): number | undefined {
  const candidates = (scores ?? []).filter((score) => {
    const scoreSide = canonical(score.score?.participant ?? "");
    return scoreSide === side || (participantId !== undefined && score.participant_id === participantId);
  });
  const current = candidates.find((score) => canonical(score.description ?? "") === "current") ?? candidates.at(-1);
  return typeof current?.score?.goals === "number" ? current.score.goals : undefined;
}

function periodFromMarket(name: string): PeriodKey {
  const value = canonical(name);
  if (value.includes("first_half") || value.includes("1st_half") || value.startsWith("1h_")) return "first_half";
  if (value.includes("second_half") || value.includes("2nd_half") || value.startsWith("2h_")) return "second_half";
  return "full_time";
}

function marketFromOdd(odd: SportmonksOdd): { key: MarketKey; name: string } {
  const name = odd.market?.developer_name
    ?? odd.market?.name
    ?? odd.market_description
    ?? `Sportmonks Market ${odd.market_id ?? "Unknown"}`;
  const value = canonical(name);
  if (value.includes("corner")) return { key: "corners", name };
  if (value.includes("card") || value.includes("booking")) return { key: "cards", name };
  if (value.includes("both_teams") && value.includes("score")) return { key: "both_teams_to_score", name };
  if (value.includes("double_chance")) return { key: "double_chance", name };
  if (value.includes("correct_score")) return { key: "correct_score", name };
  if (value.includes("draw_no_bet") || value.includes("2_way")) return { key: "match_winner_2way", name };
  if (value.includes("handicap")) return { key: "handicap", name };
  if (value.includes("over_under") || value.includes("total_goal") || value.includes("goals_total")) {
    return { key: "total_goals", name };
  }
  if (value.includes("match_winner") || value.includes("fulltime_result") || value.includes("full_time_result")) {
    return { key: "match_winner_3way", name };
  }
  if (value.includes("player")) return { key: "player_prop", name };
  return { key: `custom:sportmonks:${odd.market_id ?? canonical(name)}`, name };
}

function selectionFor(
  odd: SportmonksOdd,
  marketKey: MarketKey,
  homeTeam: string,
  awayTeam: string,
): { key: string; name: string; line: number | null } {
  const raw = String(odd.label ?? odd.name ?? "").trim();
  const name = odd.name?.trim() || raw;
  const value = canonical(raw);
  const line = numberFrom(odd.total) ?? numberFrom(odd.original_label) ?? numberFrom(odd.handicap);

  if (["total_goals", "corners", "cards"].includes(marketKey)) {
    if (value.includes("over") || value.includes("ust")) return { key: "over", name: "Üst", line };
    if (value.includes("under") || value.includes("alt")) return { key: "under", name: "Alt", line };
  }
  if (marketKey === "both_teams_to_score") {
    if (["yes", "evet"].includes(value)) return { key: "yes", name: "Evet", line: null };
    if (["no", "hayir"].includes(value)) return { key: "no", name: "Hayır", line: null };
  }
  if (marketKey === "double_chance") {
    const compact = raw.replace(/\s+/g, "").toUpperCase();
    if (compact === "1X" || compact === "X1") return { key: "home_or_draw", name: "1X", line: null };
    if (compact === "X2" || compact === "2X") return { key: "draw_or_away", name: "X2", line: null };
    if (compact === "12" || compact === "21") return { key: "home_or_away", name: "12", line: null };
  }

  const rawOrName = canonical(`${raw} ${name}`);
  if (value === "1" || value === "home" || rawOrName.includes(canonical(homeTeam))) {
    return { key: "home", name: homeTeam, line: marketKey === "handicap" ? line : null };
  }
  if (value === "2" || value === "away" || rawOrName.includes(canonical(awayTeam))) {
    return { key: "away", name: awayTeam, line: marketKey === "handicap" ? line : null };
  }
  if (value === "x" || value === "draw") return { key: "draw", name: "Beraberlik", line: null };
  return {
    key: `name:${canonical(raw || name || String(odd.id ?? "unknown"))}`,
    name: name || raw || "Seçim",
    line,
  };
}

export class SportmonksProvider implements OddsProvider {
  readonly name = "sportmonks";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private lastFixtures: MatchFixture[] = [];
  private cachedQuotes: OddsQuote[] = [];
  private lastAttemptAt: number | null = null;
  private oddsAccessAvailable: boolean;
  private remainingRequests: number | null = null;
  private resetSeconds: number | null = null;

  constructor(private readonly options: SportmonksProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.sportmonks.com/v3/football";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.oddsAccessAvailable = options.includeOdds ?? true;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = new Date();
    if (
      this.lastAttemptAt !== null
      && now.getTime() - this.lastAttemptAt < this.options.refreshMinutes * 60_000
    ) {
      return [...this.cachedQuotes];
    }
    this.lastAttemptAt = now.getTime();

    let fixtures: SportmonksFixture[];
    try {
      fixtures = await this.fetchFixtures(dayKey(now), this.oddsAccessAvailable, signal);
    } catch (error) {
      if (this.oddsAccessAvailable && error instanceof SportmonksHttpError && [400, 403].includes(error.status)) {
        this.oddsAccessAvailable = false;
        logger.warn("Sportmonks paketinde odds erişimi yok; fikstür/skor moduyla devam ediliyor.", {
          status: error.status,
        });
        fixtures = await this.fetchFixtures(dayKey(now), false, signal);
      } else {
        this.updateDiagnostic(now, "error", error instanceof Error ? error.message : String(error));
        throw error;
      }
    }

    const mappedFixtures: MatchFixture[] = [];
    const quotes: OddsQuote[] = [];
    for (const fixture of fixtures) {
      const mapped = this.mapFixture(fixture, now);
      if (!mapped) continue;
      mappedFixtures.push(mapped);
      quotes.push(...this.mapOdds(fixture, mapped, now));
    }
    this.lastFixtures = mappedFixtures;
    this.cachedQuotes = quotes;
    this.updateDiagnostic(now, "ok", null);

    logger.info("Sportmonks veri turu tamamlandı.", {
      fixtures: mappedFixtures.length,
      quotes: quotes.length,
      oddsMode: this.oddsAccessAvailable ? "fixtures_and_odds" : "fixtures_only",
      remainingRequests: this.remainingRequests,
    });
    return [...quotes];
  }

  getLastFixtures(): MatchFixture[] {
    return [...this.lastFixtures];
  }

  private async fetchFixtures(date: string, includeOdds: boolean, signal?: AbortSignal): Promise<SportmonksFixture[]> {
    const all: SportmonksFixture[] = [];
    for (let page = 1; page <= this.options.maxPages; page += 1) {
      const response = await this.requestPage(date, page, includeOdds, signal);
      all.push(...(response.data ?? []));
      if (!response.pagination?.has_more) break;
    }
    return all;
  }

  private async requestPage(
    date: string,
    page: number,
    includeOdds: boolean,
    signal?: AbortSignal,
  ): Promise<SportmonksEnvelope<SportmonksFixture>> {
    const url = new URL(`${this.baseUrl}/fixtures/date/${encodeURIComponent(date)}`);
    url.searchParams.set("timezone", "Europe/Istanbul");
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    const includes = ["participants", "league.country", "state", "scores"];
    if (includeOdds) {
      includes.push("odds.bookmaker", "odds.market", "inplayOdds.bookmaker", "inplayOdds.market");
    }
    url.searchParams.set("include", includes.join(";"));

    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, {
      headers: {
        Authorization: this.options.apiToken,
        accept: "application/json",
      },
      signal: requestSignal,
    });
    const text = await response.text();
    if (!response.ok) throw new SportmonksHttpError(response.status, text);
    let parsed: SportmonksEnvelope<SportmonksFixture>;
    try {
      parsed = JSON.parse(text) as SportmonksEnvelope<SportmonksFixture>;
    } catch {
      throw new Error(`Sportmonks geçersiz JSON döndürdü: ${text.slice(0, 200)}`);
    }
    this.remainingRequests = typeof parsed.rate_limit?.remaining === "number"
      ? parsed.rate_limit.remaining
      : this.remainingRequests;
    this.resetSeconds = typeof parsed.rate_limit?.resets_in_seconds === "number"
      ? parsed.rate_limit.resets_in_seconds
      : this.resetSeconds;
    return parsed;
  }

  private mapFixture(fixture: SportmonksFixture, now: Date): MatchFixture | null {
    const id = fixture.id;
    const kickoff = commenceTime(fixture);
    const { home, away } = fixtureTeams(fixture);
    const leagueName = fixture.league?.name;
    const country = fixture.league?.country?.name ?? fixture.league?.country?.official_name;
    if (!id || !kickoff || !home?.name || !away?.name || !leagueName) return null;
    if (!isLeagueLabelInScope(country, leagueName, this.options.leagueScope)) return null;

    const status = resultStatus(fixture, kickoff, now);
    const kickoffMs = Date.parse(kickoff);
    if (
      status === "live"
      && now.getTime() - kickoffMs > this.options.maxLiveEventAgeMinutes * 60_000
    ) return null;

    const homeScore = currentScore(fixture.scores, "home", home.id);
    const awayScore = currentScore(fixture.scores, "away", away.id);
    return {
      provider: this.name,
      sourceEventId: String(id),
      leagueName,
      homeTeam: home.name,
      awayTeam: away.name,
      commenceTime: kickoff,
      phase: status === "live" ? "live" : "prematch",
      resultStatus: status,
      ...(homeScore === undefined ? {} : { homeScore }),
      ...(awayScore === undefined ? {} : { awayScore }),
    };
  }

  private mapOdds(fixture: SportmonksFixture, mapped: MatchFixture, now: Date): OddsQuote[] {
    if (!this.oddsAccessAvailable || ["finished", "cancelled"].includes(mapped.resultStatus ?? "")) return [];
    const rawOdds = mapped.phase === "live"
      ? (fixture.inplayOdds ?? fixture.inplay_odds ?? [])
      : (fixture.odds ?? []);
    if (rawOdds.length === 0) return [];

    const normalized = rawOdds.map((odd) => {
      const bookmakerName = odd.bookmaker?.name?.trim()
        ?? `Sportmonks Bookmaker ${odd.bookmaker_id ?? "Unknown"}`;
      return { odd, bookmakerName, bookmakerKey: bookmakerKey(bookmakerName, odd.bookmaker_id) };
    });
    const requested = new Set(this.options.bookmakerKeys.map(canonical));
    const requestedAvailable = requested.size === 0
      || normalized.some(({ bookmakerKey: key }) => requested.has(key));

    const quotes: OddsQuote[] = [];
    for (const { odd, bookmakerName, bookmakerKey: key } of normalized) {
      if (requestedAvailable && requested.size > 0 && !requested.has(key)) continue;
      if (odd.suspended === true || odd.stopped === true) continue;
      const price = Number(odd.value);
      if (!Number.isFinite(price) || price <= 1) continue;
      const market = marketFromOdd(odd);
      const selection = selectionFor(odd, market.key, mapped.homeTeam, mapped.awayTeam);
      const updatedAtRaw = odd.updated_at;
      const updatedAt = updatedAtRaw && Number.isFinite(Date.parse(updatedAtRaw))
        ? new Date(updatedAtRaw).toISOString()
        : now.toISOString();
      quotes.push({
        provider: this.name,
        bookmakerKey: key,
        bookmakerName,
        sourceEventId: mapped.sourceEventId,
        sportKey: "soccer",
        leagueName: mapped.leagueName,
        homeTeam: mapped.homeTeam,
        awayTeam: mapped.awayTeam,
        commenceTime: mapped.commenceTime,
        phase: mapped.phase,
        marketKey: market.key,
        marketName: market.name,
        period: periodFromMarket(market.name),
        selectionKey: selection.key,
        selectionName: selection.name,
        line: selection.line,
        price,
        updatedAt,
      });
    }
    return quotes;
  }

  private updateDiagnostic(now: Date, status: "ok" | "error", lastError: string | null): void {
    setProviderDiagnostic(this.name, {
      enabled: true,
      status,
      mode: this.oddsAccessAvailable ? "fixtures_and_odds" : "fixtures_only",
      leagueScope: this.options.leagueScope,
      fixtureCount: this.lastFixtures.length,
      quoteCount: this.cachedQuotes.length,
      lastProviderRunAt: now.toISOString(),
      lastSuccessAt: status === "ok" ? now.toISOString() : null,
      lastError,
      remainingRequests: this.remainingRequests,
      rateLimitResetSeconds: this.resetSeconds,
    });
  }
}
