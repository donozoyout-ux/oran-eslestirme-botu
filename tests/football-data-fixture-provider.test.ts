import { afterEach, describe, expect, it, vi } from "vitest";
import { FootballDataFixtureProvider } from "../src/providers/football-data-fixture-provider.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FootballDataFixtureProvider", () => {
  it("fixture ile bitmis mac skorunu getirir ve saatlik cache uygular", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      matches: [
        {
          id: 1,
          utcDate: "2026-08-29T18:00:00Z",
          status: "SCHEDULED",
          competition: { name: "Premier League" },
          homeTeam: { name: "Alpha" },
          awayTeam: { name: "Beta" },
        },
        {
          id: 2,
          utcDate: "2026-08-29T10:00:00Z",
          status: "FINISHED",
          competition: { name: "Premier League" },
          homeTeam: { name: "Old" },
          awayTeam: { name: "Match" },
          score: { fullTime: { home: 2, away: 1 } },
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new FootballDataFixtureProvider({
      apiKey: "token",
      competitionCodes: ["PL"],
      cacheMinutes: 30,
      dailyRequestBudget: 30,
    });

    expect(await provider.fetchQuotes()).toEqual([]);
    expect(await provider.fetchQuotes()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.getLastFixtures()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceEventId: "1", homeTeam: "Alpha", awayTeam: "Beta", phase: "prematch", resultStatus: "scheduled" }),
      expect.objectContaining({ sourceEventId: "2", homeTeam: "Old", awayTeam: "Match", resultStatus: "finished", homeScore: 2, awayScore: 1 }),
    ]));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("competitions=PL");
    expect(init?.headers).toEqual(expect.objectContaining({ "X-Auth-Token": "token" }));

    vi.advanceTimersByTime(59 * 60_000);
    await provider.fetchQuotes();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await provider.fetchQuotes();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
