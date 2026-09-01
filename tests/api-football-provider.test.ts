import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFootballProvider } from "../src/providers/api-football-provider.js";

const commonOptions = {
  apiKey: "secret",
  bookmakerKeys: ["bet365"],
  maxFixtures: 2,
  fixtureCacheMinutes: 30,
  prematchCacheMinutes: 120,
  liveCacheMinutes: 3,
  dailyRequestBudget: 80,
  leagueScope: "turkey_europe_top10_big5_tier3" as const,
  maxLiveEventAgeMinutes: 180,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ApiFootballProvider", () => {
  it("gunluk fiksturu bir kez alir ve mac baslamadan odds endpointine gitmez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify({
        errors: [],
        response: [{
          fixture: { id: 101, date: "2026-08-29T18:00:00+00:00", status: { short: "NS" } },
          league: { name: "Premier League", country: "England" },
          teams: { home: { name: "Alpha FC" }, away: { name: "Beta FC" } },
        }],
      }), { status: 200, headers: { "x-ratelimit-requests-remaining": "99" } });
    }));

    const provider = new ApiFootballProvider(commonOptions);
    const first = await provider.fetchQuotes();
    const second = await provider.fetchQuotes();

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(urls.filter((url) => url.includes("/fixtures?date=")).length).toBe(1);
    expect(urls.some((url) => url.endsWith("/odds/live"))).toBe(false);
    expect(provider.getLastFixtures()).toEqual([
      expect.objectContaining({ sourceEventId: "101", phase: "prematch" }),
    ]);
  });

  it("kayitli mac saati gelince tek odds/live batch istegi kullanir ve marketleri normalize eder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T17:40:00.000Z"));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const headers = { "x-ratelimit-requests-remaining": "99", "content-type": "application/json" };
      if (url.includes("/fixtures?date=")) {
        return new Response(JSON.stringify({
          errors: [],
          response: [{
            fixture: { id: 303, date: "2026-08-29T18:00:00+00:00", status: { short: "NS" } },
            league: { name: "Premier League", country: "England" },
            teams: { home: { name: "Alpha FC" }, away: { name: "Beta FC" } },
          }],
        }), { status: 200, headers });
      }
      if (url.endsWith("/odds/live")) {
        return new Response(JSON.stringify({
          errors: [],
          response: [{
            fixture: { id: 303 },
            update: "2026-08-29T18:04:00+00:00",
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
    }));

    const provider = new ApiFootballProvider({ ...commonOptions, maxFixtures: 1 });
    const beforeKickoff = await provider.fetchQuotes();
    expect(beforeKickoff).toEqual([]);
    expect(urls).toHaveLength(1);

    vi.advanceTimersByTime(25 * 60_000);
    const liveQuotes = await provider.fetchQuotes();

    expect(urls.filter((url) => url.includes("/fixtures?date=")).length).toBe(1);
    expect(urls.filter((url) => url.endsWith("/odds/live")).length).toBe(1);
    expect(urls.some((url) => url.includes("/odds/live?fixture="))).toBe(false);
    expect(provider.getLastFixtures()).toEqual([
      expect.objectContaining({ sourceEventId: "303", phase: "live" }),
    ]);
    expect(liveQuotes.some((quote) => quote.marketKey === "match_winner_3way" && quote.selectionKey === "home")).toBe(true);
    expect(liveQuotes.some((quote) => quote.marketKey === "total_goals" && quote.selectionKey === "over" && quote.line === 2.5)).toBe(true);
    expect(liveQuotes.some((quote) => quote.marketKey === "both_teams_to_score" && quote.selectionKey === "yes")).toBe(true);
    expect(liveQuotes.some((quote) => quote.marketKey === "corners" && quote.line === 9.5)).toBe(true);
  });

  it("ayni batch cevabindan birden fazla canli maci tek API istegiyle doldurur", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:30:00.000Z"));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const headers = { "x-ratelimit-requests-remaining": "99", "content-type": "application/json" };
      if (url.includes("/fixtures?date=")) {
        return new Response(JSON.stringify({ errors: [], response: [
          {
            fixture: { id: 202, date: "2026-08-29T18:00:00+00:00", status: { short: "1H" } },
            league: { name: "Premier League", country: "England" },
            teams: { home: { name: "Home A" }, away: { name: "Away A" } },
          },
          {
            fixture: { id: 203, date: "2026-08-29T18:05:00+00:00", status: { short: "1H" } },
            league: { name: "Championship", country: "England" },
            teams: { home: { name: "Home B" }, away: { name: "Away B" } },
          },
        ] }), { status: 200, headers });
      }
      if (url.endsWith("/odds/live")) {
        return new Response(JSON.stringify({ errors: [], response: [
          {
            fixture: { id: 202 }, update: "2026-08-29T18:29:30+00:00",
            bookmakers: [{ name: "Bet365", bets: [{ name: "Match Winner", values: [{ value: "Home", odd: "2.00" }] }] }],
          },
          {
            fixture: { id: 203 }, update: "2026-08-29T18:29:40+00:00",
            bookmakers: [{ name: "Bet365", bets: [{ name: "Match Winner", values: [{ value: "Away", odd: "2.50" }] }] }],
          },
        ] }), { status: 200, headers });
      }
      return new Response("not found", { status: 404 });
    }));

    const provider = new ApiFootballProvider(commonOptions);
    const quotes = await provider.fetchQuotes();

    expect(urls.filter((url) => url.endsWith("/odds/live")).length).toBe(1);
    expect(quotes.some((quote) => quote.sourceEventId === "202" && quote.homeTeam === "Home A")).toBe(true);
    expect(quotes.some((quote) => quote.sourceEventId === "203" && quote.awayTeam === "Away B")).toBe(true);
  });

  it("live odds cache suresinde toplu API cagrisi tekrar edilmez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:30:00.000Z"));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/fixtures?date=")) {
        return new Response(JSON.stringify({ errors: [], response: [{
          fixture: { id: 202, date: "2026-08-29T18:00:00+00:00", status: { short: "1H" } },
          league: { name: "Premier League", country: "England" },
          teams: { home: { name: "Home" }, away: { name: "Away" } },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [], response: [] }), { status: 200 });
    }));

    const provider = new ApiFootballProvider({ ...commonOptions, bookmakerKeys: [], maxFixtures: 1 });
    await provider.fetchQuotes();
    await provider.fetchQuotes();

    expect(urls.filter((url) => url.includes("/fixtures?date=")).length).toBe(1);
    expect(urls.filter((url) => url.endsWith("/odds/live")).length).toBe(1);
  });
});
