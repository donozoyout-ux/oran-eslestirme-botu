import { describe, expect, it } from "vitest";
import {
  eventKey,
  findOddsMatches,
  marketSignature,
  normalizeName,
  relativeDifferencePercent,
} from "../src/comparison-engine.js";
import type { OddsQuote } from "../src/domain.js";

const now = new Date("2026-08-27T12:00:00.000Z");

function quote(overrides: Partial<OddsQuote> = {}): OddsQuote {
  return {
    provider: "test",
    bookmakerKey: "book-a",
    bookmakerName: "Book A",
    sourceEventId: "event-1",
    sportKey: "soccer_test",
    leagueName: "Test Ligi",
    homeTeam: "Fenerbahce SK",
    awayTeam: "Galatasaray",
    commenceTime: "2026-08-28T12:00:00.000Z",
    phase: "prematch",
    marketKey: "total_goals",
    marketName: "Toplam Gol",
    period: "full_time",
    selectionKey: "over",
    selectionName: "Ust",
    line: 2.5,
    price: 2.1,
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("comparison engine", () => {
  it("Turkce karakterleri ve kulup son ekini normalize eder", () => {
    expect(normalizeName("İstanbul Başakşehir FK")).toBe("istanbul basaksehir");
  });

  it("goreli farki simetrik hesaplar", () => {
    expect(relativeDifferencePercent(2.1, 2.14)).toBeCloseTo(1.88679, 4);
    expect(relativeDifferencePercent(2.14, 2.1)).toBeCloseTo(1.88679, 4);
  });

  it("yuzde 2 icindeki ayni pazar ve cizgiyi eslestirir", () => {
    const result = findOddsMatches(
      [quote(), quote({ bookmakerKey: "book-b", bookmakerName: "Book B", price: 2.14 })],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300 },
      now,
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.relativeDifferencePercent).toBeLessThanOrEqual(2);
  });

  it("uc veya daha fazla kaynakta en yakin cifti tek bildirim olarak secer", () => {
    const result = findOddsMatches(
      [
        quote({ bookmakerKey: "book-a", price: 2.1 }),
        quote({ bookmakerKey: "book-b", price: 2.12 }),
        quote({ bookmakerKey: "book-c", price: 2.13 }),
      ],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300 },
      now,
    );
    expect(result.matches).toHaveLength(1);
    expect([result.matches[0]?.quoteA.price, result.matches[0]?.quoteB.price].sort()).toEqual([2.12, 2.13]);
  });

  it("farkli Alt/Ust cizgilerini eslestirmez", () => {
    const result = findOddsMatches(
      [quote({ line: 2.5 }), quote({ bookmakerKey: "book-b", line: 3.5, price: 2.11 })],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300 },
      now,
    );
    expect(result.matches).toHaveLength(0);
  });

  it("canli ve mac onu oranlarini birbirine karistirmaz", () => {
    const result = findOddsMatches(
      [quote(), quote({ bookmakerKey: "book-b", phase: "live", price: 2.11 })],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300 },
      now,
    );
    expect(result.matches).toHaveLength(0);
  });

  it("bayat oranlari dislar", () => {
    const stale = "2026-08-27T11:40:00.000Z";
    const result = findOddsMatches(
      [quote({ updatedAt: stale }), quote({ bookmakerKey: "book-b", price: 2.11, updatedAt: stale })],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300 },
      now,
    );
    expect(result.freshQuotes).toHaveLength(0);
    expect(result.matches).toHaveLength(0);
  });

  it("ayni bookmaker icindeki tekrar kayitlari karsilastirmaz", () => {
    const result = findOddsMatches(
      [quote({ price: 2.1 }), quote({ price: 2.11, updatedAt: "2026-08-27T12:00:01.000Z" })],
      { tolerancePercent: 2, maxQuoteAgeSeconds: 300 },
      now,
    );
    expect(result.matches).toHaveLength(0);
  });

  it("olay ve pazar anahtarlarini kararli uretir", () => {
    expect(eventKey(quote())).toBe(eventKey(quote({ homeTeam: "Fenerbahçe" })));
    expect(marketSignature(quote())).not.toBe(marketSignature(quote({ line: 3.5 })));
  });
});
