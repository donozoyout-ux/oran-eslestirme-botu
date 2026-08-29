import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFootballProvider } from "../src/providers/api-football-provider.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ApiFootballProvider", () => {
  it("fixture ve genis odds marketlerini normalize eder, cache ile kotayi korur", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const headers = { "x-ratelimit-requests-remaining": "99", "content-type": "application/json" };
      if (url.includes("/fixtures?")) {
        return new Response(JSON.stringify({
          errors: [],
          response: [{
            fixture: { id: 101, date: "2026-08-29T18:00:00+00:00", status: { short: "NS" } },
            league: { name: "Premier League" },
            teams: { home: { name: "Alpha FC" }, away: { name: "Beta FC" } },
          }],
        }), { status: 200, headers });
      }
      if (url.includes("/odds?fixture=101")) {
        return new Response(JSON.stringify({
          errors: [],
          response: [{
            fixture: { id: 101 },
            update: "2026-08-29T11:55:00+00:00",
            bookmakers: [{
              name: "Bet365",
              bets: [
                { name: "Match Winner", values: [{ value: "Home", odd: "2.10" }, { value: "Draw", odd: "3.20" }, { value: "Away", odd: "3.60" }] },
                { name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.95" }, { value: "Under 2.5", odd: "1.85" }] },
                { name: "Both Teams To Score", values: [{ value: "Yes", odd: "1.80" }, { value: "No", odd: "1.95" }] },
                { name: "Total Corners", values: [{ value: "Over 9.5", odd: "1.90" }, { value: "Under 9.5", odd: "1.90" }] },
              ],
            }],
          }],
        }), { status: 200, headers });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ApiFootballProvider({
      apiKey: "secret",
      bookmakerKeys: ["bet365"],
      maxFixtures: 2,
      fixtureCacheMinutes: 30,
      prematchCacheMinutes: 120,
      liveCacheMinutes: 10,
      dailyRequestBudget: 80,
    });

    const first = await provider.fetchQuotes();
    const second = await provider.fetchQuotes();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
    expect(provider.getLastFixtures()).toHaveLength(1);
    expect(first.some((quote) => quote.marketKey === "match_winner_3way" && quote.selectionKey === "home")).toBe(true);
    expect(first.some((quote) => quote.marketKey === "total_goals" && quote.selectionKey === "over" && quote.line === 2.5)).toBe(true);
    expect(first.some((quote) => quote.marketKey === "both_teams_to_score" && quote.selectionKey === "yes")).toBe(true);
    expect(first.some((quote) => quote.marketKey === "corners" && quote.line === 9.5)).toBe(true);
  });

  it("canli mac icin odds/live endpointini kullanir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:30:00.000Z"));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/fixtures?")) {
        return new Response(JSON.stringify({ errors: [], response: [{
          fixture: { id: 202, date: "2026-08-29T18:00:00+00:00", status: { short: "1H" } },
          league: { name: "Test League" },
          teams: { home: { name: "Home" }, away: { name: "Away" } },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [], response: [] }), { status: 200 });
    }));

    const provider = new ApiFootballProvider({
      apiKey: "secret",
      bookmakerKeys: [],
      maxFixtures: 1,
      fixtureCacheMinutes: 30,
      prematchCacheMinutes: 120,
      liveCacheMinutes: 10,
      dailyRequestBudget: 80,
    });
    await provider.fetchQuotes();
    expect(urls.some((url) => url.includes("/odds/live?fixture=202"))).toBe(true);
  });
});
