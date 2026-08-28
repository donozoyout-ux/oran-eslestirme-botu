import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAlertStore } from "../src/alert-store.js";
import { JsonDailyMatchSheet } from "../src/daily-match-sheet.js";
import type { Notifier, OddsMatch, OddsProvider, OddsQuote } from "../src/domain.js";
import { OddsMonitor } from "../src/monitor.js";

const timestamp = new Date().toISOString();
const temporaryDirectories: string[] = [];

afterEach(() => {
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
  commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
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

class StaticProvider implements OddsProvider {
  readonly name = "static";
  async fetchQuotes(): Promise<OddsQuote[]> {
    return [baseQuote, { ...baseQuote, bookmakerKey: "b", bookmakerName: "B", price: 2.12 }];
  }
}

class CollectingNotifier implements Notifier {
  readonly name = "collecting";
  readonly sent: OddsMatch[] = [];
  async send(match: OddsMatch): Promise<void> {
    this.sent.push(match);
  }
}

describe("OddsMonitor", () => {
  it("ayni bildirimi cooldown icinde ikinci kez gondermez", async () => {
    const notifier = new CollectingNotifier();
    const monitor = new OddsMonitor(new StaticProvider(), notifier, new MemoryAlertStore(600), {
      tolerancePercent: 2,
      maxQuoteAgeSeconds: 300,
      pollIntervalSeconds: 60,
    }, dailySheet());

    const first = await monitor.runOnce();
    const second = await monitor.runOnce();

    expect(first.alertsSent).toBe(1);
    expect(second.alertsSent).toBe(0);
    expect(second.alertsSuppressed).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(monitor.getStatus().recentQuotes).toHaveLength(2);
    expect(monitor.getStatus().recentMatches).toHaveLength(1);
    expect(monitor.getStatus().dailySheet.oddsSnapshotCount).toBe(4);
  });
});
