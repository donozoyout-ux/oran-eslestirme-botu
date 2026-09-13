import { describe, expect, it } from "vitest";
import { parseMackolikLegacyPayload, parseMackolikProgramPayload } from "../src/providers/mackolik-iddaa-provider.js";
import { formatTelegramOddsSnapshot } from "../src/notifiers.js";

function sampleRow(): string[] {
  const row = Array.from({ length: 48 }, () => "");
  row[0] = "500";
  row[1] = "Galatasaray";
  row[3] = "Fenerbahçe";
  row[6] = "18:00";
  row[7] = "13.09.2026";
  row[10] = "12345";
  row[13] = "3";
  row[16] = "2.10";
  row[17] = "3.20";
  row[18] = "2.70";
  row[19] = "1.22";
  row[20] = "1.18";
  row[21] = "1.45";
  row[22] = "1.65";
  row[23] = "1.72";
  row[26] = "Türkiye Süper Lig";
  return row;
}

describe("MackolikIddaaProvider parser", () => {
  it("legacy Mackolik object-literal payload formatini guvenli JSON'a cevirir", () => {
    const parsed = parseMackolikLegacyPayload("{m:[{d:'13.09.2026',m:[]}]}");
    expect(parsed).toEqual({ m: [{ d: "13.09.2026", m: [] }] });
  });

  it("Mackolik arsiv akimindan 1X2, çifte şans ve 2.5 alt/üst oranlarını üretir", () => {
    const payload = JSON.stringify({ m: [{ d: "13.09.2026", m: [sampleRow()] }] });
    const quotes = parseMackolikProgramPayload(payload, new Date("2026-09-13T12:00:00Z"));

    expect(quotes).toHaveLength(8);
    expect(quotes.every((quote) => quote.provider === "mackolik_iddaa")).toBe(true);
    expect(quotes.every((quote) => quote.bookmakerKey === "iddaa")).toBe(true);
    expect(quotes[0]).toMatchObject({
      sourceEventId: "500",
      homeTeam: "Galatasaray",
      awayTeam: "Fenerbahçe",
      leagueName: "Türkiye Süper Lig",
      marketKey: "match_winner_3way",
      selectionKey: "home",
      price: 2.1,
    });
    expect(quotes.find((quote) => quote.marketKey === "total_goals" && quote.selectionKey === "over"))
      .toMatchObject({ line: 2.5, price: 1.72 });
  });

  it("Telegram snapshot metninde temel İddaa oranlarını anlaşılır biçimde gösterir", () => {
    const payload = JSON.stringify({ m: [{ d: "13.09.2026", m: [sampleRow()] }] });
    const quotes = parseMackolikProgramPayload(payload, new Date("2026-09-13T12:00:00Z"));

    const message = formatTelegramOddsSnapshot(quotes);
    expect(message).toContain("İDDAA ORAN GÜNCELLEMESİ");
    expect(message).toContain("MS 1");
    expect(message).toContain("MS X");
    expect(message).toContain("MS 2");
    expect(message).toContain("A/U 2.5 ÜST");
    expect(message).toContain("İddaa (Mackolik)");
  });
});
