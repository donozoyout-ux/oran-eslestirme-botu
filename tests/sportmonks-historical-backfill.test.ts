import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { MatchFixture, OddsQuote } from "../src/domain.js";
import { MemoryHistoricalOddsRepository } from "../src/historical-odds-repository.js";
import { getProviderDiagnostics } from "../src/provider-diagnostics.js";
import type { SportmonksProvider } from "../src/providers/sportmonks-provider.js";
import { SportmonksHistoricalBackfill } from "../src/sportmonks-historical-backfill.js";

const NOW = new Date("2026-09-30T12:00:00.000Z");

function fixtureForDate(date: string): MatchFixture {
  return {
    provider: "sportmonks",
    sourceEventId: `sm-${date}`,
    leagueName: "Premier League",
    homeTeam: "Manchester United",
    awayTeam: "Arsenal",
    commenceTime: `${date}T18:00:00.000Z`,
    phase: "prematch",
    resultStatus: "finished",
    homeScore: 2,
    awayScore: 1,
  };
}

function historicalQuote(fixture: MatchFixture): OddsQuote {
  return {
    provider: "sportmonks",
    bookmakerKey: "pinnacle",
    bookmakerName: "Pinnacle",
    sourceEventId: fixture.sourceEventId,
    sportKey: "soccer",
    leagueName: fixture.leagueName,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    commenceTime: fixture.commenceTime,
    phase: "prematch",
    marketKey: "handicap",
    marketName: "Asian Handicap",
    period: "full_time",
    selectionKey: "home",
    selectionName: fixture.homeTeam,
    line: -0.5,
    price: 1.91,
    updatedAt: new Date(Date.parse(fixture.commenceTime) - 60 * 60_000).toISOString(),
  };
}

function dayResponse(date: string) {
  return {
    fixtures: [fixtureForDate(date)],
    rawFixturesFetched: 1,
    fixturesRejectedByLeagueScope: 0,
    fixturesAccepted: 1,
    oddsHistoryCapability: "odds_history_unavailable" as const,
  };
}

describe("SportmonksHistoricalBackfill production davranisi", () => {
  it("7 gun sonrasi 30 guna genisletince daha eski 23 gunu gercekten isler", async () => {
    const fetchedDates: string[] = [];
    const provider = {
      fetchHistoricalDay: async (date: string) => { fetchedDates.push(date); return dayResponse(date); },
    } as unknown as SportmonksProvider;
    const repository = new MemoryHistoricalOddsRepository();
    const backfill = new SportmonksHistoricalBackfill(provider, repository);

    const first = await backfill.run(7, NOW);
    const second = await backfill.run(30, NOW);

    expect(first).toMatchObject({ requestedDays: 7, daysRequested: 7, daysFetched: 7, daysSkippedByCheckpoint: 0 });
    expect(second).toMatchObject({ requestedDays: 30, daysRequested: 30, daysFetched: 23, daysSkippedByCheckpoint: 7 });
    expect(new Set(fetchedDates).size).toBe(30);
    expect((await repository.getStats()).completedFixtures).toBe(30);
  });

  it("legacy tek tarih checkpoint'i range formatina tasir ve 30 gunluk eski araligi kaybetmez", async () => {
    const fetchedDates: string[] = [];
    const provider = {
      fetchHistoricalDay: async (date: string) => { fetchedDates.push(date); return dayResponse(date); },
    } as unknown as SportmonksProvider;
    const repository = new MemoryHistoricalOddsRepository();
    const backfill = new SportmonksHistoricalBackfill(provider, repository);

    await backfill.run(7, NOW);
    await repository.saveIngestionCheckpoint("sportmonks-recent", "2026-09-29");
    fetchedDates.length = 0;

    const expanded = await backfill.run(30, NOW);
    const olderExtension = Array.from({ length: 23 }, (_, index) =>
      new Date(NOW.getTime() - (30 - index) * 86_400_000).toISOString().slice(0, 10));
    expect(expanded).toMatchObject({
      requestedDays: 30,
      daysRequested: 30,
      daysSkippedByCheckpoint: 1,
      daysFetched: 29,
      resultsStored: 23,
    });
    expect(olderExtension.every((date) => fetchedDates.includes(date))).toBe(true);
    expect((await repository.getStats()).completedFixtures).toBe(30);

    const normalized = JSON.parse((await repository.getIngestionCheckpoint("sportmonks-recent"))!) as {
      version: number;
      ranges: Array<{ start: string; end: string }>;
    };
    expect(normalized).toEqual({ version: 1, ranges: [{ start: "2026-08-31", end: "2026-09-29" }] });
    expect(await backfill.run(30, NOW)).toMatchObject({ daysFetched: 0, daysSkippedByCheckpoint: 30 });
  });

  it("checkpoint normal tekrari atlar ve duplicate event olusturmaz", async () => {
    let calls = 0;
    const provider = { fetchHistoricalDay: async (date: string) => { calls += 1; return dayResponse(date); } } as unknown as SportmonksProvider;
    const repository = new MemoryHistoricalOddsRepository();
    const backfill = new SportmonksHistoricalBackfill(provider, repository);
    await backfill.run(1, NOW);
    const repeated = await backfill.run(1, NOW);
    expect(repeated).toMatchObject({ daysFetched: 0, daysSkippedByCheckpoint: 1, resultsStored: 0 });
    expect(calls).toBe(1);
    expect((await repository.getStats()).completedFixtures).toBe(1);
  });

  it("recheck API'yi yeniden sorgular fakat event ve odds snapshot duplicate etmez", async () => {
    let calls = 0;
    const provider = {
      fetchHistoricalDay: async (date: string) => { calls += 1; return dayResponse(date); },
      fetchHistoricalOdds: async (fixtures: MatchFixture[]) => ({ capability: "available" as const, quotes: fixtures.map(historicalQuote) }),
    } as unknown as SportmonksProvider;
    const repository = new MemoryHistoricalOddsRepository();
    const backfill = new SportmonksHistoricalBackfill(provider, repository);
    const first = await backfill.run(1, NOW);
    const repeated = await backfill.run(1, NOW, { recheck: true });
    expect(first.oddsSnapshotsStored).toBe(3);
    expect(repeated).toMatchObject({ daysFetched: 1, daysSkippedByCheckpoint: 0, resultsStored: 0, oddsSnapshotsStored: 0 });
    expect(calls).toBe(2);
    expect(await repository.getStats()).toMatchObject({ completedFixtures: 1, oddsSnapshots: 3 });
  });

  it("raw fixture var ama scope sonrasi sifirsa diagnostics bunu ayri gosterir", async () => {
    const provider = { fetchHistoricalDay: async () => ({ fixtures: [], rawFixturesFetched: 4,
      fixturesRejectedByLeagueScope: 4, fixturesAccepted: 0, oddsHistoryCapability: "odds_history_unavailable" as const }) } as unknown as SportmonksProvider;
    const result = await new SportmonksHistoricalBackfill(provider, new MemoryHistoricalOddsRepository()).run(1, NOW);
    expect(result).toMatchObject({ rawFixturesFetched: 4, fixturesRejectedByLeagueScope: 4,
      fixturesAccepted: 0, finishedFixtures: 0, resultsStored: 0, storageType: "memory" });
    expect(getProviderDiagnostics().sportmonks_historical).toMatchObject({
      rawFixturesFetched: 4, fixturesRejectedByLeagueScope: 4, fixturesAccepted: 0,
    });
  });

  it("production npm scriptleri tsx yerine derlenmis node entrypointlerini kullanir", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    for (const name of ["historical:backfill", "historical:import-existing", "db:migrate"]) {
      expect(pkg.scripts[name]).toMatch(/^node dist\/scripts\/.+\.js$/);
      expect(pkg.scripts[name]).not.toContain("tsx");
    }
  });

  it("database diagnostics connection string yerine yalniz configured durumunu raporlar", async () => {
    const databaseUrl = "postgres://secret-user:secret-password@private-host/history";
    const provider = { fetchHistoricalDay: async (date: string) => dayResponse(date) } as unknown as SportmonksProvider;
    const result = await new SportmonksHistoricalBackfill(provider, new MemoryHistoricalOddsRepository(), {
      historicalLeagueScope: "all",
      databaseConfigured: Boolean(databaseUrl),
      storageRequested: "postgres",
    }).run(1, NOW);
    const diagnostic = getProviderDiagnostics().sportmonks_historical;
    const serialized = JSON.stringify({ result, diagnostic });

    expect(result).toMatchObject({
      historicalLeagueScope: "all",
      databaseConfigured: true,
      storageRequested: "postgres",
    });
    expect(diagnostic).toMatchObject({
      historicalLeagueScope: "all",
      databaseConfigured: true,
      storageRequested: "postgres",
    });
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain("secret-password");
  });
});
