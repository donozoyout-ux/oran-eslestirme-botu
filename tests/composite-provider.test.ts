import { describe, expect, it } from "vitest";
import type { OddsProvider, OddsQuote } from "../src/domain.js";
import { CompositeOddsProvider } from "../src/providers/composite-provider.js";

function quote(provider: string): OddsQuote {
  return {
    provider,
    bookmakerKey: provider,
    bookmakerName: provider,
    sourceEventId: `${provider}-event`,
    sportKey: "soccer_epl",
    leagueName: "Premier League",
    homeTeam: "A",
    awayTeam: "B",
    commenceTime: "2026-08-29T18:00:00.000Z",
    phase: "prematch",
    marketKey: "match_winner_3way",
    marketName: "Mac Sonucu",
    period: "full_time",
    selectionKey: "home",
    selectionName: "Ev Sahibi",
    line: null,
    price: 2,
    updatedAt: "2026-08-29T12:00:00.000Z",
  };
}

describe("birlestirilmis oran saglayicisi", () => {
  it("bir kaynak hata verdiginde diger kaynaktan gelen oranlarla devam eder", async () => {
    const healthy: OddsProvider = {
      name: "healthy",
      async fetchQuotes() {
        return [quote("healthy")];
      },
    };
    const unavailable: OddsProvider = {
      name: "unavailable",
      async fetchQuotes() {
        throw new Error("gecici hata");
      },
    };
    const provider = new CompositeOddsProvider([healthy, unavailable]);

    await expect(provider.fetchQuotes()).resolves.toEqual([quote("healthy")]);
    expect(provider.name).toBe("healthy+unavailable");
  });

  it("en az bir kaynak cevap verdiyse sifir orani normal tur kabul eder", async () => {
    const empty: OddsProvider = {
      name: "empty",
      async fetchQuotes() {
        return [];
      },
    };
    const unavailable: OddsProvider = {
      name: "unavailable",
      async fetchQuotes() {
        throw new Error("gecici hata");
      },
    };
    const provider = new CompositeOddsProvider([empty, unavailable]);

    await expect(provider.fetchQuotes()).resolves.toEqual([]);
  });

  it("butun kaynaklar gercekten hata verdiginde hata dondurur", async () => {
    const first: OddsProvider = {
      name: "first",
      async fetchQuotes() {
        throw new Error("ilk hata");
      },
    };
    const second: OddsProvider = {
      name: "second",
      async fetchQuotes() {
        throw new Error("ikinci hata");
      },
    };
    const provider = new CompositeOddsProvider([first, second]);

    await expect(provider.fetchQuotes()).rejects.toThrow("Tum oran kaynaklari basarisiz");
  });
});
