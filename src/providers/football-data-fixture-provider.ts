import type { FixtureResultStatus, MatchFixture, OddsProvider, OddsQuote } from "../domain.js";

interface FootballDataMatch {
  id?: number;
  utcDate?: string;
  status?: string;
  competition?: { name?: string };
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
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
const CANCELLED_STATUSES = new Set(["CANCELLED", "POSTPONED", "SUSPENDED"]);

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function istanbulHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(hour);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function resultStatus(status: string): FixtureResultStatus {
  if (status === "FINISHED") return "finished";
  if (CANCELLED_STATUSES.has(status)) return "cancelled";
  if (LIVE_STATUSES.has(status)) return "live";
  return "scheduled";
}

export class FootballDataFixtureProvider implements OddsProvider {
  readonly name = "football_data";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly refreshMinutes: number;
  private lastFixtures: MatchFixture[] = [];
  private lastFetchedAt: number | null = null;
  private budgetDay = dayKey(new Date());
  private requestsToday = 0;

  constructor(private readonly options: FootballDataFixtureProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.football-data.org/v4";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    // Bu kaynak artik sadece fikstur + skor dogrulamasi yapar. Saatte birden
    // sik cagrilmayarak ucretsiz kotayi gun sonuna kadar koruruz.
    this.refreshMinutes = Math.max(60, options.cacheMinutes);
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = new Date();
    this.resetBudgetIfNeeded(now);
    if (this.lastFetchedAt !== null && now.getTime() - this.lastFetchedAt < this.refreshMinutes * 60_000) return [];
    if (this.requestsToday >= this.options.dailyRequestBudget) return [];

    const today = dayKey(now);
    // Gece 00:00-03:59 arasinda bir onceki gunun gec biten maclarini da
    // getiririz; boylece Sonuclar sekmesi gece yarisi sonrasi tamamlanabilir.
    const dateFrom = istanbulHour(now) < 4 ? dayKey(addDays(now, -1)) : today;
    const query = new URLSearchParams({
      dateFrom,
      dateTo: dayKey(addDays(now, 1)),
    });
    if (this.options.competitionCodes.length > 0) query.set("competitions", this.options.competitionCodes.join(","));

    this.requestsToday += 1;
    this.lastFetchedAt = now.getTime();
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
      if (!id || !commenceTime || !homeTeam || !awayTeam) continue;
      const resolvedStatus = resultStatus(status);
      const homeScore = match.score?.fullTime?.home;
      const awayScore = match.score?.fullTime?.away;
      fixtures.push({
        provider: this.name,
        sourceEventId: String(id),
        leagueName: match.competition?.name ?? "Futbol",
        homeTeam,
        awayTeam,
        commenceTime,
        // Biten/iptal maclari mevcut aktif-mac Sheet filtresine sokmamak icin
        // prematch fazinda tutuyoruz; asil sonuc durumu resultStatus alanindadir.
        phase: resolvedStatus === "live" ? "live" : "prematch",
        resultStatus: resolvedStatus,
        ...(typeof homeScore === "number" ? { homeScore } : {}),
        ...(typeof awayScore === "number" ? { awayScore } : {}),
      });
    }
    this.lastFixtures = fixtures;
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
    this.lastFetchedAt = null;
    this.lastFixtures = [];
  }
}
