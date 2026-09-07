import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchFixture } from "../src/domain.js";
import { MemoryMatchIntelligenceSnapshotRepository } from "../src/match-intelligence-repository.js";
import { MatchIntelligenceService } from "../src/match-intelligence-service.js";
import type { MatchIntelligenceInput } from "../src/match-intelligence.js";
import { SportmonksMatchIntelligenceProvider } from "../src/sportmonks-match-intelligence-provider.js";

const target: MatchFixture & { canonicalEventId: string } = { provider: "sportmonks", sourceEventId: "100",
  canonicalEventId: "canonical-100", leagueName: "Premier League", homeTeam: "Arsenal", awayTeam: "Brighton",
  commenceTime: "2026-10-01T18:00:00.000Z", phase: "prematch" };
const targetApi = { id: 100, participants: [{ id: 1, name: "Arsenal", meta: { location: "home" } },
  { id: 2, name: "Brighton", meta: { location: "away" } }], league: { id: 8, name: "Premier League" } };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("SportmonksMatchIntelligenceProvider", () => {
  it("403 capability hatalarinda crash etmeden unavailable doner", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.pathname === "/fixtures/100" && url.searchParams.get("include") === "participants;league"
        ? new Response(JSON.stringify({ data: targetApi }), { status: 200 })
        : new Response(JSON.stringify({ message: "subscription required" }), { status: 403 });
    }));
    const result = await new SportmonksMatchIntelligenceProvider({ apiToken: "secret", recentMatches: 10,
      baseUrl: "https://sportmonks.test" }).fetch(target);
    expect(result.input.observations).toEqual([]);
    expect(result.input.capabilityMap).toMatchObject({ fixtures: "unavailable", fixtureStats: "unavailable",
      events: "unavailable", lineups: "unavailable", injuries: "unavailable", xg: "unavailable" });
  });

  it("rate limit sifira indiginde ek capability isteklerini durdurur", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: targetApi,
      rate_limit: { remaining: 0, resets_in_seconds: 60 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new SportmonksMatchIntelligenceProvider({ apiToken: "secret", recentMatches: 10,
      baseUrl: "https://sportmonks.test" }).fetch(target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ rateLimitRemaining: 0, rateLimitResetSeconds: 60 });
  });

  it("erisilebilir fixture stats ve event verisinden xG capability ve observation uretir", async () => {
    const recent = { ...targetApi, id: 90, starting_at: "2026-09-20T18:00:00Z", season_id: 2026,
      scores: [{ participant_id: 1, description: "CURRENT", score: { goals: 2 } },
        { participant_id: 2, description: "CURRENT", score: { goals: 1 } }] };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input)); const include = url.searchParams.get("include") ?? "";
      if (url.pathname === "/fixtures/100" && include === "participants;league") return new Response(JSON.stringify({ data: targetApi }), { status: 200 });
      if (url.pathname.includes("/fixtures/between/") && include.includes("statistics")) return new Response(JSON.stringify({ data: [{ ...recent,
        statistics: [{ participant_id: 1, type: { developer_name: "EXPECTED_GOALS" }, data: { value: 2.1 }, updated_at: "2026-09-20T20:00:00Z" },
          { participant_id: 2, type: { developer_name: "EXPECTED_GOALS" }, data: { value: 0.8 }, updated_at: "2026-09-20T20:00:00Z" }] }] }), { status: 200 });
      if (url.pathname.includes("/fixtures/between/") && include.includes("events")) return new Response(JSON.stringify({ data: [{ ...recent,
        events: [{ participant_id: 1, minute: 10, type: { name: "Goal" }, updated_at: "2026-09-20T20:00:00Z" },
          { participant_id: 1, minute: 80, type: { name: "Goal" }, updated_at: "2026-09-20T20:00:00Z" },
          { participant_id: 2, minute: 30, type: { name: "Goal" }, updated_at: "2026-09-20T20:00:00Z" }] }] }), { status: 200 });
      if (url.pathname.includes("/fixtures/between/")) return new Response(JSON.stringify({ data: [recent] }), { status: 200 });
      return new Response(JSON.stringify({ message: "unavailable" }), { status: 403 });
    }));
    const result = await new SportmonksMatchIntelligenceProvider({ apiToken: "secret", recentMatches: 10,
      baseUrl: "https://sportmonks.test" }).fetch(target);
    expect(result.input.capabilityMap).toMatchObject({ fixtures: "available", fixtureStats: "available", events: "available", xg: "available" });
    expect(result.input.observations[0]).toMatchObject({ sourceEventId: "90", reportedHomeScore: 2, reportedAwayScore: 1,
      statistics: expect.arrayContaining([expect.objectContaining({ teamId: "1", xg: 2.1 })]) });
  });
});

describe("MatchIntelligenceService", () => {
  it("canonical event bazinda cache kullanir ve snapshot'i idempotent saklar", async () => {
    let calls = 0;
    const capabilityMap: MatchIntelligenceInput["capabilityMap"] = { fixtures: "available", teamStats: "unavailable",
      fixtureStats: "unavailable", events: "unavailable", lineups: "unavailable", injuries: "unavailable", xg: "unavailable" };
    const provider = { fetch: async () => { calls += 1; return { input: { target, homeTeamId: "1", awayTeamId: "2",
      observations: [], capabilityMap }, rateLimitRemaining: 100, rateLimitResetSeconds: 60 }; } } as unknown as SportmonksMatchIntelligenceProvider;
    const repository = new MemoryMatchIntelligenceSnapshotRepository();
    const service = new MatchIntelligenceService(provider, repository, { cacheMinutes: 45, minSample: 5 });
    const now = new Date("2026-09-30T12:00:00.000Z");
    const first = await service.refresh([target], now);
    const second = await service.refresh([target], new Date(now.getTime() + 60_000));
    expect(calls).toBe(1);
    expect(await repository.count()).toBe(1);
    expect(first.results[0]?.canonicalEventId).toBe("canonical-100");
    expect(second).toMatchObject({ cacheSize: 1, snapshotsStored: 1, rateLimitRemaining: 100 });
  });

  it("provider hatasi odds disindaki alt sistemi degrade eder", async () => {
    const provider = { fetch: async () => { throw new Error("stats down"); } } as unknown as SportmonksMatchIntelligenceProvider;
    const service = new MatchIntelligenceService(provider, new MemoryMatchIntelligenceSnapshotRepository(), { cacheMinutes: 45, minSample: 5 });
    const status = await service.refresh([target], new Date("2026-09-30T12:00:00.000Z"));
    expect(status).toMatchObject({ enabled: true, lastError: "stats down", results: [] });
  });
});
