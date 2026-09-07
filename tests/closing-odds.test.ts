import { describe, expect, it } from "vitest";
import { selectClosingSnapshots } from "../src/closing-odds.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "../src/historical-odds.js";

const kickoff = "2026-09-07T18:00:00.000Z";
const fixture: HistoricalCompletedFixture = {
  canonicalEventId: "match-1",
  providerEventIds: [{ provider: "sportmonks", eventId: "1" }],
  league: "Premier League",
  normalizedLeagueKey: "premier league",
  homeTeam: "Home",
  awayTeam: "Away",
  kickoff,
  fixtureResult: "finished",
  homeScore: 2,
  awayScore: 1,
  archivedAt: "2026-09-07T20:00:00.000Z",
};

function snapshot(id: string, snapshotAt: string, providerUpdatedAt = snapshotAt, overrides: Partial<HistoricalOddsSnapshot> = {}): HistoricalOddsSnapshot {
  return {
    id,
    canonicalEventId: "match-1",
    provider: "sportmonks",
    sourceEventId: "1",
    league: "Premier League",
    normalizedLeagueKey: "premier league",
    homeTeam: "Home",
    awayTeam: "Away",
    kickoff,
    snapshotAt,
    providerUpdatedAt,
    snapshotType: "prematch",
    phase: "prematch",
    marketKey: "handicap",
    market: "Asian Handicap",
    period: "full_time",
    selectionKey: "home",
    selection: "Home",
    line: -0.5,
    bookmakerKey: "book-a",
    bookmaker: "Book A",
    price: 1.95,
    ...overrides,
  };
}

describe("closing odds selection", () => {
  it("ayni bookmaker icin kickoff oncesindeki son provider fiyatini secer ve line'i korur", () => {
    const result = selectClosingSnapshots([
      snapshot("early", "2026-09-07T17:40:00.000Z"),
      snapshot("late", "2026-09-07T17:59:00.000Z", "2026-09-07T17:58:30.000Z", { price: 2.02 }),
    ], fixture, { maxProviderAgeSeconds: 300 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ snapshotType: "closing", price: 2.02, line: -0.5 });
  });

  it("kickoff sonrasi, stale ve live snapshotlari closing yapmaz", () => {
    const result = selectClosingSnapshots([
      snapshot("post", "2026-09-07T18:00:01.000Z"),
      snapshot("stale", "2026-09-07T17:59:00.000Z", "2026-09-07T17:40:00.000Z"),
      snapshot("live", "2026-09-07T17:59:30.000Z", "2026-09-07T17:59:20.000Z", {
        snapshotType: "live",
        phase: "live",
      }),
    ], fixture, { maxProviderAgeSeconds: 300 });
    expect(result).toEqual([]);
  });
});
