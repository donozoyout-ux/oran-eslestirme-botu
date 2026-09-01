import { describe, expect, it } from "vitest";
import type { OddsMatch, OddsQuote } from "../src/domain.js";
import type { SelectionConsensus } from "../src/market-analysis-engine.js";
import { selectPrematchCloseAlerts } from "../src/prematch-alert-gate.js";

const now = new Date("2026-09-01T17:45:00.000Z");

function quote(bookmakerKey: string, bookmakerName: string, price: number): OddsQuote {
  return {
    provider: "test",
    bookmakerKey,
    bookmakerName,
    sourceEventId: "101",
    sportKey: "soccer",
    leagueName: "Championship",
    homeTeam: "Hull City",
    awayTeam: "Away",
    commenceTime: "2026-09-01T18:00:00.000Z",
    phase: "prematch",
    marketKey: "match_winner_3way",
    marketName: "Match Winner",
    period: "full_time",
    selectionKey: "home",
    selectionName: "Hull City",
    line: null,
    price,
    updatedAt: now.toISOString(),
  };
}

function match(a: number, b: number): OddsMatch {
  return {
    id: "raw",
    eventKey: "hull|away|bucket|prematch",
    marketSignature: "match_winner_3way|full_time|home|none",
    phase: "prematch",
    relativeDifferencePercent: 1,
    quoteA: quote("a", "A", a),
    quoteB: quote("b", "B", b),
    detectedAt: now.toISOString(),
  };
}

function row(bestPrice: number, fairProbabilityPercent: number): SelectionConsensus {
  return {
    eventKey: "hull|away|bucket|prematch",
    event: "Hull City - Away",
    phase: "prematch",
    marketKey: "match_winner_3way",
    market: "Match Winner",
    period: "full_time",
    selectionKey: "home",
    selection: "Hull City",
    line: null,
    sourceCount: 4,
    consensusPrice: 1.45,
    fairProbabilityPercent,
    dispersionPercent: 1,
    confidenceScore: 90,
    bestBookmaker: "A",
    bestPrice,
    detectedAt: now.toISOString(),
  };
}

const options = {
  windowMinutes: 20,
  minSources: 3,
  minConfidenceScore: 70,
  maxDispersionPercent: 2,
  minValuePercent: 2,
};

describe("prematch value gate", () => {
  it("dusuk oran ve yakin bookmaker fiyati tek basina bildirim olmaz", () => {
    // Adil oran 1.45; 1.46 fiyatta anlamli edge yok.
    const alerts = selectPrematchCloseAlerts([match(1.45, 1.46)], [row(1.46, 68.9655)], now, options);
    expect(alerts).toEqual([]);
  });

  it("ayni piyasa ancak adil orana gore pozitif value tasiyorsa bildirim olur", () => {
    // Adil oran 1.45; 1.52 yaklasik %4.8 pozitif value.
    const alerts = selectPrematchCloseAlerts([match(1.51, 1.52)], [row(1.52, 68.9655)], now, options);
    expect(alerts).toHaveLength(1);
  });
});
