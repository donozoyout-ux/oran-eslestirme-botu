import { describe, expect, it } from "vitest";
import type { OddsMatch, OddsQuote } from "../src/domain.js";
import { describeOddsMatch, formatTelegramMessage } from "../src/notifiers.js";

function match(overrides: Partial<OddsQuote> = {}, priceA = 2.6, priceB = 2.62): OddsMatch {
  const quoteA: OddsQuote = {
    provider: "test",
    bookmakerKey: "a",
    bookmakerName: "Kaynak A",
    sourceEventId: "event-1",
    sportKey: "soccer",
    leagueName: "Test Ligi",
    homeTeam: "Ev Takımı",
    awayTeam: "Deplasman Takımı",
    commenceTime: "2026-08-28T18:00:00.000Z",
    phase: "live",
    marketKey: "total_goals",
    marketName: "Toplam Gol",
    period: "full_time",
    selectionKey: "over",
    selectionName: "Ust",
    line: 2.5,
    price: priceA,
    updatedAt: "2026-08-28T17:00:00.000Z",
    ...overrides,
  };
  return {
    id: "alert-1",
    eventKey: "event-key",
    marketSignature: "market-signature",
    phase: quoteA.phase,
    relativeDifferencePercent: 0.77,
    quoteA,
    quoteB: { ...quoteA, bookmakerKey: "b", bookmakerName: "Kaynak B", price: priceB },
    detectedAt: "2026-08-28T17:00:01.000Z",
  };
}

describe("Telegram bildirim metni", () => {
  it("gol cizgisini, secimi ve kazanma anlamini aciklar", () => {
    const message = formatTelegramMessage(match());

    expect(message).toContain("<b>Pazar:</b> Toplam Gol");
    expect(message).toContain("<b>Çizgi:</b> 2.5");
    expect(message).toContain("<b>Seçim:</b> ÜST");
    expect(message).toContain("en az 3 gol olursa kazanır");
    expect(message).toContain("SÜRPRİZ ADAYI");
  });

  it("kart ve korner alt/ust cizgilerini tam sayiya cevirir", () => {
    const cards = match({ marketKey: "cards", marketName: "Cards", selectionKey: "over", line: 5.5 });
    const corners = match({ marketKey: "corners", marketName: "Corners", selectionKey: "under", line: 9.5 });

    expect(describeOddsMatch(cards)).toContain("en az 6 kart");
    expect(describeOddsMatch(cards)).toContain("kart sayım kuralına göre");
    expect(describeOddsMatch(corners)).toContain("en fazla 9 korner");
  });

  it("esik altindaki oranlari surpriz diye etiketlemez", () => {
    const message = formatTelegramMessage(match({}, 2.2, 2.22), 2.5);

    expect(message).toContain("YAKIN ORAN");
    expect(message).not.toContain("SÜRPRİZ ADAYI");
  });
});
