import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MatchFixture, OddsQuote } from "../src/domain.js";
import { ResultsTracker } from "../src/results-tracker.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function tracker(): ResultsTracker {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "odds-results-"));
  directories.push(directory);
  return new ResultsTracker(path.join(directory, "results.json"));
}

function quotes(now: Date): OddsQuote[] {
  const commenceTime = new Date(now.getTime() + 60 * 60_000).toISOString();
  const base: OddsQuote = {
    provider: "scraper",
    bookmakerKey: "a",
    bookmakerName: "Book A",
    sourceEventId: "scrape-1",
    sportKey: "soccer",
    leagueName: "Premier League",
    homeTeam: "Alpha FC",
    awayTeam: "Beta Club",
    commenceTime,
    phase: "prematch",
    marketKey: "total_goals",
    marketName: "Toplam Gol",
    period: "full_time",
    selectionKey: "over",
    selectionName: "Üst",
    line: 2.5,
    price: 2,
    updatedAt: now.toISOString(),
  };
  return [
    base,
    { ...base, provider: "scraper", bookmakerKey: "b", bookmakerName: "Book B", price: 2 },
    { ...base, provider: "backup", bookmakerKey: "c", bookmakerName: "Book C", price: 2.08 },
  ];
}

describe("ResultsTracker", () => {
  it("prematch adayi kaydeder ve final skorla dogru olarak kapatir", async () => {
    const now = new Date("2026-08-31T18:00:00.000Z");
    const resultTracker = tracker();
    await resultTracker.record(quotes(now), [], now);

    const pending = resultTracker.getSnapshot(now);
    expect(pending.picks).toHaveLength(1);
    expect(pending.picks[0]?.status).toBe("pending");
    expect(pending.picks[0]?.decision).toBe("İZLE");

    const finishedAt = new Date("2026-08-31T21:00:00.000Z");
    const fixture: MatchFixture = {
      provider: "football_data",
      sourceEventId: "fd-99",
      leagueName: "Premier League",
      homeTeam: "Alpha",
      awayTeam: "Beta",
      commenceTime: pending.picks[0]!.commenceTime,
      phase: "prematch",
      resultStatus: "finished",
      homeScore: 2,
      awayScore: 1,
    };
    await resultTracker.record([], [fixture], finishedAt);

    const settled = resultTracker.getSnapshot(finishedAt);
    expect(settled.picks[0]).toMatchObject({ status: "won", finalScore: "2-1", settlementSource: "football_data" });
    expect(settled.summary.won).toBe(1);
    expect(settled.summary.lost).toBe(0);
    expect(settled.summary.hitRatePercent).toBe(100);
  });

  it("iptal edilen maci iade sayar", async () => {
    const now = new Date("2026-08-31T18:00:00.000Z");
    const resultTracker = tracker();
    await resultTracker.record(quotes(now), [], now);
    const pick = resultTracker.getSnapshot(now).picks[0]!;
    await resultTracker.record([], [{
      provider: "football_data",
      sourceEventId: "fd-cancelled",
      leagueName: "Premier League",
      homeTeam: "Alpha",
      awayTeam: "Beta",
      commenceTime: pick.commenceTime,
      phase: "prematch",
      resultStatus: "cancelled",
    }], new Date("2026-08-31T20:00:00.000Z"));
    expect(resultTracker.getSnapshot().picks[0]?.status).toBe("void");
  });
});
