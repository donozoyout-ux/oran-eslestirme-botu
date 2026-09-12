import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchFixture } from "../src/domain.js";
import type { MatchIntelligenceInput, TeamMatchObservation } from "../src/match-intelligence.js";
import { FootballDataMatchIntelligenceProvider } from "../src/football-data-match-intelligence-provider.js";
import { MultiSourceMatchIntelligenceProvider } from "../src/multi-source-match-intelligence-provider.js";
import type { SportmonksMatchIntelligenceProvider } from "../src/sportmonks-match-intelligence-provider.js";

afterEach(() => { vi.unstubAllGlobals(); });

const target: MatchFixture & { canonicalEventId: string } = {
  provider: "betexplorer_scraper",
  sourceEventId: "bet-genoa-frosinone",
  canonicalEventId: "canonical-genoa-frosinone",
  leagueName: "Serie A",
  homeTeam: "Genoa",
  awayTeam: "Frosinone",
  commenceTime: "2026-09-12T13:53:00.000Z",
  phase: "prematch",
};

const finished = (
  id: number,
  utcDate: string,
  homeId: number,
  homeName: string,
  awayId: number,
  awayName: string,
  home: number,
  away: number,
) => ({
  id,
  utcDate,
  status: "FINISHED",
  competition: { id: 2019, name: "Serie A", code: "SA" },
  season: { id: 2026 },
  homeTeam: { id: homeId, name: homeName },
  awayTeam: { id: awayId, name: awayName },
  score: { fullTime: { home, away } },
});

describe("FootballDataMatchIntelligenceProvider", () => {
  it("target maci cozer ve bitmis takim maclarini form fallback'i olarak getirir", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v4/matches") {
        return new Response(JSON.stringify({
          matches: [{
            id: 500,
            utcDate: "2026-09-12T14:00:00Z",
            status: "TIMED",
            competition: { id: 2019, name: "Serie A", code: "SA" },
            season: { id: 2026 },
            homeTeam: { id: 10, name: "Genoa" },
            awayTeam: { id: 20, name: "Frosinone" },
          }],
        }), { status: 200, headers: { "x-requests-available-minute": "8", "x-requestcounter-reset": "12" } });
      }
      if (url.pathname === "/v4/teams/10/matches") {
        return new Response(JSON.stringify({ matches: [
          finished(401, "2026-09-01T18:45:00Z", 10, "Genoa", 31, "Torino", 2, 1),
          finished(402, "2026-08-25T18:45:00Z", 32, "Udinese", 10, "Genoa", 0, 0),
        ] }), { status: 200 });
      }
      if (url.pathname === "/v4/teams/20/matches") {
        return new Response(JSON.stringify({ matches: [
          finished(403, "2026-09-02T18:45:00Z", 20, "Frosinone", 33, "Parma", 1, 1),
          finished(404, "2026-08-24T18:45:00Z", 34, "Bologna", 20, "Frosinone", 2, 0),
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new FootballDataMatchIntelligenceProvider({
      apiToken: "fd-secret",
      recentMatches: 10,
      fixtureMatchToleranceMinutes: 180,
      baseUrl: "https://football-data.test/v4",
    });
    const result = await provider.fetch(target);

    expect(result.resolution).toMatchObject({ status: "resolved", footballDataMatchId: "500" });
    expect(result.input.homeTeamId).toBe("fd:10");
    expect(result.input.awayTeamId).toBe("fd:20");
    expect(result.input.capabilityMap.fixtures).toBe("available");
    expect(result.input.sources).toEqual(["football_data"]);
    expect(result.input.observations).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("MultiSourceMatchIntelligenceProvider", () => {
  it("SportMonks resolve edemezse football-data form fallback'ini kullanir", async () => {
    const emptyCapabilities: MatchIntelligenceInput["capabilityMap"] = {
      fixtures: "unavailable", teamStats: "unavailable", fixtureStats: "unavailable", events: "unavailable",
      lineups: "unavailable", injuries: "unavailable", xg: "unavailable",
    };
    const sportmonks = {
      fetch: async () => ({
        input: { target, homeTeamId: "Genoa", awayTeamId: "Frosinone", observations: [], capabilityMap: emptyCapabilities, sources: ["sportmonks"] },
        rateLimitRemaining: 100,
        rateLimitResetSeconds: 60,
        resolution: { status: "not_found", confidence: 0 },
      }),
    } as unknown as SportmonksMatchIntelligenceProvider;

    const observation: TeamMatchObservation = {
      sourceEventId: "fd:401",
      leagueName: "Serie A",
      kickoff: "2026-09-01T18:45:00Z",
      homeTeamId: "fd:10",
      awayTeamId: "fd:31",
      homeTeam: "Genoa",
      awayTeam: "Torino",
      homeScore: 2,
      awayScore: 1,
    };
    const footballData = {
      fetch: async () => ({
        input: {
          target,
          homeTeamId: "fd:10",
          awayTeamId: "fd:20",
          observations: [observation],
          capabilityMap: { ...emptyCapabilities, fixtures: "available" as const },
          sources: ["football_data"],
        },
        rateLimitRemaining: 8,
        rateLimitResetSeconds: 12,
        resolution: { status: "resolved", confidence: 95, footballDataMatchId: "500" },
        sources: ["football_data"],
      }),
    } as unknown as FootballDataMatchIntelligenceProvider;

    const provider = new MultiSourceMatchIntelligenceProvider(sportmonks, footballData, 5);
    const result = await provider.fetch(target);

    expect(result.resolution).toMatchObject({ status: "resolved" });
    expect(result.sources).toEqual(["football_data"]);
    expect(result.input.sources).toEqual(["football_data"]);
    expect(result.input.observations).toHaveLength(1);
    expect(result.input.homeTeamId).toBe("fd:10");
  });
});
