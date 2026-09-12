import type { MatchFixture } from "./domain.js";
import type { MatchIntelligenceInput, TeamMatchObservation } from "./match-intelligence.js";
import type { MatchIntelligenceDataProvider, MatchIntelligenceProviderResult } from "./match-intelligence-provider.js";
import type { FootballDataMatchIntelligenceProvider } from "./football-data-match-intelligence-provider.js";
import type { SportmonksMatchIntelligenceProvider } from "./sportmonks-match-intelligence-provider.js";

function teamSampleSize(input: MatchIntelligenceInput, teamId: string): number {
  return input.observations.filter((row) => row.homeTeamId === teamId || row.awayTeamId === teamId).length;
}

function remapFallbackObservation(
  row: TeamMatchObservation,
  fallbackHomeId: string,
  fallbackAwayId: string,
  primaryHomeId: string,
  primaryAwayId: string,
): TeamMatchObservation {
  const remap = (id: string): string => {
    if (id === fallbackHomeId) return primaryHomeId;
    if (id === fallbackAwayId) return primaryAwayId;
    return id.startsWith("fd:") ? id : `fd:${id}`;
  };
  return {
    ...row,
    homeTeamId: remap(row.homeTeamId),
    awayTeamId: remap(row.awayTeamId),
    events: row.events?.map((event) => ({ ...event, teamId: remap(event.teamId) })),
    statistics: row.statistics?.map((stat) => ({ ...stat, teamId: remap(stat.teamId) })),
  };
}

export class MultiSourceMatchIntelligenceProvider implements MatchIntelligenceDataProvider {
  constructor(
    private readonly sportmonks: SportmonksMatchIntelligenceProvider,
    private readonly footballData: FootballDataMatchIntelligenceProvider | undefined,
    private readonly minSample: number,
  ) {}

  async fetch(
    target: MatchFixture & { canonicalEventId: string },
    signal?: AbortSignal,
  ): Promise<MatchIntelligenceProviderResult> {
    const primary = await this.sportmonks.fetch(target, signal);
    const primaryHomeSample = teamSampleSize(primary.input, primary.input.homeTeamId);
    const primaryAwaySample = teamSampleSize(primary.input, primary.input.awayTeamId);
    const primaryEnough = primary.resolution.status === "resolved"
      && primaryHomeSample >= this.minSample
      && primaryAwaySample >= this.minSample;

    if (!this.footballData || primaryEnough) {
      return { ...primary, sources: ["sportmonks"] };
    }

    let fallback: Awaited<ReturnType<FootballDataMatchIntelligenceProvider["fetch"]>>;
    try {
      fallback = await this.footballData.fetch(target, signal);
    } catch {
      return { ...primary, sources: ["sportmonks"] };
    }

    const fallbackResolved = fallback.resolution.status === "resolved";
    const fallbackHomeSample = teamSampleSize(fallback.input, fallback.input.homeTeamId);
    const fallbackAwaySample = teamSampleSize(fallback.input, fallback.input.awayTeamId);
    const fallbackUseful = fallbackResolved && (fallbackHomeSample > 0 || fallbackAwaySample > 0);

    if (!fallbackUseful) {
      return { ...primary, sources: ["sportmonks"] };
    }

    if (primary.resolution.status !== "resolved" || primary.input.observations.length === 0) {
      return {
        input: {
          ...fallback.input,
          sources: ["football_data"],
        },
        rateLimitRemaining: fallback.rateLimitRemaining,
        rateLimitResetSeconds: fallback.rateLimitResetSeconds,
        resolution: fallback.resolution,
        sources: ["football_data"],
      };
    }

    const remappedFallback = fallback.input.observations.map((row) =>
      remapFallbackObservation(
        row,
        fallback.input.homeTeamId,
        fallback.input.awayTeamId,
        primary.input.homeTeamId,
        primary.input.awayTeamId,
      )
    );
    const merged = new Map<string, TeamMatchObservation>();
    for (const row of primary.input.observations) merged.set(`sm:${row.sourceEventId}`, row);
    for (const row of remappedFallback) merged.set(`fd:${row.sourceEventId}`, row);

    const capabilityMap: MatchIntelligenceInput["capabilityMap"] = {
      fixtures: primary.input.capabilityMap.fixtures === "available" || fallback.input.capabilityMap.fixtures === "available"
        ? "available" : "unavailable",
      teamStats: primary.input.capabilityMap.teamStats,
      fixtureStats: primary.input.capabilityMap.fixtureStats,
      events: primary.input.capabilityMap.events,
      lineups: primary.input.capabilityMap.lineups,
      injuries: primary.input.capabilityMap.injuries,
      xg: primary.input.capabilityMap.xg,
    };

    return {
      input: {
        ...primary.input,
        observations: [...merged.values()].sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)),
        capabilityMap,
        sources: ["sportmonks", "football_data"],
      },
      rateLimitRemaining: primary.rateLimitRemaining ?? fallback.rateLimitRemaining,
      rateLimitResetSeconds: primary.rateLimitResetSeconds ?? fallback.rateLimitResetSeconds,
      resolution: primary.resolution,
      sources: ["sportmonks", "football_data"],
    };
  }
}
