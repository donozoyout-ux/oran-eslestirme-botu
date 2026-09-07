import { describe, expect, it } from "vitest";
import { HistoricalOddsArchive } from "../src/historical-odds-archive.js";
import { HistoricalOddsPatternEngine } from "../src/historical-odds-pattern-engine.js";
import { MemoryHistoricalOddsRepository } from "../src/historical-odds-repository.js";
import type { MatchFixture, OddsQuote } from "../src/domain.js";

const capturedAt = new Date("2026-09-07T17:55:00.000Z");

function quote(provider: string, sourceEventId: string, overrides: Partial<OddsQuote> = {}): OddsQuote {
  return {
    provider,
    bookmakerKey: provider === "sportmonks" ? "book-a" : `book-${provider}`,
    bookmakerName: provider,
    sourceEventId,
    sportKey: "soccer",
    leagueName: "Süper Lig",
    homeTeam: "İstanbul Başakşehir FK",
    awayTeam: "Beşiktaş JK",
    commenceTime: "2026-09-07T18:00:00.000Z",
    phase: "prematch",
    marketKey: "handicap",
    marketName: "Asian Handicap",
    period: "full_time",
    selectionKey: "home",
    selectionName: "Başakşehir",
    line: -0.5,
    price: 1.95,
    updatedAt: "2026-09-07T17:54:30.000Z",
    ...overrides,
  };
}

function completed(provider: string, sourceEventId: string, overrides: Partial<MatchFixture> = {}): MatchFixture {
  return {
    provider,
    sourceEventId,
    leagueName: "Türkiye · Super Lig",
    homeTeam: "Istanbul Basaksehir",
    awayTeam: "Besiktas",
    commenceTime: "2026-09-07T18:04:00.000Z",
    phase: "prematch",
    resultStatus: "finished",
    homeScore: 2,
    awayScore: 1,
    halftimeHomeScore: 1,
    halftimeAwayScore: 0,
    ...overrides,
  };
}

describe("HistoricalOddsArchive", () => {
  it("uc provider kaydini tek canonical tamamlanmis mac yapar ve AH/O-U line'larini korur", async () => {
    const repository = new MemoryHistoricalOddsRepository();
    const engine = new HistoricalOddsPatternEngine(repository);
    const archive = new HistoricalOddsArchive(repository, engine, { maxQuoteAgeSeconds: 300 });
    const quotes = [
      quote("sportmonks", "sm-1"),
      quote("api_football", "api-9", { homeTeam: "Istanbul Basaksehir", awayTeam: "Besiktas" }),
      quote("betexplorer_scraper", "be-4", {
        leagueName: "Turkey · Super Lig",
        marketKey: "total_goals",
        marketName: "Total Goals",
        selectionKey: "over",
        selectionName: "Over",
        line: 2.5,
      }),
    ];
    await archive.record(quotes, [], capturedAt);
    // Ayni provider timestamp/fiyatlari tekrar kaydetmek duplicate uretmemeli.
    await archive.record(quotes, [], new Date("2026-09-07T17:56:00.000Z"));
    await archive.record([], [
      completed("sportmonks", "sm-1"),
      completed("api_football", "api-9"),
      completed("betexplorer_scraper", "be-4"),
    ], new Date("2026-09-07T20:00:00.000Z"));

    const stats = await repository.getStats();
    expect(stats.completedFixtures).toBe(1);
    const rows = await repository.queryCompletedFixtures({ normalizedLeagueKey: "super lig" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerEventIds).toHaveLength(3);
    expect(rows[0]).toMatchObject({ halftimeHomeScore: 1, halftimeAwayScore: 0 });
    const event = await repository.getByCanonicalEvent(rows[0]!.canonicalEventId);
    const closing = event.snapshots.filter((snapshot) => snapshot.snapshotType === "closing");
    expect(closing.some((snapshot) => snapshot.marketKey === "handicap" && snapshot.line === -0.5)).toBe(true);
    expect(closing.some((snapshot) => snapshot.marketKey === "total_goals" && snapshot.line === 2.5)).toBe(true);
  });

  it("stale quote'u historical snapshot olarak kaydetmez", async () => {
    const repository = new MemoryHistoricalOddsRepository();
    const archive = new HistoricalOddsArchive(
      repository,
      new HistoricalOddsPatternEngine(repository),
      { maxQuoteAgeSeconds: 300 },
    );
    await archive.record([
      quote("sportmonks", "stale", { updatedAt: "2026-09-07T17:30:00.000Z" }),
    ], [], capturedAt);
    expect((await repository.getStats()).oddsSnapshots).toBe(0);
  });
});
