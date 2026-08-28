import { describe, expect, it } from "vitest";
import {
  canonicalBookmaker,
  parseCandidateIndexHtml,
  parseDetailSnapshot,
  type BetExplorerCandidate,
  type BetExplorerPageSnapshot,
} from "../src/providers/betexplorer-scraper-provider.js";

const now = new Date("2026-08-28T10:00:00.000Z");

function candidate(phaseHint: "prematch" | "live"): BetExplorerCandidate {
  return {
    eventId: "C0b6Sk9l",
    url: "https://www.betexplorer.com/football/england/premier-league/a-b/C0b6Sk9l/",
    commenceTime: "2026-08-28T12:00:00.000Z",
    phaseHint,
    deltaMinutes: phaseHint === "live" ? -10 : 120,
  };
}

describe("BetExplorer scraper", () => {
  it("liste HTML'inden canli ve yaklasan maclari sinirli secer", () => {
    const html = `
      <ul class="table-main__matchInfo" data-live="LIVE0001" data-dt="28,8,2026,12,30" data-dt-now="28,8,2026,12,39">
        <a data-live-cell="matchlink" href="/football/turkey/super-lig/a-b/LIVE0001/">A - B</a>
      </ul>
      <ul class="table-main__matchInfo" data-live="NEXT0001" data-dt="28,8,2026,13,00" data-dt-now="28,8,2026,12,39">
        <a data-live-cell="matchlink" href="/football/england/premier-league/c-d/NEXT0001/">C - D</a>
      </ul>`;
    const result = parseCandidateIndexHtml(html, now, { maxMatches: 2, maxLiveEventAgeMinutes: 180 });
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.phaseHint)).toEqual(["live", "prematch"]);
    expect(result[0]?.commenceTime).toBe("2026-08-28T09:51:00.000Z");
  });

  it("mac onu 1X2 oranlarini bookmaker bazinda donusturur", () => {
    const snapshot: BetExplorerPageSnapshot = {
      homeTeam: "Crystal Palace",
      awayTeam: "Manchester City",
      leagueName: "England · Premier League",
      live: false,
      liveRows: [],
      prematchRows: [
        {
          bookmaker: "bet365",
          odds: [
            { price: "5.00", position: "1" },
            { price: "3.90", position: "0" },
            { price: "1.67", position: "2" },
          ],
        },
        {
          bookmaker: "Betfair",
          odds: [
            { price: "5.00", position: "1" },
            { price: "4.00", position: "0" },
            { price: "1.67", position: "2" },
          ],
        },
        { bookmaker: "1xBet", odds: [{ price: "5.12", position: "1" }] },
      ],
    };
    const result = parseDetailSnapshot(snapshot, candidate("prematch"), ["bet365", "betfair"], now);
    expect(result).toHaveLength(6);
    expect(result).toContainEqual(
      expect.objectContaining({ bookmakerKey: "betfair", selectionKey: "draw", price: 4, phase: "prematch" }),
    );
  });

  it("canli standart pazarlari ve handikap cizgisini donusturur", () => {
    const rows = [
      { bookmaker: "bet365", market: "1x2", line: null, prices: ["1.73", "4.00", "4.50"] },
      { bookmaker: "bet365", market: "ou", line: "2.5", prices: ["1.73", "2.00"] },
      { bookmaker: "bet365", market: "ah", line: "0.5", prices: ["1.78", "2.03"] },
      { bookmaker: "Betfair Exchange", market: "btts", line: null, prices: ["1.80", "1.90"] },
    ];
    const snapshot: BetExplorerPageSnapshot = {
      homeTeam: "Dalian Yingbo",
      awayTeam: "Beijing Guoan",
      leagueName: "China · Super League",
      live: true,
      prematchRows: [],
      liveRows: rows,
    };
    const result = parseDetailSnapshot(
      snapshot,
      candidate("live"),
      ["bet365", "betfair_ex_eu"],
      now,
    );
    expect(result).toHaveLength(9);
    expect(result).toContainEqual(
      expect.objectContaining({ marketKey: "handicap", selectionKey: "away", line: -0.5, price: 2.03 }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ bookmakerKey: "betfair_exchange", marketKey: "both_teams_to_score" }),
    );
  });

  it("bookmaker adlarini kararli anahtara cevirir", () => {
    expect(canonicalBookmaker("Betfair Exchange")).toBe("betfair_exchange");
    expect(canonicalBookmaker("Stake.com")).toBe("stake_com");
  });
});
