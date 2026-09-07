import { describe, expect, it } from "vitest";
import { HistoricalOddsPatternEngine, type HistoricalPatternInput } from "../src/historical-odds-pattern-engine.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "../src/historical-odds.js";
import { MemoryHistoricalOddsRepository } from "../src/historical-odds-repository.js";

function fixture(id: string, kickoff: string, homeScore: number | undefined, awayScore: number | undefined, overrides: Partial<HistoricalCompletedFixture> = {}): HistoricalCompletedFixture {
  return {
    canonicalEventId: id,
    providerEventIds: [{ provider: "test", eventId: id }],
    league: "Premier League",
    normalizedLeagueKey: "premier league",
    homeTeam: `Home ${id}`,
    awayTeam: `Away ${id}`,
    kickoff,
    fixtureResult: "finished",
    ...(homeScore === undefined ? {} : { homeScore }),
    ...(awayScore === undefined ? {} : { awayScore }),
    archivedAt: kickoff,
    ...overrides,
  };
}

function closing(id: string, marketKey: "handicap" | "total_goals", line: number, overrides: Partial<HistoricalOddsSnapshot> = {}): HistoricalOddsSnapshot {
  const selectionKey = marketKey === "handicap" ? "home" : "over";
  return {
    id: `${id}:${marketKey}:${line}:${overrides.snapshotType ?? "closing"}`,
    canonicalEventId: id,
    provider: "test",
    sourceEventId: id,
    league: "Premier League",
    normalizedLeagueKey: "premier league",
    homeTeam: `Home ${id}`,
    awayTeam: `Away ${id}`,
    kickoff: "2025-01-01T18:00:00.000Z",
    snapshotAt: "2025-01-01T17:59:00.000Z",
    providerUpdatedAt: "2025-01-01T17:58:30.000Z",
    snapshotType: "closing",
    phase: "prematch",
    marketKey,
    market: marketKey,
    period: "full_time",
    selectionKey,
    selection: selectionKey,
    line,
    bookmakerKey: "book-a",
    bookmaker: "Book A",
    price: 2,
    ...overrides,
  };
}

const input: HistoricalPatternInput = {
  canonicalEventId: "current",
  normalizedLeagueKey: "premier league",
  kickoff: "2026-09-07T18:00:00.000Z",
  phase: "prematch",
  direction: "home",
  closingAhLine: -0.5,
  closingTotalGoalsLine: 2.5,
  closingPrice: 2,
};

async function add(repo: MemoryHistoricalOddsRepository, row: HistoricalCompletedFixture, ah = -0.5, total = 2.5) {
  await repo.saveCompletedFixture(row);
  await repo.saveOddsSnapshots([closing(row.canonicalEventId, "handicap", ah), closing(row.canonicalEventId, "total_goals", total)]);
}

describe("HistoricalOddsPatternEngine", () => {
  it("AH ve O/U closing birlikte yoksa eventi eligible sample saymaz", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    const row = fixture("ah-only", "2026-08-01T18:00:00.000Z", 2, 1);
    await repo.saveCompletedFixture(row);
    await repo.saveOddsSnapshots([closing(row.canonicalEventId, "handicap", -0.5)]);
    const result = await new HistoricalOddsPatternEngine(repo, { minSampleSize:1 }).analyze(input);
    expect(result.sampleSize).toBe(0);
  });
  it("exact pattern icin dogru denominatorlarla outcome istatistikleri uretir", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    await add(repo, fixture("a", "2026-08-01T18:00:00.000Z", 2, 1));
    await add(repo, fixture("b", "2026-08-02T18:00:00.000Z", 0, 0));
    const result = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1 }).analyze(input);
    expect(result).toMatchObject({ status: "ok", sampleSize: 2, exactLineMatches: 2, nearLineMatches: 0 });
    expect(result.homeWinPercent).toBe(50);
    expect(result.drawPercent).toBe(50);
    expect(result.over25Percent).toBe(50);
    expect(result.bttsYesPercent).toBe(50);
    expect(result.averageGoals).toBe(1.5);
    expect(result.medianGoals).toBe(1.5);
  });

  it("near line'i tolerance icinde esler, disindakini almaz", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    await add(repo, fixture("near", "2026-08-01T18:00:00.000Z", 1, 1), -0.25, 2.75);
    await add(repo, fixture("far", "2026-08-02T18:00:00.000Z", 1, 0), 0.25, 3.5);
    const result = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1, lineTolerance: 0.5 }).analyze(input);
    expect(result.matchedEvents.map((event) => event.canonicalEventId)).toEqual(["near"]);
    expect(result.nearLineMatches).toBe(1);
  });

  it("farkli ligi ve tamamlanmamis sonucu outcome sample'ina katmaz", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    await add(repo, fixture("valid", "2026-08-01T18:00:00.000Z", 1, 0));
    await add(repo, fixture("other-league", "2026-08-02T18:00:00.000Z", 4, 4, {
      league: "La Liga",
      normalizedLeagueKey: "la liga",
    }));
    await add(repo, fixture("unfinished", "2026-08-03T18:00:00.000Z", undefined, undefined, {
      fixtureResult: "scheduled",
    }));
    const result = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1 }).analyze(input);
    expect(result.sampleSize).toBe(1);
    expect(result.homeWinPercent).toBe(100);
  });

  it("analiz edilen macin kendi sonucunu ve gelecekteki maclari leakage olarak dislar", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    await add(repo, fixture("current", "2026-08-01T18:00:00.000Z", 9, 9));
    await add(repo, fixture("future", "2026-10-01T18:00:00.000Z", 9, 9));
    await add(repo, fixture("past", "2026-08-02T18:00:00.000Z", 2, 0));
    const result = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1 }).analyze(input);
    expect(result.matchedEvents.map((event) => event.canonicalEventId)).toEqual(["past"]);
  });

  it("prematch, live ve halftime verisini birbirine karistirmaz", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    const row = fixture("mixed", "2026-08-01T18:00:00.000Z", 2, 1, {
      halftimeHomeScore: 1,
      halftimeAwayScore: 0,
    });
    await repo.saveCompletedFixture(row);
    await repo.saveOddsSnapshots([
      closing("mixed", "handicap", -0.5, { id: "live-ah", snapshotType: "live", phase: "live" }),
      closing("mixed", "total_goals", 2.5, { id: "live-ou", snapshotType: "live", phase: "live" }),
    ]);
    const prematch = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1 }).analyze(input);
    expect(prematch.sampleSize).toBe(0);

    await repo.saveOddsSnapshots([closing("mixed", "handicap", -0.5), closing("mixed", "total_goals", 2.5)]);
    const halftime = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1 }).analyze({
      ...input,
      phase: "halftime",
      halftimeHomeScore: 1,
      halftimeAwayScore: 0,
    });
    expect(halftime.sampleSize).toBe(1);
    const wrongScore = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1 }).analyze({
      ...input,
      phase: "halftime",
      halftimeHomeScore: 0,
      halftimeAwayScore: 0,
    });
    expect(wrongScore.status).toBe("insufficient_data");
  });

  it("kucuk orneklemi insufficient sayar ve confidence'i yuksek gostermez", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    for (let index = 0; index < 4; index += 1) {
      await add(repo, fixture(`small-${index}`, `2026-08-0${index + 1}T18:00:00.000Z`, 3, 0));
    }
    const result = await new HistoricalOddsPatternEngine(repo).analyze(input);
    expect(result).toMatchObject({ status: "insufficient_data", dataQuality: "insufficient", sampleSize: 4 });
    expect(result.confidenceScore).toBeLessThanOrEqual(24);
  });

  it("raw ve recency-weighted yuzdeleri ayri hesaplar", async () => {
    const repo = new MemoryHistoricalOddsRepository();
    await add(repo, fixture("old", "2016-09-07T18:00:00.000Z", 1, 0));
    await add(repo, fixture("recent", "2026-08-30T18:00:00.000Z", 3, 1));
    const result = await new HistoricalOddsPatternEngine(repo, { minSampleSize: 1, recencyHalfLifeDays: 365 }).analyze(input);
    expect(result.over25Percent).toBe(50);
    expect(result.weighted.over25Percent).toBeGreaterThan(90);
    expect(result.effectiveSampleSize).toBeLessThan(result.sampleSize);
  });
});
