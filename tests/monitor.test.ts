import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAlertStore } from "../src/alert-store.js";
import { JsonDailyMatchSheet } from "../src/daily-match-sheet.js";
import type { Notifier, OddsAnalysisSignal, OddsMatch, OddsProvider, OddsQuote } from "../src/domain.js";
import { OddsMonitor } from "../src/monitor.js";

const FIXED_NOW = new Date("2026-08-30T12:00:00.000Z");
const timestamp = FIXED_NOW.toISOString();
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function dailySheet(): JsonDailyMatchSheet {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "odds-monitor-"));
  temporaryDirectories.push(directory);
  return new JsonDailyMatchSheet(path.join(directory, "daily.json"), 8);
}

const baseQuote: OddsQuote = {
  provider: "test",
  bookmakerKey: "a",
  bookmakerName: "A",
  sourceEventId: "1",
  sportKey: "soccer_test",
  leagueName: "Test",
  homeTeam: "A Takimi",
  awayTeam: "B Takimi",
  commenceTime: new Date(FIXED_NOW.getTime() + 15 * 60_000).toISOString(),
  phase: "prematch",
  marketKey: "match_winner_3way",
  marketName: "Mac Sonucu",
  period: "full_time",
  selectionKey: "home",
  selectionName: "A Takimi",
  line: null,
  price: 2.1,
  updatedAt: timestamp,
};

function monitorOptions() {
  return {
    tolerancePercent: 2,
    maxQuoteAgeSeconds: 300,
    pollIntervalSeconds: 60,
    prematchAlertWindowMinutes: 20,
    prematchAlertMinSources: 3,
    prematchAlertMinConfidence: 60,
  };
}

class StaticProvider implements OddsProvider {
  readonly name = "static";
  async fetchQuotes(): Promise<OddsQuote[]> {
    return [
      baseQuote,
      { ...baseQuote, bookmakerKey: "b", bookmakerName: "B", price: 2.11 },
      { ...baseQuote, bookmakerKey: "c", bookmakerName: "C", price: 2.12 },
    ];
  }
}

class CollectingNotifier implements Notifier {
  readonly name = "collecting";
  readonly sent: OddsMatch[] = [];
  readonly signals: OddsAnalysisSignal[] = [];
  async send(match: OddsMatch): Promise<void> {
    this.sent.push(match);
  }
  async sendAnalysisSignal(signal: OddsAnalysisSignal): Promise<void> {
    this.signals.push(signal);
  }
}

class MovingProvider implements OddsProvider {
  readonly name = "moving";
  private calls = 0;
  async fetchQuotes(): Promise<OddsQuote[]> {
    this.calls += 1;
    return [{ ...baseQuote, bookmakerKey: "moving-a", bookmakerName: "Moving A", price: this.calls === 1 ? 2.6 : 2.34 }];
  }
}

class ScheduledProvider implements OddsProvider {
  readonly name = "scheduled";
  private calls = 0;
  async fetchQuotes(): Promise<OddsQuote[]> {
    this.calls += 1;
    if (this.calls > 1) return [];
    return [
      baseQuote,
      { ...baseQuote, bookmakerKey: "b", bookmakerName: "B", price: 2.11 },
      { ...baseQuote, bookmakerKey: "c", bookmakerName: "C", price: 2.12 },
    ];
  }
}

describe("OddsMonitor", () => {
  it("son 20 dakikada 3 kaynakla dogrulanan yakinligi mac basina bir kez gonderir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const notifier = new CollectingNotifier();
    const monitor = new OddsMonitor(
      new StaticProvider(),
      notifier,
      new MemoryAlertStore(600),
      monitorOptions(),
      dailySheet(),
    );

    const first = await monitor.runOnce();
    const second = await monitor.runOnce();

    expect(first.alertsSent).toBe(1);
    expect(second.alertsSent).toBe(0);
    expect(second.alertsSuppressed).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.id.startsWith("prematch-close:")).toBe(true);
    expect(monitor.getStatus().recentQuotes).toHaveLength(3);
    expect(monitor.getStatus().recentMatches.length).toBeGreaterThan(0);
    expect(monitor.getStatus().dailySheet.oddsSnapshotCount).toBe(6);
  });

  it("bos planli poll son basarili oran ve eslesme tablosunu silmez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const monitor = new OddsMonitor(
      new ScheduledProvider(),
      new CollectingNotifier(),
      new MemoryAlertStore(600),
      monitorOptions(),
      dailySheet(),
    );

    const first = await monitor.runOnce();
    const afterFirst = monitor.getStatus();
    expect(first.quotesFresh).toBe(3);
    expect(afterFirst.recentQuotes).toHaveLength(3);
    expect(afterFirst.recentMatches.length).toBeGreaterThan(0);
    expect(afterFirst.recentQuotesUpdatedAt).not.toBeNull();
    expect(afterFirst.recentMatchesUpdatedAt).not.toBeNull();

    vi.advanceTimersByTime(60_000);
    const second = await monitor.runOnce();
    const afterEmptyPoll = monitor.getStatus();

    expect(second.quotesFresh).toBe(0);
    expect(second.matchesFound).toBe(0);
    expect(afterEmptyPoll.recentQuotes).toEqual(afterFirst.recentQuotes);
    expect(afterEmptyPoll.recentMatches).toEqual(afterFirst.recentMatches);
    expect(afterEmptyPoll.recentQuotesUpdatedAt).toBe(afterFirst.recentQuotesUpdatedAt);
    expect(afterEmptyPoll.recentMatchesUpdatedAt).toBe(afterFirst.recentMatchesUpdatedAt);
  });

  it("yuzde 8 oran hareketini Telegram bildiricisine bir kez yollar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const notifier = new CollectingNotifier();
    const monitor = new OddsMonitor(
      new MovingProvider(),
      notifier,
      new MemoryAlertStore(600),
      monitorOptions(),
      dailySheet(),
    );

    const first = await monitor.runOnce();
    const second = await monitor.runOnce();
    const third = await monitor.runOnce();

    expect(first.movementAlertsSent).toBe(0);
    expect(second.movementAlertsSent).toBe(1);
    expect(third.movementAlertsSent).toBe(0);
    expect(notifier.signals).toHaveLength(1);
    expect(notifier.signals[0]).toMatchObject({ type: "odds_drop", openingPrice: 2.6, currentPrice: 2.34 });
  });
});
