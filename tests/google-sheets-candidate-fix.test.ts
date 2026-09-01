import { describe, expect, it } from "vitest";
import type { DailySheetDataset, OddsHistoryEntry } from "../src/daily-match-sheet.js";
import { googleSheetCandidateFixInternals } from "../src/google-sheets-candidate-fix.js";

const now = new Date("2026-09-01T19:30:00.000Z");

function entry(provider: string, bookmakerKey: string, price: number, marketKey = "total_goals"): OddsHistoryEntry {
  return {
    capturedAt: now.toISOString(),
    provider,
    sourceEventId: `${provider}-different-id`,
    event: "Hull City - Swansea City",
    phase: "live",
    marketKey,
    market: marketKey === "total_goals" ? "Goals Over/Under" : "Match Winner",
    period: "full_time",
    selectionKey: marketKey === "total_goals" ? "over" : "home",
    selection: marketKey === "total_goals" ? "Üst" : "Hull City",
    line: marketKey === "total_goals" ? 2.5 : null,
    bookmakerKey,
    bookmaker: bookmakerKey.toUpperCase(),
    price,
    sourceUpdatedAt: now.toISOString(),
  };
}

function dataset(entries: OddsHistoryEntry[]): DailySheetDataset {
  return {
    date: "2026-09-01",
    fixtures: [{
      provider: "api_football",
      sourceEventId: "fixture-999",
      leagueName: "Championship",
      homeTeam: "Hull City",
      awayTeam: "Swansea City",
      commenceTime: "2026-09-01T18:30:00.000Z",
      phase: "live",
      lastOddsCheckAt: now.toISOString(),
    }],
    oddsHistory: entries,
    signals: [],
  };
}

describe("Google Sheet candidate reconciliation", () => {
  it("farkli provider event ID'lerini takim adiyla ayni maca birlestirir", () => {
    const result = googleSheetCandidateFixInternals.candidateRows(dataset([
      entry("scraper", "a", 2.00),
      entry("api_football", "b", 2.02),
      entry("other", "c", 2.12),
    ]), now);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      event: "Hull City - Swansea City",
      sourceCount: 3,
      verdict: "GÜÇLÜ ADAY",
      marketKey: "total_goals",
    });
    expect(result.rows[0]!.valuePercent).toBeGreaterThan(2.5);
  });

  it("canli 1X2'yi skor/dakika baglami yokken BEKLE yapar", () => {
    const result = googleSheetCandidateFixInternals.candidateRows(dataset([
      entry("scraper", "a", 1.50, "match_winner_3way"),
      entry("api_football", "b", 1.52, "match_winner_3way"),
      entry("other", "c", 1.65, "match_winner_3way"),
    ]), now);

    expect(result.rows[0]?.verdict).toBe("BEKLE");
    expect(result.rows[0]?.reason).toContain("skor/dakika");
  });

  it("aktif mac varsa BUGUN_NE_OYNANIR tablosunu hic bos birakmaz", () => {
    const rows = googleSheetCandidateFixInternals.todayRows(dataset([]), now);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[2]).toBe("BEKLE");
    expect(String(rows[1]?.[3])).toContain("Hull City");
  });
});
