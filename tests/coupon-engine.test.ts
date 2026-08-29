import { describe, expect, it } from "vitest";
import { rankCouponCandidates } from "../src/coupon-engine.js";
import type { SelectionConsensus } from "../src/market-analysis-engine.js";

function row(overrides: Partial<SelectionConsensus> = {}): SelectionConsensus {
  return {
    eventKey: "a|b",
    event: "A - B",
    phase: "prematch",
    marketKey: "match_winner_3way",
    market: "Maç Sonucu",
    period: "full_time",
    selectionKey: "home",
    selection: "A",
    line: null,
    sourceCount: 5,
    consensusPrice: 2,
    fairProbabilityPercent: 50,
    dispersionPercent: 2,
    confidenceScore: 90,
    bestBookmaker: "Book A",
    bestPrice: 2.16,
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("rankCouponCandidates", () => {
  it("guclu value ve guven sinyalini oynanabilir olarak siralar", () => {
    const [candidate] = rankCouponCandidates([row()]);
    expect(candidate).toBeDefined();
    expect(candidate!.verdict).toBe("PLAYABLE");
    expect(candidate!.valuePercent).toBeGreaterThan(7);
    expect(candidate!.score).toBeGreaterThanOrEqual(75);
  });

  it("fiyat avantaji olmayan secimi oynanabilir yapmaz", () => {
    const [candidate] = rankCouponCandidates([row({ bestPrice: 1.95 })]);
    expect(candidate).toBeDefined();
    expect(candidate!.verdict).toBe("AVOID");
    expect(candidate!.valuePercent).toBeLessThan(0);
  });
});
