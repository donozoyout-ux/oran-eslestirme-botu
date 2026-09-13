import { describe, expect, it } from "vitest";
import { parseMackolikIddaaHtml } from "../src/providers/mackolik-iddaa-provider.js";
import { formatTelegramOddsSnapshot } from "../src/notifiers.js";

describe("MackolikIddaaProvider parser", () => {
  it("Mackolik İddaa bülteni satırından 1X2, çifte şans ve 2.5 alt/üst oranlarını üretir", () => {
    const html = `
      <html><body>
        <h2>13.09.2026</h2>
        <table>
          <tr><td>18:00</td><td>1</td><td>X</td><td>2</td><td>1-X</td><td>1-2</td><td>X-2</td><td>Alt</td><td>Üst</td></tr>
          <tr>
            <td>TSL 3 <a href="/takim/galatasaray">Galatasaray</a> <a href="/takim/fenerbahce">Fenerbahçe</a></td>
            <td>2.10</td><td>3.20</td><td>2.70</td>
            <td>1.22</td><td>1.18</td><td>1.45</td>
            <td>1.65</td><td>1.72</td>
          </tr>
        </table>
      </body></html>`;

    const quotes = parseMackolikIddaaHtml(html, new Date("2026-09-13T12:00:00Z"));

    expect(quotes).toHaveLength(8);
    expect(quotes.every((quote) => quote.provider === "mackolik_iddaa")).toBe(true);
    expect(quotes.every((quote) => quote.bookmakerKey === "iddaa")).toBe(true);
    expect(quotes[0]).toMatchObject({
      homeTeam: "Galatasaray",
      awayTeam: "Fenerbahçe",
      marketKey: "match_winner_3way",
      selectionKey: "home",
      price: 2.1,
    });
    expect(quotes.find((quote) => quote.marketKey === "total_goals" && quote.selectionKey === "over"))
      .toMatchObject({ line: 2.5, price: 1.72 });
  });

  it("Telegram snapshot metninde temel İddaa oranlarını anlaşılır biçimde gösterir", () => {
    const quotes = parseMackolikIddaaHtml(`
      <html><body><h2>13.09.2026</h2><table>
      <tr><td>18:00</td></tr>
      <tr><td>TSL 3 <a>Galatasaray</a> <a>Fenerbahçe</a></td>
      <td>2.10</td><td>3.20</td><td>2.70</td><td>1.22</td><td>1.18</td><td>1.45</td><td>1.65</td><td>1.72</td></tr>
      </table></body></html>`, new Date("2026-09-13T12:00:00Z"));

    const message = formatTelegramOddsSnapshot(quotes);
    expect(message).toContain("İDDAA ORAN GÜNCELLEMESİ");
    expect(message).toContain("MS 1");
    expect(message).toContain("MS X");
    expect(message).toContain("MS 2");
    expect(message).toContain("A/U 2.5 ÜST");
    expect(message).toContain("İddaa (Mackolik)");
  });
});
