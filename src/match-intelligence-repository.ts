import { createHash } from "node:crypto";
import pg from "pg";
import type { MatchIntelligenceResult } from "./match-intelligence.js";
import type { SqlQueryable, SqlResult } from "./postgres-historical-odds-repository.js";

export interface MatchIntelligenceSnapshotRepository {
  readonly storage: "memory" | "postgres";
  initialize?(): Promise<void>;
  save(result: MatchIntelligenceResult): Promise<number>;
  count(): Promise<number>;
  close?(): Promise<void>;
}

function snapshotId(result: MatchIntelligenceResult): string {
  const stable = { ...result, generatedAt: undefined };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export class MemoryMatchIntelligenceSnapshotRepository implements MatchIntelligenceSnapshotRepository {
  readonly storage = "memory" as const;
  private readonly snapshots = new Map<string, MatchIntelligenceResult>();
  async save(result: MatchIntelligenceResult): Promise<number> {
    const id = snapshotId(result);
    if (this.snapshots.has(id)) return 0;
    this.snapshots.set(id, JSON.parse(JSON.stringify(result)) as MatchIntelligenceResult);
    return 1;
  }
  async count(): Promise<number> { return this.snapshots.size; }
}

interface PoolLike extends SqlQueryable { end?(): Promise<void> }
export class PostgresMatchIntelligenceSnapshotRepository implements MatchIntelligenceSnapshotRepository {
  readonly storage = "postgres" as const;
  private readonly pool: PoolLike;
  constructor(connectionString: string, pool?: PoolLike) {
    this.pool = pool ?? new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000 });
  }
  async initialize(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS match_intelligence_snapshots (
      id text PRIMARY KEY,
      canonical_event_id text NOT NULL,
      generated_at timestamptz NOT NULL,
      provider text NOT NULL,
      data_version integer NOT NULL,
      payload jsonb NOT NULL,
      confidence integer NOT NULL,
      data_completeness text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS match_intelligence_event_generated_idx
      ON match_intelligence_snapshots(canonical_event_id, generated_at DESC);`);
  }
  async save(result: MatchIntelligenceResult): Promise<number> {
    const response: SqlResult = await this.pool.query(`/* match-intelligence:snapshot-insert */
      INSERT INTO match_intelligence_snapshots
      (id,canonical_event_id,generated_at,provider,data_version,payload,confidence,data_completeness)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(id) DO NOTHING`, [
      snapshotId(result), result.canonicalEventId, result.generatedAt, result.provider, result.dataVersion,
      JSON.stringify(result), result.confidence.score, result.dataAvailability,
    ]);
    return response.rowCount ?? 0;
  }
  async count(): Promise<number> {
    const response = await this.pool.query("SELECT count(*)::int AS count FROM match_intelligence_snapshots");
    return Number(response.rows[0]?.count ?? 0);
  }
  async close(): Promise<void> { await this.pool.end?.(); }
}
