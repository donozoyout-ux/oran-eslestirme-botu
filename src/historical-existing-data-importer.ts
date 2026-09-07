import fs from "node:fs";
import { CanonicalMatchResolver } from "./canonical-match-resolver.js";
import type { OddsHistoryEntry } from "./daily-match-sheet.js";
import type { MarketKey, MatchFixture, PeriodKey } from "./domain.js";
import { historicalSnapshotId } from "./historical-odds-archive.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "./historical-odds.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";

interface LegacyDailyData { fixtures?: MatchFixture[]; oddsHistory?: OddsHistoryEntry[] }
export interface ExistingImportResult { dryRun: boolean; events: number; results: number; snapshots: number; skipped: number }

function readJson(filePath: string): LegacyDailyData | null {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as LegacyDailyData; } catch { return null; }
}

function rawKey(snapshot: HistoricalOddsSnapshot): string {
  return [snapshot.canonicalEventId,snapshot.provider,snapshot.bookmakerKey,snapshot.marketKey,snapshot.period,snapshot.selectionKey,snapshot.line ?? "none"].join("|");
}

export class HistoricalExistingDataImporter {
  private readonly resolver = new CanonicalMatchResolver();
  constructor(private readonly repository: HistoricalOddsRepository) {}

  async importDailyFile(filePath: string, dryRun: boolean): Promise<ExistingImportResult> {
    const data = readJson(filePath);
    if (!data) return { dryRun, events: 0, results: 0, snapshots: 0, skipped: 0 };
    const fixtures = this.resolver.resolveFixtures(data.fixtures ?? []);
    const fixtureBySource = new Map(fixtures.map((fixture) => [`${fixture.provider}:${fixture.sourceEventId}`, fixture]));
    const completed: HistoricalCompletedFixture[] = fixtures
      .filter((fixture) => fixture.resultStatus === "finished" || fixture.resultStatus === "cancelled")
      .map((fixture) => ({
        canonicalEventId: fixture.canonicalEventId!, providerEventIds: [{ provider: fixture.provider, eventId: fixture.sourceEventId }],
        league: fixture.leagueName, normalizedLeagueKey: this.resolver.normalizeLeague(fixture.leagueName), homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam, kickoff: fixture.commenceTime, fixtureResult: fixture.resultStatus!,
        ...(fixture.homeScore === undefined ? {} : { homeScore: fixture.homeScore }),
        ...(fixture.awayScore === undefined ? {} : { awayScore: fixture.awayScore }),
        ...(fixture.halftimeHomeScore === undefined ? {} : { halftimeHomeScore: fixture.halftimeHomeScore }),
        ...(fixture.halftimeAwayScore === undefined ? {} : { halftimeAwayScore: fixture.halftimeAwayScore }),
        archivedAt: new Date().toISOString(),
      }));
    const snapshots: HistoricalOddsSnapshot[] = [];
    let skipped = 0;
    for (const row of (data.oddsHistory ?? []).sort((a,b) => Date.parse(a.sourceUpdatedAt)-Date.parse(b.sourceUpdatedAt))) {
      const fixture = fixtureBySource.get(`${row.provider}:${row.sourceEventId}`)
        ?? fixtures.find((candidate) => candidate.sourceEventId === row.sourceEventId);
      if (!fixture || !Number.isFinite(row.price) || row.price <= 1 || !Number.isFinite(Date.parse(row.sourceUpdatedAt))) { skipped += 1; continue; }
      const value: Omit<HistoricalOddsSnapshot,"id"> = {
        canonicalEventId: fixture.canonicalEventId!, provider: row.provider, sourceEventId: row.sourceEventId,
        league: fixture.leagueName, normalizedLeagueKey: this.resolver.normalizeLeague(fixture.leagueName), homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam, kickoff: fixture.commenceTime, snapshotAt: row.capturedAt, providerUpdatedAt: row.sourceUpdatedAt,
        snapshotType: row.phase === "prematch" ? "prematch" : "live", phase: row.phase,
        marketKey: row.marketKey as MarketKey, market: row.market, period: row.period as PeriodKey,
        selectionKey: row.selectionKey, selection: row.selection, line: row.line,
        bookmakerKey: row.bookmakerKey, bookmaker: row.bookmaker, price: row.price,
      };
      snapshots.push({ ...value, id: historicalSnapshotId(value) });
    }
    const seenOpening = new Set<string>();
    const openings = snapshots.filter((snapshot) => snapshot.phase === "prematch").flatMap((snapshot) => {
      const key = rawKey(snapshot); if (seenOpening.has(key)) return []; seenOpening.add(key);
      const opening = { ...snapshot, snapshotType: "opening" as const };
      return [{ ...opening, id: historicalSnapshotId(opening) }];
    });
    if (!dryRun) {
      for (const fixture of completed) await this.repository.saveCompletedFixture(fixture);
      await this.repository.saveOddsSnapshots([...snapshots, ...openings]);
    }
    return { dryRun, events: completed.length, results: completed.filter((f) => f.fixtureResult === "finished" && f.homeScore !== undefined && f.awayScore !== undefined).length,
      snapshots: snapshots.length + openings.length, skipped };
  }
}
