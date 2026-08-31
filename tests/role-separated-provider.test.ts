import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchFixture, OddsProvider, OddsQuote } from "../src/domain.js";
import { RoleSeparatedOddsProvider } from "../src/providers/role-separated-provider.js";

function quote(provider: string, phase: "prematch" | "live"): OddsQuote {
  return {
    provider,
    bookmakerKey: provider,
    bookmakerName: provider,
    sourceEventId: `${provider}-${phase}`,
    sportKey: "soccer_epl",
    leagueName: "Premier League",
    homeTeam: "A",
    awayTeam: "B",
    commenceTime: phase === "live" ? "2026-08-31T09:00:00.000Z" : "2026-08-31T18:00:00.000Z",
    phase,
    marketKey: "match_winner_3way",
    marketName: "Mac Sonucu",
    period: "full_time",
    selectionKey: "home",
    selectionName: "A",
    line: null,
    price: 2,
    updatedAt: "2026-08-31T09:30:00.000Z",
  };
}

function provider(name: string, fetchQuotes: OddsProvider["fetchQuotes"], fixtures: MatchFixture[] = []): OddsProvider {
  return { name, fetchQuotes, getLastFixtures: () => fixtures };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RoleSeparatedOddsProvider", () => {
  it("scraper saglikliyken API-Football live oranini birlestirir ama The Odds API'yi cagirmadan devam eder", async () => {
    const fallbackFetch = vi.fn(async () => [quote("the_odds_api", "prematch")]);
    const fixtureFetch = vi.fn(async () => [] as OddsQuote[]);
    const routed = new RoleSeparatedOddsProvider(
      provider("betexplorer_scraper", async () => [quote("betexplorer_scraper", "prematch")]),
      provider("api_football", async () => [quote("api_football", "live")]),
      [provider("football_data", fixtureFetch)],
      provider("the_odds_api", fallbackFetch),
    );

    const quotes = await routed.fetchQuotes();

    expect(quotes.map((item) => item.provider).sort()).toEqual(["api_football", "betexplorer_scraper"]);
    expect(fallbackFetch).not.toHaveBeenCalled();
    expect(fixtureFetch).toHaveBeenCalledTimes(1);
  });

  it("scraper hata verirse The Odds API'yi sadece prematch yedek olarak kullanir", async () => {
    const fallbackFetch = vi.fn(async () => [
      quote("the_odds_api", "prematch"),
      quote("the_odds_api", "live"),
    ]);
    const routed = new RoleSeparatedOddsProvider(
      provider("betexplorer_scraper", async () => { throw new Error("scraper down"); }),
      provider("api_football", async () => [quote("api_football", "live")]),
      [],
      provider("the_odds_api", fallbackFetch),
    );

    const quotes = await routed.fetchQuotes();

    expect(fallbackFetch).toHaveBeenCalledTimes(1);
    expect(quotes).toEqual([
      quote("api_football", "live"),
      quote("the_odds_api", "prematch"),
    ]);
  });

  it("scraper arizasi devam etse bile fallback'i cooldown boyunca tekrar cagirmaz", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T09:30:00.000Z"));
    const fallbackFetch = vi.fn(async () => [quote("the_odds_api", "prematch")]);
    const routed = new RoleSeparatedOddsProvider(
      provider("betexplorer_scraper", async () => { throw new Error("scraper down"); }),
      provider("api_football", async () => []),
      [],
      provider("the_odds_api", fallbackFetch),
      { fallbackCooldownMinutes: 60 },
    );

    await routed.fetchQuotes();
    vi.advanceTimersByTime(10 * 60_000);
    await routed.fetchQuotes();
    expect(fallbackFetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(51 * 60_000);
    await routed.fetchQuotes();
    expect(fallbackFetch).toHaveBeenCalledTimes(2);
  });

  it("tum rollerin fixture kataloglarini bir arada korur", () => {
    const fixture = (providerName: string, id: string): MatchFixture => ({
      provider: providerName,
      sourceEventId: id,
      leagueName: "League",
      homeTeam: "A",
      awayTeam: "B",
      commenceTime: "2026-08-31T18:00:00.000Z",
      phase: "prematch",
    });
    const routed = new RoleSeparatedOddsProvider(
      provider("betexplorer_scraper", async () => [], [fixture("betexplorer_scraper", "1")]),
      provider("api_football", async () => [], [fixture("api_football", "2")]),
      [provider("football_data", async () => [], [fixture("football_data", "3")])],
      provider("the_odds_api", async () => [], [fixture("the_odds_api", "4")]),
    );

    expect(routed.getLastFixtures()).toHaveLength(4);
  });
});
