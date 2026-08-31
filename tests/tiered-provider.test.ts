import { describe, expect, it, vi } from "vitest";
import type { OddsProvider, OddsQuote } from "../src/domain.js";
import { TieredOddsProvider } from "../src/providers/tiered-provider.js";

function quote(provider: string): OddsQuote {
  return {
    provider,
    bookmakerKey: provider,
    bookmakerName: provider,
    sourceEventId: `${provider}-event`,
    sportKey: "soccer_epl",
    leagueName: "Premier League",
    homeTeam: "A",
    awayTeam: "B",
    commenceTime: "2026-08-31T18:00:00.000Z",
    phase: "prematch",
    marketKey: "match_winner_3way",
    marketName: "Mac Sonucu",
    period: "full_time",
    selectionKey: "home",
    selectionName: "Ev Sahibi",
    line: null,
    price: 2,
    updatedAt: "2026-08-31T12:00:00.000Z",
  };
}

describe("TieredOddsProvider", () => {
  it("ana kaynak bos ama saglikliysa fallback'i cagirmaz", async () => {
    const primaryFetch = vi.fn(async () => [] as OddsQuote[]);
    const fallbackFetch = vi.fn(async () => [quote("the_odds_api")]);
    const provider = new TieredOddsProvider(
      [{ name: "betexplorer_scraper", fetchQuotes: primaryFetch }],
      [],
      { name: "the_odds_api", fetchQuotes: fallbackFetch },
    );

    await expect(provider.fetchQuotes()).resolves.toEqual([]);
    expect(primaryFetch).toHaveBeenCalledTimes(1);
    expect(fallbackFetch).not.toHaveBeenCalled();
  });

  it("ana kaynak oran getiriyorsa fallback'i cagirmaz", async () => {
    const primaryFetch = vi.fn(async () => [quote("api_football")]);
    const fallbackFetch = vi.fn(async () => [quote("the_odds_api")]);
    const provider = new TieredOddsProvider(
      [{ name: "api_football", fetchQuotes: primaryFetch }],
      [],
      { name: "the_odds_api", fetchQuotes: fallbackFetch },
    );

    await expect(provider.fetchQuotes()).resolves.toEqual([quote("api_football")]);
    expect(fallbackFetch).not.toHaveBeenCalled();
  });

  it("bir ana kaynak hata verip digeri bos cevap verirse fallback'i cagirmaz", async () => {
    const failedFetch = vi.fn(async (): Promise<OddsQuote[]> => {
      throw new Error("scraper timeout");
    });
    const healthyEmptyFetch = vi.fn(async () => [] as OddsQuote[]);
    const fallbackFetch = vi.fn(async () => [quote("the_odds_api")]);
    const provider = new TieredOddsProvider(
      [
        { name: "betexplorer_scraper", fetchQuotes: failedFetch },
        { name: "api_football", fetchQuotes: healthyEmptyFetch },
      ],
      [],
      { name: "the_odds_api", fetchQuotes: fallbackFetch },
    );

    await expect(provider.fetchQuotes()).resolves.toEqual([]);
    expect(fallbackFetch).not.toHaveBeenCalled();
  });

  it("yalnizca tum ana oran kaynaklari hata verirse fallback'i cagirir", async () => {
    const firstFetch = vi.fn(async (): Promise<OddsQuote[]> => {
      throw new Error("scraper timeout");
    });
    const secondFetch = vi.fn(async (): Promise<OddsQuote[]> => {
      throw new Error("api football down");
    });
    const fallbackFetch = vi.fn(async () => [quote("the_odds_api")]);
    const fixtureFetch = vi.fn(async () => [] as OddsQuote[]);
    const fixtureProvider: OddsProvider = {
      name: "football_data",
      fetchQuotes: fixtureFetch,
      getLastFixtures: () => [{
        provider: "football_data",
        sourceEventId: "fixture-1",
        leagueName: "Premier League",
        homeTeam: "A",
        awayTeam: "B",
        commenceTime: "2026-08-31T18:00:00.000Z",
        phase: "prematch",
      }],
    };
    const provider = new TieredOddsProvider(
      [
        { name: "betexplorer_scraper", fetchQuotes: firstFetch },
        { name: "api_football", fetchQuotes: secondFetch },
      ],
      [fixtureProvider],
      { name: "the_odds_api", fetchQuotes: fallbackFetch },
    );

    await expect(provider.fetchQuotes()).resolves.toEqual([quote("the_odds_api")]);
    expect(fallbackFetch).toHaveBeenCalledTimes(1);
    expect(provider.getLastFixtures()).toEqual([
      expect.objectContaining({ provider: "football_data", sourceEventId: "fixture-1" }),
    ]);
  });
});
