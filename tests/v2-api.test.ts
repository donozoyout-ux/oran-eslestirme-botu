import { describe, expect, it } from "vitest";
import type { MonitorStatus, RecentQuoteView } from "../src/monitor.js";
import { buildV2Matches } from "../src/v2-api.js";

const now = new Date().toISOString();
const quote = (provider: string, bookmakerKey: string, bookmaker: string, selectionKey: string, price: number): RecentQuoteView => ({
  provider,
  sourceEventId: provider + "-1",
  canonicalEventId: "canon-1",
  event: "Alpha - Beta",
  leagueName: "Test League",
  commenceTime: new Date(Date.now() + 60 * 60_000).toISOString(),
  phase: "prematch",
  marketKey: "match_winner_3way",
  market: "Maç Sonucu",
  selectionKey,
  selection: selectionKey,
  line: null,
  bookmakerKey,
  bookmaker,
  price,
  updatedAt: now,
});

function status(quotes: RecentQuoteView[]): MonitorStatus {
  return {
    recentQuotes: quotes,
    turkishOdds: quotes.filter((item) => item.provider === "mackolik_iddaa"),
    dailySheet: { fixtures: [], recentSignals: [] },
    matchIntelligence: { results: [] },
  } as unknown as MonitorStatus;
}

describe("V2 API projection", () => {
  it("aynı canonical maçı kaynaklar arasında birleştirip en iyi 1-X-2 oranlarını seçer", () => {
    const quotes = [
      quote("mackolik_iddaa", "iddaa", "İddaa", "home", 2.1),
      quote("mackolik_iddaa", "iddaa", "İddaa", "draw", 3.2),
      quote("mackolik_iddaa", "iddaa", "İddaa", "away", 3.4),
      quote("betexplorer_scraper", "bet365", "Bet365", "home", 2.2),
      quote("betexplorer_scraper", "bet365", "Bet365", "draw", 3.1),
      quote("betexplorer_scraper", "bet365", "Bet365", "away", 3.5),
    ];
    const payload = buildV2Matches(status(quotes));
    expect(payload.matches).toHaveLength(1);
    expect(payload.matches[0]?.oddsTable.map((row) => row.source)).toEqual(["Mackolik / İddaa", "BetExplorer"]);
    expect(payload.matches[0]?.bestOdds["1"]?.price).toBe(2.2);
    expect(payload.matches[0]?.bestOdds["2"]?.price).toBe(3.5);
    expect(payload.matches[0]?.sourceCount).toBe(2);
  });

  it("bağımsız form/intelligence yoksa güçlü aday uydurmaz", () => {
    const quotes = [
      quote("mackolik_iddaa", "iddaa", "İddaa", "home", 1.45),
      quote("mackolik_iddaa", "iddaa", "İddaa", "draw", 4.2),
      quote("mackolik_iddaa", "iddaa", "İddaa", "away", 6.5),
      quote("betexplorer_scraper", "bet365", "Bet365", "home", 1.5),
      quote("betexplorer_scraper", "bet365", "Bet365", "draw", 4.1),
      quote("betexplorer_scraper", "bet365", "Bet365", "away", 6.2),
    ];
    const match = buildV2Matches(status(quotes)).matches[0]!;
    expect(["watch", "pass", "insufficient_data"]).toContain(match.recommendation.decision);
    expect(match.favorite.marketProbability).toBeGreaterThan(50);
  });
});
