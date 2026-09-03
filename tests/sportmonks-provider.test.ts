import { afterEach, describe, expect, it, vi } from "vitest";
import { getProviderDiagnostics, resetProviderDiagnosticsForTests } from "../src/provider-diagnostics.js";
import { SportmonksProvider } from "../src/providers/sportmonks-provider.js";

const commonOptions = {
  apiToken: "sportmonks-secret",
  bookmakerKeys: ["bet365", "pinnacle"],
  refreshMinutes: 3,
  maxPages: 4,
  leagueScope: "turkey_europe_top10_big5_tier3" as const,
  maxLiveEventAgeMinutes: 180,
  baseUrl: "https://sportmonks.test/v3/football",
};

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 901,
    name: "Alpha FC vs Beta FC",
    starting_at: "2026-09-02 20:00:00",
    starting_at_timestamp: 1788379200,
    participants: [
      { id: 11, name: "Alpha FC", meta: { location: "home" } },
      { id: 22, name: "Beta FC", meta: { location: "away" } },
    ],
    league: { id: 8, name: "Premier League", country: { name: "England" } },
    state: { developer_name: "NS" },
    scores: [],
    odds: [],
    inplayOdds: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetProviderDiagnosticsForTests();
});

describe("SportmonksProvider", () => {
  it("fikstur ile prematch oranlarini tek cagriyla alir, normalize eder ve cache kullanir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v3/football/fixtures/date/2026-09-02");
      expect(url.searchParams.get("include")).toContain("odds.bookmaker");
      expect(new Headers(init?.headers).get("Authorization")).toBe("sportmonks-secret");
      return new Response(JSON.stringify({
        data: [fixture({ odds: [
          {
            id: 1, fixture_id: 901, market_id: 1, bookmaker_id: 2,
            label: "1", name: "Alpha FC", value: "2.10", market_description: "Fulltime Result",
            bookmaker: { id: 2, name: "Bet365" }, market: { id: 1, developer_name: "Fulltime Result" },
          },
          {
            id: 2, fixture_id: 901, market_id: 18, bookmaker_id: 2,
            label: "Over", name: "Over 2.5", value: "1.95", total: "2.5",
            bookmaker: { id: 2, name: "Bet365" }, market: { id: 18, developer_name: "Goals Over/Under" },
          },
          {
            id: 3, fixture_id: 901, market_id: 1, bookmaker_id: 12,
            label: "X", name: "Draw", value: "3.30", market_description: "Fulltime Result",
            bookmaker: { id: 12, name: "Pinnacle" }, market: { id: 1, developer_name: "Fulltime Result" },
          },
        ] })],
        pagination: { current_page: 1, has_more: false },
        rate_limit: { remaining: 2999, resets_in_seconds: 1800, requested_entity: "Fixture" },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SportmonksProvider(commonOptions);
    const first = await provider.fetchQuotes();
    const second = await provider.fetchQuotes();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(provider.getLastFixtures()).toEqual([
      expect.objectContaining({ sourceEventId: "901", phase: "prematch", resultStatus: "scheduled" }),
    ]);
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ bookmakerKey: "bet365", marketKey: "match_winner_3way", selectionKey: "home", price: 2.1 }),
      expect.objectContaining({ marketKey: "total_goals", selectionKey: "over", line: 2.5 }),
      expect.objectContaining({ bookmakerKey: "pinnacle", selectionKey: "draw" }),
    ]));
    expect(getProviderDiagnostics().sportmonks).toEqual(expect.objectContaining({
      status: "ok", mode: "fixtures_and_odds", fixtureCount: 1, quoteCount: 3, remainingRequests: 2999,
    }));
  });

  it("canli durumu, skoru ve inplay oranini donusturur", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T17:20:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [fixture({
        state: { developer_name: "INPLAY" },
        scores: [
          { participant_id: 11, description: "CURRENT", score: { goals: 1, participant: "home" } },
          { participant_id: 22, description: "CURRENT", score: { goals: 0, participant: "away" } },
        ],
        inplayOdds: [{
          id: 4, fixture_id: 901, market_id: 1, bookmaker_id: 2,
          label: "2", name: "Beta FC", value: "4.20",
          bookmaker: { id: 2, name: "Bet365" }, market: { id: 1, developer_name: "Match Winner" },
        }],
      })],
      pagination: { has_more: false },
    }), { status: 200 })));

    const provider = new SportmonksProvider(commonOptions);
    const quotes = await provider.fetchQuotes();

    expect(provider.getLastFixtures()).toEqual([
      expect.objectContaining({ phase: "live", resultStatus: "live", homeScore: 1, awayScore: 0 }),
    ]);
    expect(quotes).toEqual([expect.objectContaining({ phase: "live", selectionKey: "away", price: 4.2 })]);
  });

  it("odds add-on yetkisi yoksa fikstur/skor moduna otomatik duser", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const include = new URL(String(input)).searchParams.get("include") ?? "";
      if (include.includes("odds.bookmaker")) {
        return new Response(JSON.stringify({ message: "No access to odds add-on" }), { status: 403 });
      }
      return new Response(JSON.stringify({ data: [fixture()], pagination: { has_more: false } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SportmonksProvider(commonOptions);
    expect(await provider.fetchQuotes()).toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provider.getLastFixtures()).toHaveLength(1);
    expect(getProviderDiagnostics().sportmonks).toEqual(expect.objectContaining({ status: "ok", mode: "fixtures_only" }));
  });

  it("has_more oldugunda sayfalari takip eder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));
    const pages: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const page = new URL(String(input)).searchParams.get("page") ?? "1";
      pages.push(page);
      return new Response(JSON.stringify({
        data: [fixture({ id: 900 + Number(page) })],
        pagination: { current_page: Number(page), has_more: page === "1" },
      }), { status: 200 });
    }));

    const provider = new SportmonksProvider({ ...commonOptions, maxPages: 2, includeOdds: false });
    await provider.fetchQuotes();

    expect(pages).toEqual(["1", "2"]);
    expect(provider.getLastFixtures()).toHaveLength(2);
  });
});
