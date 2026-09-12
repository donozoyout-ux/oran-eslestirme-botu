import type { MatchFixture } from "./domain.js";
import { CanonicalMatchResolver } from "./canonical-match-resolver.js";
import type { MatchIntelligenceInput, TeamMatchObservation } from "./match-intelligence.js";

type CapabilityMap = MatchIntelligenceInput["capabilityMap"];

interface FootballDataTeamRef {
  id?: number;
  name?: string;
  shortName?: string;
}

interface FootballDataMatch {
  id?: number;
  utcDate?: string;
  status?: string;
  competition?: { id?: number; name?: string; code?: string };
  season?: { id?: number; startDate?: string; endDate?: string };
  homeTeam?: FootballDataTeamRef;
  awayTeam?: FootballDataTeamRef;
  score?: {
    fullTime?: { home?: number | null; away?: number | null };
  };
}

interface FootballDataEnvelope {
  matches?: FootballDataMatch[];
}

export interface FootballDataResolution {
  status: "resolved" | "not_found" | "ambiguous";
  footballDataMatchId?: string;
  confidence: number;
  kickoffDifferenceMinutes?: number;
  matchedBy?: string;
  error?: string;
}

export interface FootballDataMatchIntelligenceProviderResult {
  input: MatchIntelligenceInput;
  rateLimitRemaining: number | null;
  rateLimitResetSeconds: number | null;
  resolution: FootballDataResolution;
  sources: string[];
}

class FootballDataHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`football-data.org ${status}: ${body.slice(0, 240)}`);
  }
}

function dateKey(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export class FootballDataMatchIntelligenceProvider {
  readonly name = "football_data_match_intelligence";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly normalizer = new CanonicalMatchResolver({ kickoffToleranceMinutes: 180 });
  private rateLimitRemaining: number | null = null;
  private rateLimitResetSeconds: number | null = null;
  private readonly resolveCache = new Map<string, { expiresAt: number; matches: FootballDataMatch[] }>();
  private readonly teamHistoryCache = new Map<string, { expiresAt: number; matches: FootballDataMatch[] }>();

  constructor(private readonly options: {
    apiToken: string;
    recentMatches: number;
    fixtureMatchToleranceMinutes?: number;
    baseUrl?: string;
    requestTimeoutMs?: number;
  }) {
    this.baseUrl = options.baseUrl ?? "https://api.football-data.org/v4";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12_000;
  }

  async fetch(
    target: MatchFixture & { canonicalEventId: string },
    signal?: AbortSignal,
  ): Promise<FootballDataMatchIntelligenceProviderResult> {
    const capabilities: CapabilityMap = {
      fixtures: "unavailable",
      teamStats: "unavailable",
      fixtureStats: "unavailable",
      events: "unavailable",
      lineups: "unavailable",
      injuries: "unavailable",
      xg: "unavailable",
    };

    const resolution = await this.resolveTarget(target, signal);
    if (resolution.status !== "resolved" || !resolution.footballDataMatchId) {
      return {
        input: {
          target,
          homeTeamId: `fd:name:${this.normalizer.normalizeTeam(target.homeTeam)}`,
          awayTeamId: `fd:name:${this.normalizer.normalizeTeam(target.awayTeam)}`,
          observations: [],
          capabilityMap: capabilities,
          sources: ["football_data"],
        },
        rateLimitRemaining: this.rateLimitRemaining,
        rateLimitResetSeconds: this.rateLimitResetSeconds,
        resolution,
        sources: ["football_data"],
      };
    }

    const targetMatches = await this.matchesAroundTarget(target, signal);
    const targetMatch = targetMatches.find((match) => String(match.id) === resolution.footballDataMatchId);
    const homeId = targetMatch?.homeTeam?.id;
    const awayId = targetMatch?.awayTeam?.id;
    if (!homeId || !awayId) {
      return {
        input: {
          target,
          homeTeamId: `fd:name:${this.normalizer.normalizeTeam(target.homeTeam)}`,
          awayTeamId: `fd:name:${this.normalizer.normalizeTeam(target.awayTeam)}`,
          observations: [],
          capabilityMap: capabilities,
          sources: ["football_data"],
        },
        rateLimitRemaining: this.rateLimitRemaining,
        rateLimitResetSeconds: this.rateLimitResetSeconds,
        resolution: { ...resolution, status: "not_found", error: "football_data_team_ids_missing" },
        sources: ["football_data"],
      };
    }

    const cutoff = Date.parse(target.commenceTime);
    const [homeHistory, awayHistory] = await Promise.all([
      this.fetchTeamHistory(homeId, cutoff, signal),
      this.fetchTeamHistory(awayId, cutoff, signal),
    ]);
    const observations = new Map<string, TeamMatchObservation>();
    for (const row of [...homeHistory, ...awayHistory]) {
      const mapped = this.mapMatch(row, cutoff);
      if (mapped) observations.set(mapped.sourceEventId, mapped);
    }
    if (observations.size > 0) capabilities.fixtures = "available";

    return {
      input: {
        target,
        homeTeamId: `fd:${homeId}`,
        awayTeamId: `fd:${awayId}`,
        targetLeagueId: targetMatch?.competition?.id === undefined ? undefined : `fd:${targetMatch.competition.id}`,
        targetSeasonId: targetMatch?.season?.id === undefined ? undefined : `fd:${targetMatch.season.id}`,
        observations: [...observations.values()]
          .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
          .slice(0, this.options.recentMatches * 4),
        capabilityMap: capabilities,
        sources: ["football_data"],
      },
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitResetSeconds: this.rateLimitResetSeconds,
      resolution,
      sources: ["football_data"],
    };
  }

  private async resolveTarget(
    target: MatchFixture & { canonicalEventId: string },
    signal?: AbortSignal,
  ): Promise<FootballDataResolution> {
    const kickoff = Date.parse(target.commenceTime);
    if (!Number.isFinite(kickoff)) return { status: "not_found", confidence: 0, error: "invalid_target_kickoff" };

    let rows: FootballDataMatch[];
    try {
      rows = await this.matchesAroundTarget(target, signal);
    } catch (error) {
      return { status: "not_found", confidence: 0, error: error instanceof Error ? error.message : String(error) };
    }

    const home = this.normalizer.normalizeTeam(target.homeTeam);
    const away = this.normalizer.normalizeTeam(target.awayTeam);
    const league = this.normalizer.normalizeLeague(target.leagueName);
    const toleranceMinutes = Math.max(30, this.options.fixtureMatchToleranceMinutes ?? 180);

    const candidates = rows.flatMap((match) => {
      const id = match.id;
      const utcDate = match.utcDate;
      const homeName = match.homeTeam?.name ?? match.homeTeam?.shortName;
      const awayName = match.awayTeam?.name ?? match.awayTeam?.shortName;
      if (!id || !utcDate || !homeName || !awayName) return [];
      if (this.normalizer.normalizeTeam(homeName) !== home || this.normalizer.normalizeTeam(awayName) !== away) return [];
      const matchTime = Date.parse(utcDate);
      if (!Number.isFinite(matchTime)) return [];
      const differenceMinutes = Math.abs(matchTime - kickoff) / 60_000;
      if (differenceMinutes > toleranceMinutes) return [];
      const candidateLeague = this.normalizer.normalizeLeague(match.competition?.name ?? "");
      const leagueMatched = Boolean(league && candidateLeague && league === candidateLeague);
      const confidence = Math.max(50, Math.round(100 - (differenceMinutes / toleranceMinutes) * 30 - (leagueMatched ? 0 : 10)));
      return [{
        id: String(id),
        differenceMinutes,
        leagueMatched,
        confidence,
      }];
    }).sort((a, b) =>
      Number(b.leagueMatched) - Number(a.leagueMatched)
      || a.differenceMinutes - b.differenceMinutes
      || b.confidence - a.confidence
      || a.id.localeCompare(b.id)
    );

    if (!candidates.length) return { status: "not_found", confidence: 0 };
    const best = candidates[0]!;
    const second = candidates[1];
    if (second && second.leagueMatched === best.leagueMatched && Math.abs(second.differenceMinutes - best.differenceMinutes) < 2) {
      return { status: "ambiguous", confidence: best.confidence };
    }
    return {
      status: "resolved",
      footballDataMatchId: best.id,
      confidence: best.confidence,
      kickoffDifferenceMinutes: best.differenceMinutes,
      matchedBy: best.leagueMatched ? "teams_league_kickoff" : "teams_kickoff",
    };
  }

  private async matchesAroundTarget(
    target: MatchFixture,
    signal?: AbortSignal,
  ): Promise<FootballDataMatch[]> {
    const kickoff = Date.parse(target.commenceTime);
    const from = dateKey(kickoff - 86_400_000);
    const to = dateKey(kickoff + 86_400_000);
    const key = `${from}:${to}`;
    const cached = this.resolveCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return [...cached.matches];

    const query = new URLSearchParams({ dateFrom: from, dateTo: to });
    const envelope = await this.request<FootballDataEnvelope>(`/matches?${query.toString()}`, signal);
    const matches = Array.isArray(envelope.matches) ? envelope.matches : [];
    this.resolveCache.set(key, { expiresAt: Date.now() + 30 * 60_000, matches: [...matches] });
    return matches;
  }

  private async fetchTeamHistory(
    teamId: number,
    cutoffMs: number,
    signal?: AbortSignal,
  ): Promise<FootballDataMatch[]> {
    const dateTo = dateKey(cutoffMs - 1);
    const key = `${teamId}:${dateTo}`;
    const cached = this.teamHistoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return [...cached.matches];

    const query = new URLSearchParams({
      status: "FINISHED",
      dateTo,
      limit: String(Math.max(10, this.options.recentMatches * 2)),
    });
    const envelope = await this.request<FootballDataEnvelope>(
      `/teams/${encodeURIComponent(String(teamId))}/matches?${query.toString()}`,
      signal,
    );
    const matches = Array.isArray(envelope.matches) ? envelope.matches : [];
    this.teamHistoryCache.set(key, { expiresAt: Date.now() + 45 * 60_000, matches: [...matches] });
    return matches;
  }

  private mapMatch(match: FootballDataMatch, cutoffMs: number): TeamMatchObservation | null {
    const id = match.id;
    const kickoff = match.utcDate;
    const homeId = match.homeTeam?.id;
    const awayId = match.awayTeam?.id;
    const homeTeam = match.homeTeam?.name ?? match.homeTeam?.shortName;
    const awayTeam = match.awayTeam?.name ?? match.awayTeam?.shortName;
    const homeScore = match.score?.fullTime?.home;
    const awayScore = match.score?.fullTime?.away;
    if (!id || !kickoff || !homeId || !awayId || !homeTeam || !awayTeam) return null;
    const kickoffMs = Date.parse(kickoff);
    if (!Number.isFinite(kickoffMs) || kickoffMs >= cutoffMs || match.status !== "FINISHED") return null;
    if (typeof homeScore !== "number" || typeof awayScore !== "number") return null;
    return {
      sourceEventId: `fd:${id}`,
      leagueId: match.competition?.id === undefined ? undefined : `fd:${match.competition.id}`,
      leagueName: match.competition?.name ?? "Football-data",
      seasonId: match.season?.id === undefined ? undefined : `fd:${match.season.id}`,
      kickoff: new Date(kickoffMs).toISOString(),
      homeTeamId: `fd:${homeId}`,
      awayTeamId: `fd:${awayId}`,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
    };
  }

  private async request<T>(path: string, parentSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const abort = () => controller.abort();
    parentSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { "X-Auth-Token": this.options.apiToken, accept: "application/json" },
        signal: controller.signal,
      });
      const text = await response.text();
      const remaining = response.headers.get("x-requests-available-minute");
      const reset = response.headers.get("x-requestcounter-reset");
      this.rateLimitRemaining = remaining === null ? this.rateLimitRemaining : Number(remaining);
      this.rateLimitResetSeconds = reset === null ? this.rateLimitResetSeconds : Number(reset);
      if (!response.ok) throw new FootballDataHttpError(response.status, text);
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
  }
}
