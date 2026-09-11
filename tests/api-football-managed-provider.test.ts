import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchFixture, OddsProvider, OddsQuote } from "../src/domain.js";
import { getProviderDiagnostics, resetProviderDiagnosticsForTests } from "../src/provider-diagnostics.js";
import { ManagedApiFootballProvider } from "../src/providers/api-football-managed-provider.js";

const fixture: MatchFixture = {
  provider: "api_football",
  sourceEventId: "123",
  leagueName: "Premier League",
  homeTeam: "Aston Villa",
  awayTeam: "Arsenal",
  commenceTime: "2026-08-31T22:00:00+03:00",
  phase: "prematch",
};

function stubProvider(fixtures: MatchFixture[], error?: Error): OddsProvider {
  return {
    name: "api_football",
    async fetchQuotes(): Promise<OddsQuote[]> {
      if (error) throw error;
      return [];
    },
    getLastFixtures(): MatchFixture[] {
      return fixtures;
    },
  };
}

describe("ManagedApiFootballProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    resetProviderDiagnosticsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetProviderDiagnosticsForTests();
  });

  it("0 fikstur gelirse kotayi dakikada bir yakmadan 15 dakika sonra temiz instance ile tekrar dener", async () => {
    let factoryCalls = 0;
    const provider = new ManagedApiFootballProvider(() => {
      factoryCalls += 1;
      return factoryCalls === 1 ? stubProvider([]) : stubProvider([fixture]);
    }, { retryMinutes: 15 });

    await provider.fetchQuotes();
    expect(factoryCalls).toBe(1);
    expect(provider.getLastFixtures()).toEqual([]);
    expect(getProviderDiagnostics().api_football).toMatchObject({
      status: "empty_fixture_catalog",
      fixtureCount: 0,
    });

    vi.advanceTimersByTime(60_000);
    await provider.fetchQuotes();
    expect(factoryCalls).toBe(1);
    expect(getProviderDiagnostics().api_football?.status).toBe("retry_wait");

    vi.advanceTimersByTime(14 * 60_000 + 1);
    await provider.fetchQuotes();
    expect(factoryCalls).toBe(2);
    expect(provider.getLastFixtures()).toEqual([fixture]);
    expect(getProviderDiagnostics().api_football).toMatchObject({
      status: "ok",
      fixtureCount: 1,
      lastError: null,
    });
  });

  it("hesap askida hatasinda sistemi dusurmeden diger kaynaklara birakir", async () => {
    let calls = 0;
    const provider = new ManagedApiFootballProvider(
      () => {
        calls += 1;
        return stubProvider([], new Error('API-Football hata döndürdü: {"access":"Your account is suspended"}'));
      },
      { retryMinutes: 15 },
    );

    await expect(provider.fetchQuotes()).resolves.toEqual([]);
    expect(getProviderDiagnostics().api_football).toMatchObject({
      status: "account_suspended",
      fallbackActive: true,
    });

    vi.advanceTimersByTime(30 * 60_000);
    await expect(provider.fetchQuotes()).resolves.toEqual([]);
    expect(calls).toBe(1);
    expect(getProviderDiagnostics().api_football?.status).toBe("provider_blocked");
  });

  it("API hatasini status diagnostics icinde saklar", async () => {
    const provider = new ManagedApiFootballProvider(
      () => stubProvider([], new Error("API-Football 403: invalid key")),
      { retryMinutes: 15 },
    );

    await expect(provider.fetchQuotes()).rejects.toThrow("invalid key");
    expect(getProviderDiagnostics().api_football).toMatchObject({
      status: "fixture_error",
      fixtureCount: 0,
      lastError: "API-Football 403: invalid key",
    });
  });
});
