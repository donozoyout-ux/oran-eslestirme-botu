import pg from "pg";
import type {
  HistoricalCompletedFixture,
  HistoricalCompletenessSummary,
  HistoricalEventData,
  HistoricalOddsSnapshot,
  HistoricalQuery,
  HistoricalRepositoryStats,
} from "./historical-odds.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";
import { HISTORICAL_POSTGRES_MIGRATION } from "./historical-postgres-schema.js";
import { logger } from "./logger.js";

export interface SqlResult { rows: Record<string, unknown>[]; rowCount?: number | null }
export interface SqlQueryable { query(text: string, values?: unknown[]): Promise<SqlResult>; release?(): void }

interface PoolLike extends SqlQueryable { end?(): Promise<void>; connect?(): Promise<SqlQueryable> }

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function fixtureFromRow(row: Record<string, unknown>, refs: HistoricalCompletedFixture["providerEventIds"]): HistoricalCompletedFixture {
  return {
    canonicalEventId: String(row.canonical_event_id), providerEventIds: refs,
    normalizedLeagueKey: String(row.normalized_league_key), league: String(row.league_name),
    homeTeam: String(row.home_team), awayTeam: String(row.away_team), kickoff: iso(row.kickoff),
    fixtureResult: row.result_status as HistoricalCompletedFixture["fixtureResult"],
    ...(row.home_score === null || row.home_score === undefined ? {} : { homeScore: Number(row.home_score) }),
    ...(row.away_score === null || row.away_score === undefined ? {} : { awayScore: Number(row.away_score) }),
    ...(row.halftime_home_score === null || row.halftime_home_score === undefined ? {} : { halftimeHomeScore: Number(row.halftime_home_score) }),
    ...(row.halftime_away_score === null || row.halftime_away_score === undefined ? {} : { halftimeAwayScore: Number(row.halftime_away_score) }),
    archivedAt: iso(row.archived_at), resultConflict: Boolean(row.result_conflict),
    resultConflicts: Array.isArray(row.result_conflicts) ? row.result_conflicts as HistoricalCompletedFixture["resultConflicts"] : [],
  };
}

function snapshotFromRow(row: Record<string, unknown>): HistoricalOddsSnapshot {
  return {
    id: String(row.id), canonicalEventId: String(row.canonical_event_id), provider: String(row.provider),
    sourceEventId: String(row.source_event_id), league: String(row.league_name),
    normalizedLeagueKey: String(row.normalized_league_key), homeTeam: String(row.home_team), awayTeam: String(row.away_team),
    kickoff: iso(row.kickoff), snapshotAt: iso(row.captured_at), providerUpdatedAt: iso(row.provider_updated_at),
    snapshotType: row.snapshot_type as HistoricalOddsSnapshot["snapshotType"], phase: row.phase as HistoricalOddsSnapshot["phase"],
    marketKey: row.market_key as HistoricalOddsSnapshot["marketKey"], market: String(row.market_name),
    period: row.period as HistoricalOddsSnapshot["period"], selectionKey: String(row.selection_key), selection: String(row.selection_name),
    line: row.line === null || row.line === undefined ? null : Number(row.line), bookmakerKey: String(row.bookmaker_key),
    bookmaker: String(row.bookmaker_name), price: Number(row.price),
  };
}

export class PostgresHistoricalOddsRepository implements HistoricalOddsRepository {
  readonly storage = "postgres" as const;
  private readonly pool: PoolLike;
  private lastArchiveWrite: string | null = null;
  private lastError: string | null = null;

  constructor(connectionString: string, pool?: PoolLike) {
    this.pool = pool ?? new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  }

  async initialize(): Promise<void> { await this.run(HISTORICAL_POSTGRES_MIGRATION); }
  async close(): Promise<void> { await this.pool.end?.(); }

  async saveCompletedFixture(fixture: HistoricalCompletedFixture): Promise<void> {
    const existing = await this.getByCanonicalEvent(fixture.canonicalEventId);
    const conflict = existing.fixture?.fixtureResult === "finished" && fixture.fixtureResult === "finished"
      && existing.fixture.homeScore !== undefined && existing.fixture.awayScore !== undefined
      && fixture.homeScore !== undefined && fixture.awayScore !== undefined
      && (existing.fixture.homeScore !== fixture.homeScore || existing.fixture.awayScore !== fixture.awayScore);
    if (conflict) logger.warn("Historical PostgreSQL fixture provider skor uyusmazligi kaydedildi.", {
      canonicalEventId: fixture.canonicalEventId,
      existingScore: `${existing.fixture?.homeScore}-${existing.fixture?.awayScore}`,
      incomingScore: `${fixture.homeScore}-${fixture.awayScore}`,
    });
    const conflicts = fixture.resultConflicts ?? [];
    const client = await this.pool.connect?.();
    const target = client ?? this.pool;
    try {
      if (client) await target.query("BEGIN");
      await this.runOn(target, `/* historical:event-upsert */ INSERT INTO historical_events
      (canonical_event_id, normalized_league_key, league_name, home_team, away_team, kickoff, result_status,
       home_score, away_score, halftime_home_score, halftime_away_score, result_conflict, result_conflicts, archived_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
      ON CONFLICT (canonical_event_id) DO UPDATE SET
       normalized_league_key=EXCLUDED.normalized_league_key, league_name=EXCLUDED.league_name,
       home_team=EXCLUDED.home_team, away_team=EXCLUDED.away_team, kickoff=EXCLUDED.kickoff,
       result_status=CASE WHEN historical_events.result_status='finished' THEN historical_events.result_status ELSE EXCLUDED.result_status END,
       home_score=CASE WHEN historical_events.result_status='finished' AND EXCLUDED.result_status='finished'
         AND historical_events.home_score IS NOT NULL AND historical_events.away_score IS NOT NULL
         AND EXCLUDED.home_score IS NOT NULL AND EXCLUDED.away_score IS NOT NULL
         AND (historical_events.home_score<>EXCLUDED.home_score OR historical_events.away_score<>EXCLUDED.away_score)
         THEN historical_events.home_score ELSE COALESCE(EXCLUDED.home_score,historical_events.home_score) END,
       away_score=CASE WHEN historical_events.result_status='finished' AND EXCLUDED.result_status='finished'
         AND historical_events.home_score IS NOT NULL AND historical_events.away_score IS NOT NULL
         AND EXCLUDED.home_score IS NOT NULL AND EXCLUDED.away_score IS NOT NULL
         AND (historical_events.home_score<>EXCLUDED.home_score OR historical_events.away_score<>EXCLUDED.away_score)
         THEN historical_events.away_score ELSE COALESCE(EXCLUDED.away_score,historical_events.away_score) END,
       halftime_home_score=COALESCE(EXCLUDED.halftime_home_score,historical_events.halftime_home_score),
       halftime_away_score=COALESCE(EXCLUDED.halftime_away_score,historical_events.halftime_away_score),
       result_conflict=historical_events.result_conflict OR EXCLUDED.result_conflict OR
         (historical_events.result_status='finished' AND EXCLUDED.result_status='finished'
          AND historical_events.home_score IS NOT NULL AND historical_events.away_score IS NOT NULL
          AND EXCLUDED.home_score IS NOT NULL AND EXCLUDED.away_score IS NOT NULL
          AND (historical_events.home_score<>EXCLUDED.home_score OR historical_events.away_score<>EXCLUDED.away_score)),
       result_conflicts=historical_events.result_conflicts || EXCLUDED.result_conflicts || CASE WHEN
         historical_events.result_status='finished' AND EXCLUDED.result_status='finished'
         AND historical_events.home_score IS NOT NULL AND historical_events.away_score IS NOT NULL
         AND EXCLUDED.home_score IS NOT NULL AND EXCLUDED.away_score IS NOT NULL
         AND (historical_events.home_score<>EXCLUDED.home_score OR historical_events.away_score<>EXCLUDED.away_score)
         AND NOT historical_events.result_conflicts @> jsonb_build_array(jsonb_build_object('provider',$15::text,'homeScore',EXCLUDED.home_score,'awayScore',EXCLUDED.away_score))
         THEN jsonb_build_array(jsonb_build_object('provider',$15::text,'homeScore',EXCLUDED.home_score,'awayScore',EXCLUDED.away_score,'observedAt',EXCLUDED.archived_at))
         ELSE EXCLUDED.result_conflicts END,
       archived_at=EXCLUDED.archived_at, updated_at=now()`, [
      fixture.canonicalEventId, fixture.normalizedLeagueKey, fixture.league, fixture.homeTeam, fixture.awayTeam,
      fixture.kickoff, fixture.fixtureResult, fixture.homeScore ?? null, fixture.awayScore ?? null,
      fixture.halftimeHomeScore ?? null, fixture.halftimeAwayScore ?? null,
      Boolean(fixture.resultConflict || existing.fixture?.resultConflict || conflict), JSON.stringify(conflicts), fixture.archivedAt,
      fixture.providerEventIds[0]?.provider ?? "unknown",
    ]);
    for (const ref of fixture.providerEventIds) await this.runOn(target,
      `/* historical:provider-upsert */ INSERT INTO historical_provider_events(canonical_event_id,provider,source_event_id)
       VALUES($1,$2,$3) ON CONFLICT(provider,source_event_id) DO UPDATE SET canonical_event_id=EXCLUDED.canonical_event_id`,
      [fixture.canonicalEventId, ref.provider, ref.eventId],
    );
      if (client) await target.query("COMMIT");
    } catch (error) {
      if (client) await target.query("ROLLBACK");
      throw error;
    } finally { client?.release?.(); }
    this.lastArchiveWrite = new Date().toISOString();
  }

  async saveOddsSnapshots(snapshots: HistoricalOddsSnapshot[]): Promise<void> {
    const client = await this.pool.connect?.(); const target = client ?? this.pool;
    try {
      if (client) await target.query("BEGIN");
      for (const s of snapshots) await this.runOn(target, `/* historical:snapshot-insert */ INSERT INTO historical_odds_snapshots
      (id,canonical_event_id,provider,source_event_id,league_name,normalized_league_key,home_team,away_team,kickoff,
       snapshot_type,phase,market_key,market_name,period,selection_key,selection_name,line,bookmaker_key,bookmaker_name,price,captured_at,provider_updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT(id) DO NOTHING`,
      [s.id,s.canonicalEventId,s.provider,s.sourceEventId,s.league,s.normalizedLeagueKey,s.homeTeam,s.awayTeam,s.kickoff,
        s.snapshotType,s.phase,s.marketKey,s.market,s.period,s.selectionKey,s.selection,s.line,s.bookmakerKey,s.bookmaker,s.price,s.snapshotAt,s.providerUpdatedAt]);
      if (client) await target.query("COMMIT");
    } catch (error) {
      if (client) await target.query("ROLLBACK");
      throw error;
    } finally { client?.release?.(); }
    if (snapshots.length) this.lastArchiveWrite = new Date().toISOString();
  }

  async getByCanonicalEvent(id: string): Promise<HistoricalEventData> {
    const [events, refs, snapshots] = await Promise.all([
      this.run(`/* historical:event-by-id */ SELECT * FROM historical_events WHERE canonical_event_id=$1`, [id]),
      this.run(`/* historical:refs-by-id */ SELECT provider,source_event_id FROM historical_provider_events WHERE canonical_event_id=$1`, [id]),
      this.run(`/* historical:snapshots-by-id */ SELECT * FROM historical_odds_snapshots WHERE canonical_event_id=$1 ORDER BY provider_updated_at,captured_at,id`, [id]),
    ]);
    const providerRefs = refs.rows.map((r) => ({ provider: String(r.provider), eventId: String(r.source_event_id) }));
    return { fixture: events.rows[0] ? fixtureFromRow(events.rows[0], providerRefs) : undefined, snapshots: snapshots.rows.map(snapshotFromRow) };
  }

  async queryCompletedFixtures(query: HistoricalQuery): Promise<HistoricalCompletedFixture[]> {
    const values: unknown[] = []; const where: string[] = [];
    if (query.normalizedLeagueKey) { values.push(query.normalizedLeagueKey); where.push(`normalized_league_key=$${values.length}`); }
    if (query.after) { values.push(query.after); where.push(`kickoff>=$${values.length}`); }
    if (query.before) { values.push(query.before); where.push(`kickoff<$${values.length}`); }
    if (query.excludeCanonicalEventId) { values.push(query.excludeCanonicalEventId); where.push(`canonical_event_id<>$${values.length}`); }
    values.push(query.limit ?? 5_000);
    const result = await this.run(`/* historical:fixture-query */ SELECT * FROM historical_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY kickoff DESC LIMIT $${values.length}`, values);
    return Promise.all(result.rows.map(async (row) => {
      const refs = await this.run(`SELECT provider,source_event_id FROM historical_provider_events WHERE canonical_event_id=$1`, [row.canonical_event_id]);
      return fixtureFromRow(row, refs.rows.map((r) => ({ provider: String(r.provider), eventId: String(r.source_event_id) })));
    }));
  }

  async getStats(): Promise<HistoricalRepositoryStats> {
    try {
      const result = await this.run(`/* historical:stats */ SELECT count(*)::int AS events,min(kickoff) AS oldest,max(kickoff) AS newest,
        (SELECT count(*)::int FROM historical_odds_snapshots) AS snapshots,
        GREATEST(max(updated_at),(SELECT max(created_at) FROM historical_odds_snapshots)) AS last_write FROM historical_events`);
      const row = result.rows[0] ?? {};
      return { storage: this.storage, completedFixtures: Number(row.events ?? 0), oddsSnapshots: Number(row.snapshots ?? 0),
        oldestEvent: row.oldest ? iso(row.oldest) : null, newestEvent: row.newest ? iso(row.newest) : null,
        lastArchiveWrite: row.last_write ? iso(row.last_write) : this.lastArchiveWrite, health: "ok", lastError: null };
    } catch (error) {
      return { storage: this.storage, completedFixtures: 0, oddsSnapshots: 0, oldestEvent: null, newestEvent: null,
        lastArchiveWrite: this.lastArchiveWrite, health: "error", lastError: error instanceof Error ? error.message : String(error) };
    }
  }

  async getCompletenessDiagnostics(): Promise<HistoricalCompletenessSummary> {
    const result = await this.run(`/* historical:completeness */ WITH c AS (
      SELECT e.canonical_event_id,
       (e.result_status='finished' AND e.home_score IS NOT NULL AND e.away_score IS NOT NULL AND NOT e.result_conflict) AS has_result,
       bool_or(s.snapshot_type='closing') FILTER(WHERE s.phase='prematch') AS has_closing,
       bool_or(s.snapshot_type='closing' AND s.market_key='handicap') FILTER(WHERE s.phase='prematch') AS has_ah,
       bool_or(s.snapshot_type='closing' AND s.market_key='total_goals') FILTER(WHERE s.phase='prematch') AS has_ou
      FROM historical_events e LEFT JOIN historical_odds_snapshots s USING(canonical_event_id) GROUP BY e.canonical_event_id)
      SELECT count(*)::int total_events,count(*) FILTER(WHERE has_result)::int with_results,
       count(*) FILTER(WHERE has_closing)::int with_closing,
       count(*) FILTER(WHERE has_ah AND has_ou)::int with_both,
       count(*) FILTER(WHERE has_result AND has_ah AND has_ou)::int eligible FROM c`);
    const r = result.rows[0] ?? {};
    return { totalEvents:Number(r.total_events??0),withResults:Number(r.with_results??0),withClosingOdds:Number(r.with_closing??0),
      withAhAndOuClosing:Number(r.with_both??0),patternEligible:Number(r.eligible??0) };
  }

  async getIngestionCheckpoint(source: string): Promise<string | null> {
    const result=await this.run(`/* historical:checkpoint-get */ SELECT cursor FROM historical_ingestion_checkpoints WHERE source=$1`,[source]);
    return result.rows[0]?.cursor ? String(result.rows[0].cursor) : null;
  }
  async saveIngestionCheckpoint(source: string,cursor: string): Promise<void> {
    await this.run(`/* historical:checkpoint-save */ INSERT INTO historical_ingestion_checkpoints(source,cursor) VALUES($1,$2)
      ON CONFLICT(source) DO UPDATE SET cursor=EXCLUDED.cursor,updated_at=now()`,[source,cursor]);
  }

  private async run(text: string, values?: unknown[]): Promise<SqlResult> {
    return this.runOn(this.pool, text, values);
  }
  private async runOn(target: SqlQueryable, text: string, values?: unknown[]): Promise<SqlResult> {
    try { const result = await target.query(text, values); this.lastError = null; return result; }
    catch (error) { this.lastError = error instanceof Error ? error.message : String(error); throw error; }
  }
}
