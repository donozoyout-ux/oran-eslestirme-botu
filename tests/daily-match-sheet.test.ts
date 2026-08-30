import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonDailyMatchSheet } from "../src/daily-match-sheet.js";
import type { MatchFixture, OddsQuote } from "../src/domain.js";

const temporaryDirectories: string[] = [];
const FIXED_NOW = new Date("2026-08-30T12:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createSheet(): JsonDailyMatchSheet {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daily-sheet-"));
  temporaryDirectories.push(directory);
  return new JsonDailyMatchSheet(path.join(directory, "sheet.json"), 8);
}

function quote(price: number, updatedAt: string, commenceTime: string): OddsQuote {
  return {
    provider: "test",
    bookmakerKey: "book-a",
    bookmakerName: "Book A",
    sourceEventId: "event-1",
    sportKey: "soccer",
    leagueName: "Test Ligi",
    homeTeam: "A",
    awayTeam: "B",
    commenceTime,
    phase: "prematch",
    marketKey: "total_goals",
    marketName: "Toplam Gol",
    period: "full_time",
    selectionKey: "over",
    selectionName: "Üst",
    line: 2.5,
    price,
    updatedAt,
  };
}

describe("gunluk mac tablosu", () => {
  it("saglayicinin guncel fikstur katalogundan cikan maclari listeden kaldirir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const sheet = createSheet();
    const now = new Date();
    const commenceTime = new Date(now.getTime() + 3_600_000).toISOString();
    const kept: MatchFixture = {
      provider: "test",
      sourceEventId: "event-1",
      leagueName: "Izlenen Lig",
      homeTeam: "A",
      awayTeam: "B",
      commenceTime,
      phase: "prematch",
    };
    const removed: MatchFixture = {
      ...kept,
      sourceEventId: "event-2",
      leagueName: "Filtre Disi Lig",
      homeTeam: "C",
      awayTeam: "D",
    };

    await sheet.record([kept, removed], [], [], now);
    await sheet.record([kept], [], [], new Date(now.getTime() + 60_000));

    expect(sheet.getSnapshot().fixtures.map((fixture) => fixture.sourceEventId)).toEqual(["event-1"]);
  });

  it("fiksturu ve oran gecmisini saklar, yuzde 8 hareketi sinyale cevirir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const sheet = createSheet();
    const secondCapture = new Date();
    const firstCapture = new Date(secondCapture.getTime() - 60_000);
    const commenceTime = new Date(secondCapture.getTime() + 3_600_000).toISOString();
    const fixture: MatchFixture = {
      provider: "test",
      sourceEventId: "event-1",
      leagueName: "Test Ligi",
      homeTeam: "A",
      awayTeam: "B",
      commenceTime,
      phase: "prematch",
    };
    await sheet.record([fixture], [quote(2.6, firstCapture.toISOString(), commenceTime)], [], firstCapture);
    const movement = await sheet.record(
      [fixture],
      [quote(2.34, secondCapture.toISOString(), commenceTime)],
      [],
      secondCapture,
    );

    const snapshot = sheet.getSnapshot();
    expect(snapshot.fixtures).toHaveLength(1);
    expect(snapshot.oddsSnapshotCount).toBe(2);
    expect(snapshot.recentSignals[0]).toMatchObject({ type: "odds_drop", line: 2.5 });
    expect(movement.pendingMovementSignals).toHaveLength(1);
    await sheet.markSignalNotified(movement.pendingMovementSignals[0]!.id, secondCapture);
    const afterNotification = await sheet.record([fixture], [], [], secondCapture);
    expect(afterNotification.pendingMovementSignals).toHaveLength(0);
    expect(sheet.fixturesCsv()).toContain("Test Ligi");
    expect(sheet.oddsHistoryCsv()).toContain("2.34");
  });
});
