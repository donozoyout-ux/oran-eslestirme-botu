import { describe, expect, it } from "vitest";
import { CanonicalMatchResolver } from "../src/canonical-match-resolver.js";
import { eventKey, findOddsMatches } from "../src/comparison-engine.js";
import type { OddsQuote } from "../src/domain.js";

const now = new Date("2026-09-07T12:00:00.000Z");

function quote(overrides: Partial<OddsQuote>): OddsQuote {
  return {
    provider: "sportmonks",
    bookmakerKey: "a",
    bookmakerName: "A",
    sourceEventId: "sm-100",
    sportKey: "soccer",
    leagueName: "Premier League",
    homeTeam: "Manchester United",
    awayTeam: "İstanbul Başakşehir FK",
    commenceTime: "2026-09-07T18:00:00.000Z",
    phase: "prematch",
    marketKey: "total_goals",
    marketName: "Total Goals",
    period: "full_time",
    selectionKey: "over",
    selectionName: "Over",
    line: 2.5,
    price: 2.1,
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("CanonicalMatchResolver", () => {
  it("provider ID'leri farkli olsa da alias, Turkce karakter ve kickoff toleransi ile ayni maci birlestirir", () => {
    const resolver = new CanonicalMatchResolver({ kickoffToleranceMinutes: 10 });
    const result = findOddsMatches(
      [
        quote({}),
        quote({
          provider: "api_football",
          bookmakerKey: "b",
          bookmakerName: "B",
          sourceEventId: "api-999",
          leagueName: "England Premier League",
          homeTeam: "Man Utd",
          awayTeam: "Istanbul Basaksehir",
          commenceTime: "2026-09-07T18:07:00.000Z",
          price: 2.12,
        }),
      ],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300, canonicalMatchResolver: resolver },
      now,
    );

    expect(result.matches).toHaveLength(1);
    expect(eventKey(result.freshQuotes[0]!)).toBe(eventKey(result.freshQuotes[1]!));
  });

  it("tolerans disindaki veya farkli ligdeki maclari birlestirmez", () => {
    const resolver = new CanonicalMatchResolver({ kickoffToleranceMinutes: 5 });
    const resolved = resolver.resolveQuotes([
      quote({}),
      quote({ provider: "api_football", sourceEventId: "2", commenceTime: "2026-09-07T18:06:00.000Z" }),
      quote({ provider: "betexplorer", sourceEventId: "3", leagueName: "Championship" }),
    ]);

    expect(resolved[0]!.canonicalEventId).not.toBe(resolved[1]!.canonicalEventId);
    expect(resolved[0]!.canonicalEventId).not.toBe(resolved[2]!.canonicalEventId);
  });

  it("ayni provider event ID'sini saat duzeltmelerinde kararlı tutar", () => {
    const resolver = new CanonicalMatchResolver({ kickoffToleranceMinutes: 2 });
    const first = resolver.resolveQuotes([quote({})])[0]!;
    const corrected = resolver.resolveQuotes([
      quote({ commenceTime: "2026-09-07T18:15:00.000Z", homeTeam: "Man United" }),
    ])[0]!;
    expect(corrected.canonicalEventId).toBe(first.canonicalEventId);
  });

  it("BetExplorer ulke breadcrumb lig adini provider lig adiyla esler", () => {
    const resolver = new CanonicalMatchResolver();
    const resolved = resolver.resolveQuotes([
      quote({ leagueName: "La Liga", homeTeam: "Real Madrid CF", awayTeam: "Barcelona FC" }),
      quote({
        provider: "betexplorer_scraper",
        sourceEventId: "be-1",
        leagueName: "Spain · LaLiga",
        homeTeam: "Real Madrid",
        awayTeam: "Barcelona",
        commenceTime: "2026-09-07T18:04:00.000Z",
      }),
    ]);
    expect(resolved[0]!.canonicalEventId).toBe(resolved[1]!.canonicalEventId);
  });
});
