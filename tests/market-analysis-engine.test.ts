import { describe, expect, it } from "vitest";
import type { OddsQuote } from "../src/domain.js";
import { analyzeOddsMarket } from "../src/market-analysis-engine.js";

const now = new Date("2026-08-29T12:00:00.000Z");

function quote(bookmakerKey: string, selectionKey: string, price: number): OddsQuote {
  const selectionName = selectionKey === "home" ? "Home" : selectionKey === "draw" ? "Draw" : "Away";
  return {
    provider: "test",
    bookmakerKey,
    bookmakerName: bookmakerKey.toUpperCase(),
    sourceEventId: "event-1",
    sportKey: "soccer_test",
    leagueName: "Test League",
    homeTeam: "Home",
    awayTeam: "Away",
    commenceTime: "2026-08-29T18:00:00.000Z",
    phase: "prematch",
    marketKey: "match_winner_3way",
    marketName: "Match Winner",
    period: "full_time",
    selectionKey,
    selectionName,
    line: null,
    price,
    updatedAt: now.toISOString(),
  };
}

describe("analyzeOddsMarket", () => {
  it("bookmaker marjini normalize edip konsensus ve guven skoru uretir", () => {
    const quotes = [
      quote("a", "home", 2.05), quote("a", "draw", 3.4), quote("a", "away", 3.7),
      quote("b", "home", 2.1), quote("b", "draw", 3.35), quote("b", "away", 3.6),
      quote("c", "home", 2.08), quote("c", "draw", 3.45), quote("c", "away", 3.65),
    ];
    const result = analyzeOddsMarket(quotes, {}, now);
    const home = result.consensus.find((item) => item.selectionKey === "home");
    expect(home).toBeDefined();
    expect(home!.sourceCount).toBe(3);
    expect(home!.consensusPrice).toBeCloseTo(2.08, 5);
    expect(home!.fairProbabilityPercent).toBeGreaterThan(43);
    expect(home!.fairProbabilityPercent).toBeLessThan(48);
    expect(home!.confidenceScore).toBeGreaterThanOrEqual(70);
  });

  it("piyasa medyanindan belirgin sapan kaynagi isaretler", () => {
    const quotes = [
      quote("a", "home", 2.05), quote("a", "draw", 3.4), quote("a", "away", 3.7),
      quote("b", "home", 2.08), quote("b", "draw", 3.35), quote("b", "away", 3.65),
      quote("c", "home", 2.42), quote("c", "draw", 3.45), quote("c", "away", 3.6),
      quote("d", "home", 2.06), quote("d", "draw", 3.42), quote("d", "away", 3.68),
    ];
    const result = analyzeOddsMarket(quotes, { outlierThresholdPercent: 7 }, now);
    expect(result.alertSignals.some((signal) => signal.type === "source_outlier" && signal.bookmaker === "C")).toBe(true);
  });

  it("tum sonuclarin en iyi oranlari toplamda yuzde 100 altindaysa arbitraj bulur", () => {
    const quotes = [
      quote("a", "home", 2.4), quote("a", "draw", 3.1), quote("a", "away", 3.1),
      quote("b", "home", 2.0), quote("b", "draw", 3.8), quote("b", "away", 3.1),
      quote("c", "home", 2.0), quote("c", "draw", 3.1), quote("c", "away", 4.0),
    ];
    const result = analyzeOddsMarket(quotes, { minArbitrageMarginPercent: 0.1 }, now);
    expect(result.arbitrage).toHaveLength(1);
    expect(result.arbitrage[0]!.marginPercent).toBeGreaterThan(0);
    expect(result.arbitrage[0]!.legs).toHaveLength(3);
    expect(result.alertSignals.some((signal) => signal.type === "arbitrage")).toBe(true);
  });
});
