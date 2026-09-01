import { describe, expect, it } from "vitest";
import type { OddsAnalysisSignal } from "../src/domain.js";
import type { SelectionConsensus } from "../src/market-analysis-engine.js";
import { selectSmartAnalysisAlerts } from "../src/smart-alert-gate.js";

function consensus(overrides: Partial<SelectionConsensus> = {}): SelectionConsensus {
  return {
    eventKey: "hull|away|1|live",
    event: "Hull City - Away",
    phase: "live",
    marketKey: "total_goals",
    market: "Goals Over/Under",
    period: "full_time",
    selectionKey: "over",
    selection: "Üst",
    line: 2.5,
    sourceCount: 4,
    consensusPrice: 2,
    fairProbabilityPercent: 50,
    dispersionPercent: 6,
    confidenceScore: 88,
    bestBookmaker: "Best",
    bestPrice: 2.2,
    detectedAt: "2026-09-01T19:00:00.000Z",
    ...overrides,
  };
}

function signal(overrides: Partial<OddsAnalysisSignal> = {}): OddsAnalysisSignal {
  return {
    id: "sig-1",
    type: "source_outlier",
    event: "Hull City - Away",
    market: "Goals Over/Under",
    selection: "Üst",
    line: 2.5,
    detail: "test",
    detectedAt: "2026-09-01T19:00:00.000Z",
    currentPrice: 2.2,
    consensusPrice: 2,
    sourceCount: 4,
    confidenceScore: 88,
    ...overrides,
  };
}

describe("smart alert gate", () => {
  it("piyasa medyanindan dusuk kotu fiyati bildirim yapmaz", () => {
    const rows = [consensus({ consensusPrice: 1.5, fairProbabilityPercent: 66.67, bestPrice: 1.5 })];
    const alerts = selectSmartAnalysisAlerts([
      signal({ currentPrice: 1.35, consensusPrice: 1.5 }),
    ], rows);
    expect(alerts).toEqual([]);
  });

  it("oran dususunu tek basina akilli aday saymaz", () => {
    const alerts = selectSmartAnalysisAlerts([
      signal({ type: "odds_drop", currentPrice: 2.2, changePercent: -10 }),
    ], [consensus()]);
    expect(alerts).toEqual([]);
  });

  it("canli 1X2 tarafini skor ve dakika baglami olmadan susturur", () => {
    const row = consensus({
      marketKey: "match_winner_3way",
      market: "Match Winner",
      selectionKey: "home",
      selection: "Hull City",
      line: null,
      consensusPrice: 1.6,
      fairProbabilityPercent: 62.5,
      bestPrice: 1.75,
    });
    const alerts = selectSmartAnalysisAlerts([
      signal({
        event: row.event,
        market: row.market,
        selection: row.selection,
        line: null,
        currentPrice: 1.75,
        consensusPrice: 1.6,
      }),
    ], [row]);
    expect(alerts).toEqual([]);
  });

  it("canli yan pazarda coklu kaynak + guven + pozitif value varsa bildirir", () => {
    const candidate = signal({ currentPrice: 2.2, consensusPrice: 2 });
    const alerts = selectSmartAnalysisAlerts([candidate], [consensus()]);
    expect(alerts).toEqual([candidate]);
  });

  it("teorik arbitraji value kapisindan bagimsiz korur", () => {
    const arb = signal({ type: "arbitrage", currentPrice: undefined, consensusPrice: undefined });
    expect(selectSmartAnalysisAlerts([arb], [])).toEqual([arb]);
  });
});
