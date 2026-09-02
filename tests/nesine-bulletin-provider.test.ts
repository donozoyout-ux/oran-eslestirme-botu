import { describe, expect, it } from "vitest";
import { parseNesineBulletin } from "../src/providers/nesine-bulletin-provider.js";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const KICKOFF = NOW.getTime() + 2 * 60 * 60_000;

function payload(leagueName = "Premier League") {
  return {
    sg: {
      LA: [{ LID: 87, N: leagueName }],
      EA: [{
        C: 12345,
        GT: 1,
        LC: 87,
        HN: "Hull City",
        AN: "Swansea City",
        ESD: KICKOFF,
        MA: [
          { MTID: 1, OCA: [{ N: 1, O: 2.1 }, { N: 2, O: 3.2 }, { N: 3, O: 3.45 }] },
          { MTID: 3, OCA: [{ N: 1, O: 1.3 }, { N: 2, O: 1.35 }, { N: 3, O: 1.55 }] },
          { MTID: 12, SOV: 2.5, OCA: [{ N: 1, O: 1.8 }, { N: 2, O: 1.95 }] },
          { MTID: 38, OCA: [{ N: 1, O: 1.72 }, { N: 2, O: 2.0 }] },
        ],
      }],
    },
  };
}

describe("Nesine bulletin provider", () => {
  it("1X2, cifte sans, 2.5 alt/ust ve KG oranlarini normalize eder", () => {
    const result = parseNesineBulletin(payload(), NOW, "all");

    expect(result.fixtures).toHaveLength(1);
    expect(result.quotes).toHaveLength(10);
    expect(result.quotes.every((quote) => quote.provider === "nesine_bulletin")).toBe(true);
    expect(result.quotes.every((quote) => quote.bookmakerKey === "nesine_iddaa")).toBe(true);

    expect(result.quotes).toContainEqual(expect.objectContaining({
      marketKey: "match_winner_3way",
      selectionKey: "home",
      price: 2.1,
    }));
    expect(result.quotes).toContainEqual(expect.objectContaining({
      marketKey: "total_goals",
      selectionKey: "over",
      line: 2.5,
      price: 1.95,
    }));
    expect(result.quotes).toContainEqual(expect.objectContaining({
      marketKey: "both_teams_to_score",
      selectionKey: "yes",
      price: 1.72,
    }));
  });

  it("1.00/1.01 kilitli fiyatlari ve kapsam disi ligleri aday yapmaz", () => {
    const locked = payload();
    locked.sg.EA[0]!.MA[0]!.OCA[0]!.O = 1.0;
    locked.sg.EA[0]!.MA[0]!.OCA[1]!.O = 1.01;
    const parsed = parseNesineBulletin(locked, NOW, "all");
    expect(parsed.quotes.some((quote) => quote.marketKey === "match_winner_3way" && quote.selectionKey === "home")).toBe(false);
    expect(parsed.quotes.some((quote) => quote.marketKey === "match_winner_3way" && quote.selectionKey === "draw")).toBe(false);

    const outOfScope = parseNesineBulletin(payload("UEFA Champions League"), NOW, "turkey_europe_top10_big5_tier3");
    expect(outOfScope.quotes).toHaveLength(0);
    expect(outOfScope.fixtures).toHaveLength(0);
  });

  it("baslamis maci prematch bulteninden tekrar sisteme sokmaz", () => {
    const ended = payload();
    ended.sg.EA[0]!.ESD = NOW.getTime() - 60_000;
    const result = parseNesineBulletin(ended, NOW, "all");
    expect(result.quotes).toHaveLength(0);
    expect(result.fixtures).toHaveLength(0);
  });
});
