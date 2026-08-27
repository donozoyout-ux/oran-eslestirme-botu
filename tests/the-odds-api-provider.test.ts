import { afterEach, describe, expect, it, vi } from "vitest";
import { TheOddsApiProvider } from "../src/providers/the-odds-api-provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("TheOddsApiProvider", () => {
  it("API pazarlarini kanonik formata donusturur", async () => {
    const payload = [
      {
        id: "evt-1",
        sport_key: "soccer_epl",
        sport_title: "EPL",
        commence_time: new Date(Date.now() + 3_600_000).toISOString(),
        home_team: "Arsenal",
        away_team: "Chelsea",
        bookmakers: [
          {
            key: "pinnacle",
            title: "Pinnacle",
            last_update: new Date().toISOString(),
            markets: [
              {
                key: "totals",
                outcomes: [
                  { name: "Over", price: 1.95, point: 2.5 },
                  { name: "Under", price: 1.9, point: 2.5 },
                ],
              },
            ],
          },
        ],
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TheOddsApiProvider({
      apiKey: "secret-test-key",
      sportKeys: ["soccer_epl"],
      bookmakerKeys: ["pinnacle"],
      regions: ["eu"],
      maxLiveEventAgeMinutes: 180,
    });
    const quotes = await provider.fetchQuotes();

    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      bookmakerKey: "pinnacle",
      marketKey: "total_goals",
      selectionKey: "over",
      line: 2.5,
      price: 1.95,
      phase: "prematch",
    });
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("bookmakers=pinnacle");
    expect(requestedUrl).toContain("markets=h2h%2Cspreads%2Ctotals");
    expect(requestedUrl).toContain("apiKey=secret-test-key");
  });
});
