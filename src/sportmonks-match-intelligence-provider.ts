import type { MatchFixture } from "./domain.js";
import type { MatchIntelligenceCapability, MatchIntelligenceInput, TeamMatchObservation } from "./match-intelligence.js";
import { SportmonksFixtureResolver, type SportmonksFixtureResolution } from "./sportmonks-fixture-resolver.js";

type CapabilityMap = MatchIntelligenceInput["capabilityMap"];
interface Envelope { data?: unknown; rate_limit?: { remaining?: number; resets_in_seconds?: number }; message?: string }
interface ProviderResult {
  input: MatchIntelligenceInput;
  rateLimitRemaining: number | null;
  rateLimitResetSeconds: number | null;
  resolution: SportmonksFixtureResolution;
}

class AccessError extends Error { constructor(readonly status: number) { super(`SportMonks capability HTTP ${status}`); } }
const canonical = (value: unknown): string => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const numberValue = (value: unknown): number | undefined => {
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined;
};

export class SportmonksMatchIntelligenceProvider {
  readonly name = "sportmonks_match_intelligence";
  private remaining: number | null = null;
  private resetSeconds: number | null = null;
  private readonly resolver: SportmonksFixtureResolver;

  constructor(private readonly options: {
    apiToken: string;
    recentMatches: number;
    fixtureMatchToleranceMinutes?: number;
    baseUrl?: string;
    requestTimeoutMs?: number;
  }) {
    this.resolver = new SportmonksFixtureResolver({
      apiToken: options.apiToken,
      toleranceMinutes: options.fixtureMatchToleranceMinutes ?? 60,
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  async fetch(target: MatchFixture & { canonicalEventId: string }, signal?: AbortSignal): Promise<ProviderResult> {
    const capabilities: CapabilityMap = {
      fixtures: "unavailable", teamStats: "unavailable", fixtureStats: "unavailable", events: "unavailable",
      lineups: "unavailable", injuries: "unavailable", xg: "unavailable",
    };
    const resolution = await this.resolver.resolve(target, signal);
    if (resolution.status !== "resolved" || !resolution.sportmonksFixtureId) {
      return {
        input: { target, homeTeamId: target.homeTeam, awayTeamId: target.awayTeam, observations: [], capabilityMap: capabilities },
        rateLimitRemaining: this.remaining,
        rateLimitResetSeconds: this.resetSeconds,
        resolution,
      };
    }

    const sportmonksFixtureId = resolution.sportmonksFixtureId;
    const targetRaw = await this.optionalCapability(`/fixtures/${encodeURIComponent(sportmonksFixtureId)}?include=participants;league`, "fixtures", capabilities, signal);
    const targetFixture = this.first(targetRaw);
    const teams = this.teams(targetFixture);
    if (!teams.homeId || !teams.awayId) {
      return { input: { target, homeTeamId: teams.homeId ?? target.homeTeam, awayTeamId: teams.awayId ?? target.awayTeam,
        observations: [], capabilityMap: capabilities }, rateLimitRemaining: this.remaining, rateLimitResetSeconds: this.resetSeconds, resolution };
    }

    const cutoff = new Date(Math.min(Date.parse(target.commenceTime) - 1, Date.now())).toISOString().slice(0, 10);
    const start = new Date(Date.parse(target.commenceTime) - 400 * 86_400_000).toISOString().slice(0, 10);
    const observations = new Map<string, TeamMatchObservation>();
    for (const teamId of [teams.homeId, teams.awayId]) {
      if (this.remaining === 0) break;
      const basePath = `/fixtures/between/${start}/${cutoff}/${teamId}`;
      const commonQuery = "order=desc&per_page=50";
      const fixtureData = await this.optionalCapability(`${basePath}?${commonQuery}&include=participants;scores;league`, "fixtures", capabilities, signal);
      for (const row of this.rows(fixtureData)) {
        const mapped = this.mapFixture(row, target.commenceTime);
        if (mapped) observations.set(mapped.sourceEventId, mapped);
      }
      const eventsData = await this.optionalCapability(`${basePath}?${commonQuery}&include=participants;scores;league;events`, "events", capabilities, signal);
      this.mergeEnrichment(observations, this.rows(eventsData), target.commenceTime, "events");
      const statsData = await this.optionalCapability(`${basePath}?${commonQuery}&include=participants;scores;league;statistics.type`, "fixtureStats", capabilities, signal);
      this.mergeEnrichment(observations, this.rows(statsData), target.commenceTime, "statistics");
      await this.optionalCapability(`/teams/${teamId}?include=statistics.details.type`, "teamStats", capabilities, signal);
      await this.optionalCapability(`/sidelined/team/${teamId}`, "injuries", capabilities, signal);
    }
    await this.optionalCapability(`/fixtures/${encodeURIComponent(sportmonksFixtureId)}?include=lineups`, "lineups", capabilities, signal);
    capabilities.xg = [...observations.values()].some((row) => row.statistics?.some((stat) => stat.xg !== undefined))
      ? "available" : "unavailable";
    return {
      input: { target, homeTeamId: teams.homeId, awayTeamId: teams.awayId,
        targetLeagueId: (targetFixture.league as Record<string, unknown> | undefined)?.id === undefined
          ? undefined : String((targetFixture.league as Record<string, unknown>).id),
        targetSeasonId: targetFixture.season_id === undefined ? undefined : String(targetFixture.season_id),
        observations: [...observations.values()].sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
          .slice(0, this.options.recentMatches * 3), capabilityMap: capabilities },
      rateLimitRemaining: this.remaining,
      rateLimitResetSeconds: this.resetSeconds,
      resolution,
    };
  }

  private async optionalCapability(path: string, capability: keyof CapabilityMap, map: CapabilityMap,
    signal?: AbortSignal): Promise<unknown> {
    if (this.remaining === 0) return undefined;
    try {
      const data = await this.request(path, signal);
      map[capability] = "available";
      return data;
    } catch (error) {
      map[capability] = "unavailable";
      if (error instanceof AccessError && [401, 403, 404, 429].includes(error.status)) return undefined;
      return undefined;
    }
  }

  private async request(path: string, parentSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 12_000);
    const abort = () => controller.abort();
    parentSignal?.addEventListener("abort", abort, { once: true });
    try {
      const separator = path.includes("?") ? "&" : "?";
      const response = await fetch(`${this.options.baseUrl ?? "https://api.sportmonks.com/v3/football"}${path}${separator}api_token=${encodeURIComponent(this.options.apiToken)}`, {
        headers: { Accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok) throw new AccessError(response.status);
      const envelope = await response.json() as Envelope;
      this.remaining = typeof envelope.rate_limit?.remaining === "number" ? envelope.rate_limit.remaining : this.remaining;
      this.resetSeconds = typeof envelope.rate_limit?.resets_in_seconds === "number" ? envelope.rate_limit.resets_in_seconds : this.resetSeconds;
      return envelope.data;
    } finally {
      clearTimeout(timeout); parentSignal?.removeEventListener("abort", abort);
    }
  }

  private rows(data: unknown): Record<string, unknown>[] { return Array.isArray(data) ? data as Record<string, unknown>[] : data ? [data as Record<string, unknown>] : []; }
  private first(data: unknown): Record<string, unknown> { return this.rows(data)[0] ?? {}; }

  private teams(fixture: Record<string, unknown>): { homeId?: string; awayId?: string } {
    const participants = Array.isArray(fixture.participants) ? fixture.participants as Record<string, unknown>[] : [];
    const home = participants.find((row) => canonical((row.meta as Record<string, unknown> | undefined)?.location) === "home") ?? participants[0];
    const away = participants.find((row) => canonical((row.meta as Record<string, unknown> | undefined)?.location) === "away")
      ?? participants.find((row) => row.id !== home?.id);
    return { homeId: home?.id === undefined ? undefined : String(home.id), awayId: away?.id === undefined ? undefined : String(away.id) };
  }

  private mapFixture(row: Record<string, unknown>, cutoff: string): TeamMatchObservation | null {
    const id = row.id === undefined ? null : String(row.id);
    const kickoffRaw = row.starting_at_timestamp ? new Date(Number(row.starting_at_timestamp) * 1000).toISOString() : String(row.starting_at ?? "");
    const kickoff = Number.isFinite(Date.parse(kickoffRaw)) ? new Date(Date.parse(kickoffRaw)).toISOString() : null;
    const teams = this.teams(row);
    const participants = Array.isArray(row.participants) ? row.participants as Record<string, unknown>[] : [];
    const byId = (idValue: string | undefined) => participants.find((item) => String(item.id) === idValue);
    const scores = Array.isArray(row.scores) ? row.scores as Record<string, unknown>[] : [];
    const score = (teamId: string | undefined): number | undefined => {
      const candidates = scores.filter((item) => String(item.participant_id) === teamId);
      const current = candidates.find((item) => canonical(item.description) === "current") ?? candidates.at(-1);
      return numberValue((current?.score as Record<string, unknown> | undefined)?.goals);
    };
    const homeScore = score(teams.homeId); const awayScore = score(teams.awayId);
    if (!id || !kickoff || Date.parse(kickoff) >= Date.parse(cutoff) || !teams.homeId || !teams.awayId
      || homeScore === undefined || awayScore === undefined) return null;
    const league = row.league as Record<string, unknown> | undefined;
    return {
      sourceEventId: id, leagueId: league?.id === undefined ? undefined : String(league.id), leagueName: String(league?.name ?? "Unknown"),
      seasonId: row.season_id === undefined ? undefined : String(row.season_id), kickoff,
      homeTeamId: teams.homeId, awayTeamId: teams.awayId,
      homeTeam: String(byId(teams.homeId)?.name ?? teams.homeId), awayTeam: String(byId(teams.awayId)?.name ?? teams.awayId),
      homeScore, awayScore, events: this.mapEvents(row, cutoff), statistics: this.mapStatistics(row, cutoff),
    };
  }

  private mergeEnrichment(target: Map<string, TeamMatchObservation>, rows: Record<string, unknown>[], cutoff: string,
    kind: "events" | "statistics"): void {
    for (const row of rows) {
      const current = target.get(String(row.id));
      if (!current) continue;
      if (kind === "events") {
        const events = this.mapEvents(row, cutoff) ?? [];
        current.events = events;
        if (events.length > 0) {
          current.reportedHomeScore = events.filter((event) => event.teamId === current.homeTeamId).length;
          current.reportedAwayScore = events.filter((event) => event.teamId === current.awayTeamId).length;
        }
      } else current.statistics = this.mapStatistics(row, cutoff);
    }
  }

  private mapEvents(row: Record<string, unknown>, cutoff: string): TeamMatchObservation["events"] {
    const events = Array.isArray(row.events) ? row.events as Record<string, unknown>[] : [];
    return events.flatMap((event) => {
      const minute = numberValue(event.minute); const teamId = event.participant_id ?? event.team_id;
      const typeObject = typeof event.type === "object" && event.type !== null ? event.type as Record<string, unknown> : undefined;
      const type = canonical(typeObject?.developer_name ?? typeObject?.name ?? event.type ?? event.info);
      const observed = String(event.updated_at ?? event.created_at ?? row.starting_at ?? cutoff);
      if (minute === undefined || teamId === undefined || !type.includes("goal") || Date.parse(observed) >= Date.parse(cutoff)) return [];
      return [{ teamId: String(teamId), minute, type: "goal" as const, observedAt: new Date(Date.parse(observed)).toISOString() }];
    });
  }

  private mapStatistics(row: Record<string, unknown>, cutoff: string): TeamMatchObservation["statistics"] {
    const stats = Array.isArray(row.statistics) ? row.statistics as Record<string, unknown>[] : [];
    const grouped = new Map<string, NonNullable<TeamMatchObservation["statistics"]>[number]>();
    const keyFor = (name: string): keyof Omit<NonNullable<TeamMatchObservation["statistics"]>[number], "teamId" | "observedAt"> | null => {
      if (name === "expected_goals" || name === "xg") return "xg";
      if (name === "shots_total" || name === "total_shots") return "shots";
      if (name === "shots_on_target") return "shotsOnTarget";
      if (name.includes("big_chance")) return "bigChances";
      if (name.includes("possession")) return "possession";
      if (name.includes("corner")) return "corners";
      if (name.includes("card")) return "cards";
      if (name === "attacks") return "attacks";
      if (name.includes("dangerous_attack")) return "dangerousAttacks";
      return null;
    };
    for (const stat of stats) {
      const teamId = stat.participant_id ?? stat.team_id;
      const type = stat.type as Record<string, unknown> | undefined;
      const key = keyFor(canonical(type?.developer_name ?? type?.name ?? stat.name));
      const data = typeof stat.data === "object" && stat.data !== null ? stat.data as Record<string, unknown> : undefined;
      const value = numberValue(data?.value ?? stat.data ?? stat.value);
      const observed = String(stat.updated_at ?? stat.created_at ?? row.starting_at ?? cutoff);
      if (teamId === undefined || !key || value === undefined || Date.parse(observed) >= Date.parse(cutoff)) continue;
      const item = grouped.get(String(teamId)) ?? { teamId: String(teamId), observedAt: new Date(Date.parse(observed)).toISOString() };
      item[key] = value; grouped.set(String(teamId), item);
    }
    return [...grouped.values()];
  }
}

export type { CapabilityMap, ProviderResult as SportmonksMatchIntelligenceProviderResult };
