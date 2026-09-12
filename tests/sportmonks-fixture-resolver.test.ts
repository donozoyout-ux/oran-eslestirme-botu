import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchFixture } from "../src/domain.js";
import { SportmonksFixtureResolver } from "../src/sportmonks-fixture-resolver.js";

afterEach(() => { vi.unstubAllGlobals(); });

const target: MatchFixture & { canonicalEventId: string } = {
  provider: "betexplorer_scraper",
  sourceEventId: "bet-1",
  canonicalEventId: "canonical-genoa-frosinone",
  leagueName: "Serie A",
  homeTeam: "Genoa",
  awayTeam: "Frosinone",
  commenceTime: "2026-09-12T13:53:00.000Z",
  phase: "prematch",
};

describe("SportmonksFixtureResolver", () => {
  it("ilk 50 kayitta olmayan maci pagination ile ikinci sayfadan bulur", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page") ?? "1");
      if (url.pathname.endsWith("/fixtures/date/2026-09-12") && page === 1) {
        return new Response(JSON.stringify({
          data: Array.from({ length: 50 }, (_, index) => ({
            id: index + 1,
            starting_at: "2026-09-12 10:00:00",
            participants: [
              { id: index * 2 + 1, name: `Home ${index}`, meta: { location: "home" } },
              { id: index * 2 + 2, name: `Away ${index}`, meta: { location: "away" } },
            ],
            league: { id: 1, name: "Other League" },
          })),
          pagination: { current_page: 1, has_more: true },
        }), { status: 200 });
      }
      if (url.pathname.endsWith("/fixtures/date/2026-09-12") && page === 2) {
        return new Response(JSON.stringify({
          data: [{
            id: 999,
            starting_at: "2026-09-12 16:53:00",
            participants: [
              { id: 10, name: "Genoa", meta: { location: "home" } },
              { id: 20, name: "Frosinone", meta: { location: "away" } },
            ],
            league: { id: 384, name: "Serie A" },
          }],
          pagination: { current_page: 2, has_more: false },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], pagination: { has_more: false } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new SportmonksFixtureResolver({
      apiToken: "secret",
      toleranceMinutes: 90,
      baseUrl: "https://sportmonks.test",
    });
    const result = await resolver.resolve(target);

    expect(result).toMatchObject({
      status: "resolved",
      sportmonksFixtureId: "999",
      matchedBy: "teams_league_kickoff",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).searchParams.get("page") === "2")).toBe(true);
  });

  it("ayni gun fixture katalogunu cache'den tekrar kullanir", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: 999,
        starting_at: "2026-09-12 16:53:00",
        participants: [
          { id: 10, name: "Genoa", meta: { location: "home" } },
          { id: 20, name: "Frosinone", meta: { location: "away" } },
        ],
        league: { id: 384, name: "Serie A" },
      }],
      pagination: { has_more: false },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new SportmonksFixtureResolver({
      apiToken: "secret",
      toleranceMinutes: 90,
      baseUrl: "https://sportmonks.test",
    });
    await resolver.resolve(target);
    await resolver.resolve({ ...target, sourceEventId: "bet-2" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
