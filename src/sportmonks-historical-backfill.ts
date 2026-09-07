import { CanonicalMatchResolver } from "./canonical-match-resolver.js";
import { selectClosingSnapshots } from "./closing-odds.js";
import type { MatchFixture } from "./domain.js";
import { historicalSnapshotId } from "./historical-odds-archive.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "./historical-odds.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";
import { DEFAULT_LEAGUE_SCOPE, type LeagueScope } from "./league-scope.js";
import { setProviderDiagnostic } from "./provider-diagnostics.js";
import type { SportmonksProvider } from "./providers/sportmonks-provider.js";

interface CheckpointRange { start: string; end: string }
interface RangeCheckpoint { version: 1; ranges: CheckpointRange[] }
export interface BackfillOptions { recheck?: boolean }
export interface BackfillDiagnostics {
  historicalLeagueScope: LeagueScope;
  databaseConfigured: boolean;
  storageRequested: "auto" | "postgres" | "json";
}

export interface BackfillResult {
  requestedDays: number;
  daysRequested: number;
  daysSkippedByCheckpoint: number;
  daysFetched: number;
  rawFixturesFetched: number;
  fixturesRejectedByLeagueScope: number;
  fixturesAccepted: number;
  finishedFixtures: number;
  resultsStored: number;
  oddsSnapshotsStored: number;
  oddsHistoryCapability: "available" | "odds_history_unavailable";
  storageType: "memory" | "json" | "postgres";
  historicalLeagueScope: LeagueScope;
  databaseConfigured: boolean;
  storageRequested: "auto" | "postgres" | "json";
}

function nextDay(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

function parseCheckpoint(value: string | null): CheckpointRange[] {
  if (!value) return [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return [{ start: value, end: value }];
  try {
    const parsed = JSON.parse(value) as Partial<RangeCheckpoint>;
    if (parsed.version !== 1 || !Array.isArray(parsed.ranges)) return [];
    return parsed.ranges.filter((range) =>
      /^\d{4}-\d{2}-\d{2}$/.test(range.start)
      && /^\d{4}-\d{2}-\d{2}$/.test(range.end)
      && range.start <= range.end,
    );
  } catch { return []; }
}

function includesDate(ranges: CheckpointRange[], date: string): boolean {
  return ranges.some((range) => range.start <= date && date <= range.end);
}

function addDate(ranges: CheckpointRange[], date: string): CheckpointRange[] {
  const ordered = [...ranges, { start: date, end: date }].sort((a, b) => a.start.localeCompare(b.start));
  const merged: CheckpointRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.start > nextDay(previous.end)) merged.push({ ...range });
    else if (range.end > previous.end) previous.end = range.end;
  }
  return merged;
}

function toStoredFixture(row: HistoricalCompletedFixture): MatchFixture {
  const reference = row.providerEventIds.find((candidate) => candidate.provider === "sportmonks") ?? row.providerEventIds[0];
  return {
    provider: reference?.provider ?? "historical",
    sourceEventId: reference?.eventId ?? row.canonicalEventId,
    canonicalEventId: row.canonicalEventId,
    leagueName: row.league,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    commenceTime: row.kickoff,
    phase: "prematch",
    resultStatus: row.fixtureResult,
    ...(row.homeScore === undefined ? {} : { homeScore: row.homeScore }),
    ...(row.awayScore === undefined ? {} : { awayScore: row.awayScore }),
  };
}

export class SportmonksHistoricalBackfill {
  private readonly resolver = new CanonicalMatchResolver();

  constructor(
    private readonly provider: SportmonksProvider,
    private readonly repository: HistoricalOddsRepository,
    private readonly diagnostics: BackfillDiagnostics = {
      historicalLeagueScope: DEFAULT_LEAGUE_SCOPE,
      databaseConfigured: false,
      storageRequested: "auto",
    },
  ) {}

  async run(days = 7, now = new Date(), options: BackfillOptions = {}): Promise<BackfillResult> {
    const requestedDays = Number.isFinite(days) ? Math.floor(days) : 7;
    const daysRequested = Math.max(1, Math.min(30, requestedDays));
    let ranges = parseCheckpoint(await this.repository.getIngestionCheckpoint("sportmonks-recent"));
    let daysSkippedByCheckpoint = 0;
    let daysFetched = 0;
    let rawFixturesFetched = 0;
    let fixturesRejectedByLeagueScope = 0;
    let fixturesAccepted = 0;
    let finishedFixtures = 0;
    let resultsStored = 0;
    const allFixtures: MatchFixture[] = [];
    const completed: HistoricalCompletedFixture[] = [];

    for (let offset = daysRequested; offset >= 1; offset -= 1) {
      const date = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
      if (!options.recheck && includesDate(ranges, date)) {
        daysSkippedByCheckpoint += 1;
        continue;
      }
      const day = await this.provider.fetchHistoricalDay(date);
      daysFetched += 1;
      rawFixturesFetched += day.rawFixturesFetched ?? day.fixtures.length;
      fixturesRejectedByLeagueScope += day.fixturesRejectedByLeagueScope ?? 0;
      fixturesAccepted += day.fixturesAccepted ?? day.fixtures.length;

      for (const fixture of this.resolver.resolveFixtures(day.fixtures)) {
        allFixtures.push(fixture);
        if (fixture.resultStatus !== "finished" && fixture.resultStatus !== "cancelled") continue;
        if (fixture.resultStatus === "finished") finishedFixtures += 1;
        const historicalFixture: HistoricalCompletedFixture = {
          canonicalEventId: fixture.canonicalEventId!,
          providerEventIds: [{ provider: fixture.provider, eventId: fixture.sourceEventId }],
          league: fixture.leagueName,
          normalizedLeagueKey: this.resolver.normalizeLeague(fixture.leagueName),
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          kickoff: fixture.commenceTime,
          fixtureResult: fixture.resultStatus,
          ...(fixture.homeScore === undefined ? {} : { homeScore: fixture.homeScore }),
          ...(fixture.awayScore === undefined ? {} : { awayScore: fixture.awayScore }),
          ...(fixture.halftimeHomeScore === undefined ? {} : { halftimeHomeScore: fixture.halftimeHomeScore }),
          ...(fixture.halftimeAwayScore === undefined ? {} : { halftimeAwayScore: fixture.halftimeAwayScore }),
          archivedAt: now.toISOString(),
        };
        const existing = await this.repository.getByCanonicalEvent(historicalFixture.canonicalEventId);
        const alreadyHasFinalResult = existing.fixture?.fixtureResult === "finished"
          && existing.fixture.homeScore !== undefined
          && existing.fixture.awayScore !== undefined;
        const storesNewResult = historicalFixture.fixtureResult === "finished"
          && historicalFixture.homeScore !== undefined
          && historicalFixture.awayScore !== undefined
          && !alreadyHasFinalResult;
        await this.repository.saveCompletedFixture(historicalFixture);
        if (storesNewResult) resultsStored += 1;
        completed.push(historicalFixture);
      }
      ranges = addDate(ranges, date);
      await this.repository.saveIngestionCheckpoint(
        "sportmonks-recent",
        JSON.stringify({ version: 1, ranges } satisfies RangeCheckpoint),
      );
    }

    const recentStored = await this.repository.queryCompletedFixtures({
      after: new Date(now.getTime() - daysRequested * 86_400_000).toISOString(),
      before: now.toISOString(),
      limit: 10_000,
    });
    for (const row of recentStored) {
      if (!completed.some((fixture) => fixture.canonicalEventId === row.canonicalEventId)) completed.push(row);
      if (!allFixtures.some((fixture) => fixture.canonicalEventId === row.canonicalEventId)) {
        allFixtures.push(toStoredFixture(row));
      }
    }

    const oddsResult = typeof this.provider.fetchHistoricalOdds === "function"
      ? await this.provider.fetchHistoricalOdds(allFixtures)
      : { capability: "odds_history_unavailable" as const, quotes: [] };
    const canonicalBySource = new Map(allFixtures.map((fixture) => [fixture.sourceEventId, fixture.canonicalEventId!]));
    const raw: HistoricalOddsSnapshot[] = [];
    for (const quote of oddsResult.quotes.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))) {
      const canonicalEventId = canonicalBySource.get(quote.sourceEventId);
      if (!canonicalEventId) continue;
      const value: Omit<HistoricalOddsSnapshot, "id"> = {
        canonicalEventId,
        provider: quote.provider,
        sourceEventId: quote.sourceEventId,
        league: quote.leagueName,
        normalizedLeagueKey: this.resolver.normalizeLeague(quote.leagueName),
        homeTeam: quote.homeTeam,
        awayTeam: quote.awayTeam,
        kickoff: quote.commenceTime,
        snapshotAt: quote.updatedAt,
        providerUpdatedAt: quote.updatedAt,
        snapshotType: "prematch",
        phase: "prematch",
        marketKey: quote.marketKey,
        market: quote.marketName,
        period: quote.period,
        selectionKey: quote.selectionKey,
        selection: quote.selectionName,
        line: quote.line,
        bookmakerKey: quote.bookmakerKey,
        bookmaker: quote.bookmakerName,
        price: quote.price,
      };
      if (Date.parse(value.providerUpdatedAt) < Date.parse(value.kickoff)) {
        raw.push({ ...value, id: historicalSnapshotId(value) });
      }
    }

    const openings: HistoricalOddsSnapshot[] = [];
    const seen = new Set<string>();
    for (const snapshot of raw) {
      const key = [snapshot.canonicalEventId, snapshot.provider, snapshot.bookmakerKey, snapshot.marketKey,
        snapshot.period, snapshot.selectionKey, snapshot.line ?? "none"].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const opening = { ...snapshot, snapshotType: "opening" as const };
      openings.push({ ...opening, id: historicalSnapshotId(opening) });
    }
    let oddsSnapshotsStored = await this.repository.saveOddsSnapshots([...raw, ...openings]);
    for (const fixture of completed) {
      const event = await this.repository.getByCanonicalEvent(fixture.canonicalEventId);
      const closing = selectClosingSnapshots(event.snapshots, fixture, { maxProviderAgeSeconds: 86_400 });
      oddsSnapshotsStored += await this.repository.saveOddsSnapshots(closing);
    }

    const result: BackfillResult = {
      requestedDays,
      daysRequested,
      daysSkippedByCheckpoint,
      daysFetched,
      rawFixturesFetched,
      fixturesRejectedByLeagueScope,
      fixturesAccepted,
      finishedFixtures,
      resultsStored,
      oddsSnapshotsStored,
      oddsHistoryCapability: oddsResult.capability,
      storageType: this.repository.storage,
      historicalLeagueScope: this.diagnostics.historicalLeagueScope,
      databaseConfigured: this.diagnostics.databaseConfigured,
      storageRequested: this.diagnostics.storageRequested,
    };
    setProviderDiagnostic("sportmonks_historical", {
      enabled: true,
      status: "ok",
      mode: result.oddsHistoryCapability,
      requestedDays,
      daysRequested,
      daysSkippedByCheckpoint,
      daysFetched,
      rawFixturesFetched,
      fixturesRejectedByLeagueScope,
      fixturesAccepted,
      finishedFixtures,
      resultsStored,
      oddsSnapshotsStored,
      storageType: result.storageType,
      historicalLeagueScope: result.historicalLeagueScope,
      databaseConfigured: result.databaseConfigured,
      storageRequested: result.storageRequested,
      lastProviderRunAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      lastError: null,
    });
    return result;
  }
}
