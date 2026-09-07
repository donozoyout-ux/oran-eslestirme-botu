import { describe, expect, it } from "vitest";
import { HISTORICAL_POSTGRES_MIGRATION } from "../src/historical-postgres-schema.js";
import { MatchIntelligenceEngine, type MatchIntelligenceInput } from "../src/match-intelligence.js";
import { PostgresMatchIntelligenceSnapshotRepository } from "../src/match-intelligence-repository.js";
import type { SqlQueryable, SqlResult } from "../src/postgres-historical-odds-repository.js";

class IdempotentSql implements SqlQueryable {
  readonly ids = new Set<string>();
  async query(text: string, values: unknown[] = []): Promise<SqlResult> {
    if (text.includes("snapshot-insert")) {
      const id = String(values[0]); if (this.ids.has(id)) return { rows: [], rowCount: 0 }; this.ids.add(id); return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT count")) return { rows: [{ count: this.ids.size }] };
    return { rows: [] };
  }
}

describe("Match Intelligence PostgreSQL snapshot", () => {
  it("ayri tabloyu migrate eder ve ayni payload'i idempotent saklar", async () => {
    const sql = new IdempotentSql();
    const repository = new PostgresMatchIntelligenceSnapshotRepository("postgres://unused", sql);
    const input: MatchIntelligenceInput = { target: { provider: "sportmonks", sourceEventId: "1", canonicalEventId: "c1",
      leagueName: "L", homeTeam: "A", awayTeam: "B", commenceTime: "2026-10-01T00:00:00Z", phase: "prematch" },
      homeTeamId: "a", awayTeamId: "b", observations: [], capabilityMap: { fixtures: "unavailable", teamStats: "unavailable",
        fixtureStats: "unavailable", events: "unavailable", lineups: "unavailable", injuries: "unavailable", xg: "unavailable" },
      generatedAt: new Date("2026-09-30T00:00:00Z") };
    const result = new MatchIntelligenceEngine().analyze(input);
    await repository.initialize();
    expect(await repository.save(result)).toBe(1);
    expect(await repository.save({ ...result, generatedAt: "2026-09-30T01:00:00Z" })).toBe(0);
    expect(await repository.count()).toBe(1);
    expect(HISTORICAL_POSTGRES_MIGRATION).toContain("CREATE TABLE IF NOT EXISTS match_intelligence_snapshots");
  });
});
