import type { EventPhase, MarketKey, MatchFixture, OddsProvider, OddsQuote, PeriodKey } from "../domain.js";
import { isLeagueLabelInScope, type LeagueScope } from "../league-scope.js";
import { logger } from "../logger.js";

interface ApiEnvelope<T> {
  errors?: unknown;
  response?: T[];
}

interface ApiFixture {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number; name?: string; country?: string };
  teams?: { home?: { name?: string }; away?: { name?: string } };
}

interface ApiOddValue {
  value?: string;
  odd?: string | number;
  handicap?: string | number | null;
  main?: boolean;
  suspended?: boolean;
}

interface ApiBet {
  id?: number;
  name?: string;
  values?: ApiOddValue[];
}

interface ApiBookmaker {
  id?: number;
  name?: string;
  bets?: ApiBet[];
}

interface ApiOddsItem {
  fixture?: { id?: number };
  update?: string;
  bookmakers?: ApiBookmaker[];
}

export interface ApiFootballProviderOptions {
  apiKey: string;
  bookmakerKeys: string[];
  maxFixtures: number;
  fixtureCacheMinutes: number;
  prematchCacheMinutes: number;
  liveCacheMinutes: number;
  dailyRequestBudget: number;
  leagueScope: LeagueScope;
  maxLiveEventAgeMinutes: number;
  baseUrl?: string;
  requestTimeoutMs?: number;
}

interface CachedFixtureOdds {
  phase: EventPhase;
  fetchedAt: number;
  quotes: OddsQuote[];
}

const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "SUSP", "INT"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "CANC", "ABD", "AWD", "WO", "PST"]);
const LIVE_START_LOOKAHEAD_MINUTES = 10;

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
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function phaseFromStatus(status: string | undefined): EventPhase | null {
  const normalized = status?.toUpperCase() ?? "";
  if (FINISHED_STATUSES.has(normalized)) return null;
  if (LIVE_STATUSES.has(normalized)) return "live";
  return "prematch";
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function periodFromBetName(name: string): PeriodKey {
  const lower = name.toLowerCase();
  if (lower.includes("first half") || lower.includes("1st half")) return "first_half";
  if (lower.includes("second half") || lower.includes("2nd half")) return "second_half";
  return "full_time";
}

function marketFromBetName(name: string): { key: MarketKey; name: string } | null {
  const lower = name.toLowerCase();
  if (lower.includes("corner")) return { key: "corners", name };
  if (lower.includes("card")) return { key: "cards", name };
  if (lower.includes("both teams") && (lower.includes("score") || lower.includes("scoring"))) {
    return { key: "both_teams_to_score", name };
  }
  if (lower.includes("double chance")) return { key: "double_chance", name };
  if (lower.includes("correct score")) return { key: "correct_score", name };
  if (lower.includes("handicap")) return { key: "handicap", name };
  if (lower.includes("over/under") || lower.includes("over under") || lower.includes("total goals") || lower.includes("goals over")) {
    return { key: "total_goals", name };
  }
  if (lower.includes("match winner") || lower === "winner" || lower.includes("result")) {
    return { key: "match_winner_3way", name };
  }
  return null;
}

function selectionFor(
  marketKey: MarketKey,
  rawValue: string,
  homeTeam: string,
  awayTeam: string,
): { key: string; name: string; line: number | null } {
  const value = rawValue.trim();
  const lower = value.toLowerCase();
  const numeric = numberFrom(value);

  if (marketKey === "total_goals" || marketKey === "corners" || marketKey === "cards") {
    if (lower.includes("over")) return { key: "over", name: "Üst", line: numeric };
    if (lower.includes("under")) return { key: "under", name: "Alt", line: numeric };
  }
  if (marketKey === "both_teams_to_score") {
    if (["yes", "evet"].includes(lower)) return { key: "yes", name: "Evet", line: null };
    if (["no", "hayir", "hayır"].includes(lower)) return { key: "no", name: "Hayır", line: null };
  }
  if (marketKey === "double_chance") {
    const compact = lower.replace(/\s+/g, "").toUpperCase();
    if (compact.includes("1X")) return { key: "home_or_draw", name: "1X", line: null };
    if (compact.includes("X2")) return { key: "draw_or_away", name: "X2", line: null };
    if (compact.includes("12")) return { key: "home_or_away", name: "12", line: null };
  }

  const home = canonical(homeTeam);
  const away = canonical(awayTeam);
  const candidate = canonical(value.replace(/[+-]?\d+(?:[.,]\d+)?/g, ""));
  if (lower === "home" || candidate === home || candidate.includes(home)) {
    return { key: "home", name: homeTeam, line: marketKey === "handicap" ? numeric : null };
  }
  if (lower === "away" || candidate === away || candidate.includes(away)) {
    return { key: "away", name: awayTeam, line: marketKey === "handicap" ? numeric : null };
  }
  if (lower === "draw" || lower === "x") return { key: "draw", name: "Beraberlik", line: null };
  return { key: `name:${canonical(value)}`, name: value, line: marketKey === "handicap" ? numeric : null };
}

export class ApiFootballProvider implements OddsProvider {
  readonly name = "api_football";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private scheduledFixtures: MatchFixture[] = [];
  private liveFixtures: MatchFixture[] = [];
  private fixtureFetchedAt = 0;
  private liveFixtureFetchedAt = 0;
  private readonly oddsCache = new Map<string, CachedFixtureOdds>();
  private budgetDay = dayKey(new Date());
  private requestsToday = 0;
  private reportedRemaining: number | null = null;
  private warnedBookmakerFallback = false;

  constructor(private readonly options: ApiFootballProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://v3.football.api-sports.io";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = new Date();
    this.resetBudgetIfNeeded(now);
    await this.refreshFixturesIfDue(now, signal);
    await this.refreshLiveFixturesIfDue(now, signal);

    const selected = this.selectFixtures(now);
    await Promise.all(selected.map((fixture) => this.refreshFixtureOddsIfDue(fixture, now, signal)));

    const activeIds = new Set(selected.map((fixture) => fixture.sourceEventId));
    return [...this.oddsCache.entries()]
      .filter(([id]) => activeIds.has(id))
      .flatMap(([, cached]) => cached.quotes);
  }

  getLastFixtures(): MatchFixture[] {
    return this.currentFixtures(new Date());
  }

  private currentFixtures(now: Date): MatchFixture[] {
    const byId = new Map<string, MatchFixture>();
    const maxLiveAgeMs = this.options.maxLiveEventAgeMinutes * 60_000;
    for (const fixture of this.scheduledFixtures) {
      const kickoff = Date.parse(fixture.commenceTime);
      if (!Number.isFinite(kickoff)) continue;
      if (fixture.phase === "prematch" && kickoff < now.getTime()) continue;
      if (fixture.phase === "live" && now.getTime() - kickoff > maxLiveAgeMs) continue;
      byId.set(fixture.sourceEventId, fixture);
    }
    for (const fixture of this.liveFixtures) {
      const kickoff = Date.parse(fixture.commenceTime);
      if (!Number.isFinite(kickoff) || now.getTime() - kickoff > maxLiveAgeMs) continue;
      byId.set(fixture.sourceEventId, fixture);
    }
    return [...byId.values()];
  }

  private selectFixtures(now: Date): MatchFixture[] {
    return this.currentFixtures(now)
      .sort((a, b) => {
        if (a.phase !== b.phase) return a.phase === "live" ? -1 : 1;
        return Date.parse(a.commenceTime) - Date.parse(b.commenceTime);
      })
      .slice(0, this.options.maxFixtures);
  }

  private fixtureFromApi(item: ApiFixture): MatchFixture | null {
    const id = item.fixture?.id;
    const commenceTime = item.fixture?.date;
    const homeTeam = item.teams?.home?.name;
    const awayTeam = item.teams?.away?.name;
    const phase = phaseFromStatus(item.fixture?.status?.short);
    if (!id || !commenceTime || !homeTeam || !awayTeam || !phase) return null;
    if (!isLeagueLabelInScope(item.league?.country, item.league?.name, this.options.leagueScope)) return null;
    return {
      provider: this.name,
      sourceEventId: String(id),
      leagueName: item.league?.name ?? "Futbol",
      homeTeam,
      awayTeam,
      commenceTime,
      phase,
    };
  }

  private async refreshFixturesIfDue(now: Date, signal?: AbortSignal): Promise<void> {
    if (this.fixtureFetchedAt && now.getTime() - this.fixtureFetchedAt < this.options.fixtureCacheMinutes * 60_000) return;
    if (!this.canRequest()) return;

    const date = dayKey(now);
    const payload = await this.request<ApiFixture>(`/fixtures?date=${encodeURIComponent(date)}&timezone=Europe%2FIstanbul`, signal);
    this.scheduledFixtures = payload.map((item) => this.fixtureFromApi(item)).filter((fixture): fixture is MatchFixture => fixture !== null);
    this.fixtureFetchedAt = now.getTime();
  }

  private shouldCheckLive(now: Date): boolean {
    if (this.liveFixtures.length > 0) return true;
    const nowMs = now.getTime();
    const lookAheadMs = LIVE_START_LOOKAHEAD_MINUTES * 60_000;
    const maxAgeMs = this.options.maxLiveEventAgeMinutes * 60_000;
    return this.scheduledFixtures.some((fixture) => {
      const kickoff = Date.parse(fixture.commenceTime);
      return Number.isFinite(kickoff) && kickoff <= nowMs + lookAheadMs && kickoff >= nowMs - maxAgeMs;
    });
  }

  private async refreshLiveFixturesIfDue(now: Date, signal?: AbortSignal): Promise<void> {
    if (!this.shouldCheckLive(now)) return;
    if (this.liveFixtureFetchedAt && now.getTime() - this.liveFixtureFetchedAt < this.options.liveCacheMinutes * 60_000) return;
    if (!this.canRequest()) return;

    const payload = await this.request<ApiFixture>("/fixtures?live=all&timezone=Europe%2FIstanbul", signal);
    this.liveFixtures = payload
      .map((item) => this.fixtureFromApi(item))
      .filter((fixture): fixture is MatchFixture => fixture?.phase === "live");
    this.liveFixtureFetchedAt = now.getTime();
    logger.info("API-Football canlı maç taraması tamamlandı.", {
      liveFixtures: this.liveFixtures.length,
      requestsToday: this.requestsToday,
      dailyBudget: this.options.dailyRequestBudget,
    });
  }

  private async refreshFixtureOddsIfDue(fixture: MatchFixture, now: Date, signal?: AbortSignal): Promise<void> {
    const cached = this.oddsCache.get(fixture.sourceEventId);
    const cacheMinutes = fixture.phase === "live" ? this.options.liveCacheMinutes : this.options.prematchCacheMinutes;
    if (cached && cached.phase === fixture.phase && now.getTime() - cached.fetchedAt < cacheMinutes * 60_000) return;
    if (!this.canRequest()) return;

    const endpoint = fixture.phase === "live" ? "/odds/live" : "/odds";
    const payload = await this.request<ApiOddsItem>(`${endpoint}?fixture=${encodeURIComponent(fixture.sourceEventId)}`, signal);
    const quotes = this.mapOdds(payload, fixture, now);
    this.oddsCache.set(fixture.sourceEventId, { phase: fixture.phase, fetchedAt: now.getTime(), quotes });
  }

  private mapOdds(items: ApiOddsItem[], fixture: MatchFixture, now: Date): OddsQuote[] {
    const allowed = new Set(this.options.bookmakerKeys.map(canonical));
    const available = new Set(
      items.flatMap((item) => item.bookmakers ?? []).map((bookmaker) => canonical(bookmaker.name ?? "")).filter(Boolean),
    );
    const hasRequestedBookmaker = allowed.size === 0 || [...available].some((key) => allowed.has(key));
    if (!hasRequestedBookmaker && available.size > 0 && !this.warnedBookmakerFallback) {
      this.warnedBookmakerFallback = true;
      logger.warn("API-Football seçili bookmakerları döndürmedi; mevcut bookmakerlar geçici yedek olarak kullanılıyor.", {
        requested: [...allowed],
        available: [...available].slice(0, 12),
      });
    }

    const quotes: OddsQuote[] = [];
    for (const item of items) {
      for (const bookmaker of item.bookmakers ?? []) {
        const bookmakerName = bookmaker.name?.trim();
        if (!bookmakerName) continue;
        const bookmakerKey = canonical(bookmakerName);
        if (hasRequestedBookmaker && allowed.size > 0 && !allowed.has(bookmakerKey)) continue;
        for (const bet of bookmaker.bets ?? []) {
          const betName = bet.name?.trim();
          if (!betName) continue;
          const market = marketFromBetName(betName);
          if (!market) continue;
          const period = periodFromBetName(betName);
          for (const value of bet.values ?? []) {
            if (value.suspended === true || value.main === false) continue;
            const price = Number(value.odd);
            if (!Number.isFinite(price) || price <= 1) continue;
            const rawSelection = value.value?.trim();
            if (!rawSelection) continue;
            const selection = selectionFor(market.key, rawSelection, fixture.homeTeam, fixture.awayTeam);
            const handicap = numberFrom(value.handicap);
            const line = handicap ?? selection.line;
            quotes.push({
              provider: this.name,
              bookmakerKey,
              bookmakerName,
              sourceEventId: fixture.sourceEventId,
              sportKey: "soccer",
              leagueName: fixture.leagueName,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              commenceTime: fixture.commenceTime,
              phase: fixture.phase,
              marketKey: market.key,
              marketName: market.name,
              period,
              selectionKey: selection.key,
              selectionName: selection.name,
              line,
              price,
              updatedAt: item.update ?? now.toISOString(),
            });
          }
        }
      }
    }
    return quotes;
  }

  private resetBudgetIfNeeded(now: Date): void {
    const key = dayKey(now);
    if (key === this.budgetDay) return;
    this.budgetDay = key;
    this.requestsToday = 0;
    this.reportedRemaining = null;
  }

  private canRequest(): boolean {
    if (this.requestsToday >= this.options.dailyRequestBudget) return false;
    return this.reportedRemaining === null || this.reportedRemaining > 1;
  }

  private async request<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    this.requestsToday += 1;
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { "x-apisports-key": this.options.apiKey, accept: "application/json" },
      signal: requestSignal,
    });
    const remainingHeader = response.headers.get("x-ratelimit-requests-remaining");
    if (remainingHeader !== null) {
      const remaining = Number(remainingHeader);
      if (Number.isFinite(remaining)) this.reportedRemaining = remaining;
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`API-Football ${response.status}: ${text.slice(0, 400)}`);
    const parsed = JSON.parse(text) as ApiEnvelope<T>;
    const errors = parsed.errors;
    if (errors && ((Array.isArray(errors) && errors.length > 0) || (!Array.isArray(errors) && Object.keys(errors as object).length > 0))) {
      throw new Error(`API-Football hata döndürdü: ${JSON.stringify(errors).slice(0, 400)}`);
    }
    logger.debug("API-Football çağrısı tamamlandı.", {
      requestsToday: this.requestsToday,
      dailyBudget: this.options.dailyRequestBudget,
      reportedRemaining: this.reportedRemaining,
      path,
    });
    return Array.isArray(parsed.response) ? parsed.response : [];
  }
}
