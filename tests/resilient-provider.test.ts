import { describe, expect, it } from "vitest";
import type { MatchFixture, OddsProvider } from "../src/domain.js";
import { ResilientOddsProvider } from "../src/providers/resilient-provider.js";

const fixture: MatchFixture = {
  provider: "failing",
  sourceEventId: "event-1",
  leagueName: "Test",
  homeTeam: "A",
  awayTeam: "B",
  commenceTime: "2026-08-31T12:00:00.000Z",
  phase: "prematch",
};

describe("resilient odds provider", () => {
  it("tek kaynak hata verse bile turu bos oranla devam ettirir ve fiksturu korur", async () => {
    const failing: OddsProvider = {
      name: "failing",
      async fetchQuotes() {
        throw new Error("timeout");
      },
      getLastFixtures() {
        return [fixture];
      },
    };

    const provider = new ResilientOddsProvider(failing);
    await expect(provider.fetchQuotes()).resolves.toEqual([]);
    expect(provider.getLastFixtures()).toEqual([fixture]);
    expect(provider.name).toBe("failing");
  });
});
