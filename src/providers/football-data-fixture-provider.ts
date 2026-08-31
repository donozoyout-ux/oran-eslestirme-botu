import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";

interface FootballDataMatch {
  id?: number;
  utcDate?: string;
  status?: string;
  competition?: { name?: string };
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
}

interface FootballDataResponse {
  matches?: FootballDataMatch[];
}

export interface FootballDataFixtureProviderOptions {
  apiKey: string;
  competitionCodes: string[];
  cacheMinutes: number;
  dailyRequestBudget: number;
  baseUrl?: string;
  requestTimeoutMs?: number;
}

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED"]);
const CLOSED_STATUSES = new Set(["FINISHED", "CANCELLED", "POSTPONED", "SUSPENDED"]);

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export class FootballDataFixtureProvider implements OddsProvider {
  readonly name = "football_data";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private lastFixtures: MatchFixture[] = [];
  private fetchedDay: string | null = null;
  private budgetDay = dayKey(new Date());
  private requestsToday = 0;

  constructor(private readonly options: FootballDataFixtureProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.football-data.org/v4";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = new Date();
    this.resetBudgetIfNeeded(now);
    const today = dayKey(now);
    if (this.fetchedDay === today) return [];
    if (this.requestsToday >= this.options.dailyRequestBudget) return [];

    const query = new URLSearchParams({
      dateFrom: today,
      dateTo: dayKey(addDays(now, 1)),
    });
    if (this.options.competitionCodes.length > 0) query.set("competitions", this.options.competitionCodes.join(","));

    this.requestsToday += 1;
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${this.baseUrl}/matches?${query.toString()}`, {
      headers: { "X-Auth-Token": this.options.apiKey, accept: "application/json" },
      signal: requestSignal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`football-data.org ${response.status}: ${text.slice(0, 400)}`);
    const parsed = JSON.parse(text) as FootballDataResponse;
    const fixtures: MatchFixture[] = [];
    for (const match of parsed.matches ?? []) {
      const id = match.id;
      const commenceTime = match.utcDate;
      const homeTeam = match.homeTeam?.name;
      const awayTeam = match.awayTeam?.name;
      const status = match.status?.toUpperCase() ?? "";
      if (!id || !commenceTime || !homeTeam || !awayTeam || CLOSED_STATUSES.has(status)) continue;
      fixtures.push({
        provider: this.name,
        sourceEventId: String(id),
        leagueName: match.competition?.name ?? "Futbol",
        homeTeam,
        awayTeam,
        commenceTime,
        phase: LIVE_STATUSES.has(status) ? "live" : "prematch",
      });
    }
    this.lastFixtures = fixtures;
    this.fetchedDay = today;
    return [];
  }

  getLastFixtures(): MatchFixture[] {
    return [...this.lastFixtures];
  }

  private resetBudgetIfNeeded(now: Date): void {
    const key = dayKey(now);
    if (key === this.budgetDay) return;
    this.budgetDay = key;
    this.requestsToday = 0;
    this.fetchedDay = null;
    this.lastFixtures = [];
  }
}
