import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  HistoricalCompletedFixture,
  HistoricalCompletenessSummary,
  HistoricalEventCompleteness,
  HistoricalEventData,
  HistoricalOddsSnapshot,
  HistoricalQuery,
  HistoricalRepositoryStats,
  ProviderEventReference,
} from "./historical-odds.js";
import { errorMessage, logger } from "./logger.js";

export interface HistoricalOddsRepository {
  readonly storage: "memory" | "json" | "postgres";
  initialize?(): Promise<void>;
  close?(): Promise<void>;
  saveCompletedFixture(fixture: HistoricalCompletedFixture): Promise<void>;
  saveOddsSnapshots(snapshots: HistoricalOddsSnapshot[]): Promise<number>;
  getByCanonicalEvent(canonicalEventId: string): Promise<HistoricalEventData>;
  queryCompletedFixtures(query: HistoricalQuery): Promise<HistoricalCompletedFixture[]>;
  getStats(): Promise<HistoricalRepositoryStats>;
  getCompletenessDiagnostics(): Promise<HistoricalCompletenessSummary>;
  getIngestionCheckpoint(source: string): Promise<string | null>;
  saveIngestionCheckpoint(source: string, cursor: string): Promise<void>;
}

interface PersistedHistoricalState {
  version: 1;
  fixtures: Record<string, HistoricalCompletedFixture>;
  snapshots: Record<string, HistoricalOddsSnapshot>;
  checkpoints: Record<string, string>;
}

function providerRefKey(reference: ProviderEventReference): string {
  return `${reference.provider}:${reference.eventId}`;
}

function mergeProviderRefs(
  first: ProviderEventReference[],
  second: ProviderEventReference[],
): ProviderEventReference[] {
  const refs = new Map([...first, ...second].map((reference) => [providerRefKey(reference), reference]));
  return [...refs.values()].sort((a, b) => providerRefKey(a).localeCompare(providerRefKey(b)));
}

function fixtureQuality(fixture: HistoricalCompletedFixture): number {
  if (fixture.fixtureResult === "finished" && fixture.homeScore !== undefined && fixture.awayScore !== undefined) return 3;
  if (fixture.fixtureResult === "finished") return 2;
  if (fixture.fixtureResult === "cancelled") return 1;
  return 0;
}

abstract class BaseHistoricalOddsRepository implements HistoricalOddsRepository {
  abstract readonly storage: "memory" | "json";
  protected state: PersistedHistoricalState = { version: 1, fixtures: {}, snapshots: {}, checkpoints: {} };
  protected lastArchiveWrite: string | null = null;
  protected lastError: string | null = null;

  async saveCompletedFixture(fixture: HistoricalCompletedFixture): Promise<void> {
    const existing = this.state.fixtures[fixture.canonicalEventId];
    if (!existing) {
      this.state.fixtures[fixture.canonicalEventId] = {
        ...fixture,
        providerEventIds: mergeProviderRefs([], fixture.providerEventIds),
      };
    } else {
      const scoreConflict = existing.fixtureResult === "finished"
        && fixture.fixtureResult === "finished"
        && existing.homeScore !== undefined && existing.awayScore !== undefined
        && fixture.homeScore !== undefined && fixture.awayScore !== undefined
        && (existing.homeScore !== fixture.homeScore || existing.awayScore !== fixture.awayScore);
      if (scoreConflict) {
        logger.warn("Historical fixture provider skor uyusmazligi kaydedildi.", {
          canonicalEventId: fixture.canonicalEventId,
          existingScore: `${existing.homeScore}-${existing.awayScore}`,
          incomingScore: `${fixture.homeScore}-${fixture.awayScore}`,
        });
      }
      const conflictEntry = scoreConflict ? {
        provider: fixture.providerEventIds[0]?.provider ?? "unknown",
        homeScore: fixture.homeScore!,
        awayScore: fixture.awayScore!,
        observedAt: fixture.archivedAt,
      } : undefined;
      const priorConflicts = [...(existing.resultConflicts ?? []), ...(fixture.resultConflicts ?? [])].filter(
        (entry, index, rows) => rows.findIndex((candidate) => candidate.provider === entry.provider
          && candidate.homeScore === entry.homeScore && candidate.awayScore === entry.awayScore) === index,
      );
      const conflictAlreadyRecorded = conflictEntry && priorConflicts.some((entry) =>
        entry.provider === conflictEntry.provider && entry.homeScore === conflictEntry.homeScore && entry.awayScore === conflictEntry.awayScore);
      const incomingPreferred = fixtureQuality(fixture) >= fixtureQuality(existing);
      const primary = incomingPreferred ? fixture : existing;
      const secondary = incomingPreferred ? existing : fixture;
      this.state.fixtures[fixture.canonicalEventId] = {
        ...secondary,
        ...primary,
        providerEventIds: mergeProviderRefs(existing.providerEventIds, fixture.providerEventIds),
        resultConflict: Boolean(existing.resultConflict || fixture.resultConflict || scoreConflict),
        resultConflicts: conflictEntry && !conflictAlreadyRecorded ? [...priorConflicts, conflictEntry] : priorConflicts,
      };
    }
    try {
      await this.afterMutation();
      this.lastError = null;
      this.lastArchiveWrite = new Date().toISOString();
    } catch (error) {
      this.lastError = errorMessage(error);
      throw error;
    }
  }

  async saveOddsSnapshots(snapshots: HistoricalOddsSnapshot[]): Promise<number> {
    let changed = false;
    let inserted = 0;
    for (const snapshot of snapshots) {
      if (this.state.snapshots[snapshot.id]) continue;
      this.state.snapshots[snapshot.id] = snapshot;
      changed = true;
      inserted += 1;
    }
    if (changed) {
      try {
        await this.afterMutation();
        this.lastError = null;
        this.lastArchiveWrite = new Date().toISOString();
      } catch (error) {
        this.lastError = errorMessage(error);
        throw error;
      }
    }
    return inserted;
  }

  async getByCanonicalEvent(canonicalEventId: string): Promise<HistoricalEventData> {
    return {
      fixture: this.state.fixtures[canonicalEventId],
      snapshots: Object.values(this.state.snapshots).filter(
        (snapshot) => snapshot.canonicalEventId === canonicalEventId,
      ),
    };
  }

  async queryCompletedFixtures(query: HistoricalQuery): Promise<HistoricalCompletedFixture[]> {
    const before = query.before ? Date.parse(query.before) : Number.POSITIVE_INFINITY;
    const after = query.after ? Date.parse(query.after) : Number.NEGATIVE_INFINITY;
    return Object.values(this.state.fixtures)
      .filter((fixture) => !query.normalizedLeagueKey || fixture.normalizedLeagueKey === query.normalizedLeagueKey)
      .filter((fixture) => fixture.canonicalEventId !== query.excludeCanonicalEventId)
      .filter((fixture) => Date.parse(fixture.kickoff) < before)
      .filter((fixture) => Date.parse(fixture.kickoff) >= after)
      .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
      .slice(0, query.limit ?? Number.POSITIVE_INFINITY);
  }

  async getStats(): Promise<HistoricalRepositoryStats> {
    const fixtures = Object.values(this.state.fixtures);
    const kickoffs = fixtures.map((fixture) => fixture.kickoff).sort();
    return {
      storage: this.storage,
      completedFixtures: Object.keys(this.state.fixtures).length,
      oddsSnapshots: Object.keys(this.state.snapshots).length,
      oldestEvent: kickoffs[0] ?? null,
      newestEvent: kickoffs.at(-1) ?? null,
      lastArchiveWrite: this.lastArchiveWrite,
      health: this.lastError ? "error" : "ok",
      lastError: this.lastError,
    };
  }

  async getCompletenessDiagnostics(): Promise<HistoricalCompletenessSummary> {
    const rows = Object.values(this.state.fixtures).map((fixture) => this.completeness(
      fixture,
      Object.values(this.state.snapshots).filter((snapshot) => snapshot.canonicalEventId === fixture.canonicalEventId),
    ));
    return {
      totalEvents: rows.length,
      withResults: rows.filter((row) => row.hasResult).length,
      withClosingOdds: rows.filter((row) => row.hasClosingOdds).length,
      withAhAndOuClosing: rows.filter((row) => row.hasAhAndOuClosing).length,
      patternEligible: rows.filter((row) => row.patternEligible).length,
    };
  }

  async getIngestionCheckpoint(source: string): Promise<string | null> { return this.state.checkpoints[source] ?? null; }
  async saveIngestionCheckpoint(source: string, cursor: string): Promise<void> {
    if (this.state.checkpoints[source] === cursor) return;
    this.state.checkpoints[source] = cursor;
    await this.afterMutation();
  }

  private completeness(fixture: HistoricalCompletedFixture, snapshots: HistoricalOddsSnapshot[]): HistoricalEventCompleteness {
    const prematch = snapshots.filter((snapshot) => snapshot.phase === "prematch");
    const closing = prematch.filter((snapshot) => snapshot.snapshotType === "closing");
    const hasAh = closing.some((snapshot) => snapshot.marketKey === "handicap");
    const hasOu = closing.some((snapshot) => snapshot.marketKey === "total_goals");
    const hasResult = fixture.fixtureResult === "finished" && fixture.homeScore !== undefined
      && fixture.awayScore !== undefined && !fixture.resultConflict;
    return {
      canonicalEventId: fixture.canonicalEventId,
      hasResult,
      hasHalftimeScore: fixture.halftimeHomeScore !== undefined && fixture.halftimeAwayScore !== undefined,
      hasPrematchOdds: prematch.length > 0,
      hasAsianHandicap: prematch.some((snapshot) => snapshot.marketKey === "handicap"),
      hasTotalGoals: prematch.some((snapshot) => snapshot.marketKey === "total_goals"),
      hasOpeningOdds: prematch.some((snapshot) => snapshot.snapshotType === "opening"),
      hasClosingOdds: closing.length > 0,
      hasAhAndOuClosing: hasAh && hasOu,
      bookmakerCount: new Set(snapshots.map((snapshot) => snapshot.bookmakerKey)).size,
      snapshotCount: snapshots.length,
      patternEligible: hasResult && hasAh && hasOu,
    };
  }

  protected abstract afterMutation(): Promise<void>;
}

export class MemoryHistoricalOddsRepository extends BaseHistoricalOddsRepository {
  readonly storage = "memory" as const;
  protected async afterMutation(): Promise<void> {}
}

export class JsonHistoricalOddsRepository extends BaseHistoricalOddsRepository {
  readonly storage = "json" as const;
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedHistoricalState>;
      if (parsed.version !== 1 || !parsed.fixtures || !parsed.snapshots) return;
      this.state = { version: 1, fixtures: parsed.fixtures, snapshots: parsed.snapshots, checkpoints: parsed.checkpoints ?? {} };
      const writes = [
        ...Object.values(this.state.fixtures).map((fixture) => fixture.archivedAt),
        ...Object.values(this.state.snapshots).map((snapshot) => snapshot.snapshotAt),
      ].filter((value) => Number.isFinite(Date.parse(value))).sort();
      this.lastArchiveWrite = writes.at(-1) ?? null;
    } catch (error) {
      logger.warn("Historical odds arsivi okunamadi; bos arsivle baslanacak.", { error: errorMessage(error) });
    }
  }

  protected async afterMutation(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}
