import type { MatchFixture } from "./domain.js";
import { errorMessage, logger } from "./logger.js";
import { MatchIntelligenceEngine, type MatchIntelligenceResult } from "./match-intelligence.js";
import type { MatchIntelligenceSnapshotRepository } from "./match-intelligence-repository.js";
import { setProviderDiagnostic } from "./provider-diagnostics.js";
import type { SportmonksMatchIntelligenceProvider } from "./sportmonks-match-intelligence-provider.js";

export interface MatchIntelligenceStatus {
  enabled: boolean;
  provider: "sportmonks";
  cacheSize: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  capabilityMap: MatchIntelligenceResult["capabilityMap"];
  rateLimitRemaining: number | null;
  rateLimitResetSeconds: number | null;
  snapshotsStored: number;
  results: MatchIntelligenceResult[];
}

const EMPTY_CAPABILITIES: MatchIntelligenceResult["capabilityMap"] = {
  fixtures: "unavailable", teamStats: "unavailable", fixtureStats: "unavailable", events: "unavailable",
  lineups: "unavailable", injuries: "unavailable", xg: "unavailable",
};

export class MatchIntelligenceService {
  private readonly cache = new Map<string, { expiresAt: number; result: MatchIntelligenceResult }>();
  private activeRefresh: Promise<MatchIntelligenceStatus> | null = null;
  private readonly engine: MatchIntelligenceEngine;
  private readonly statusValue: MatchIntelligenceStatus = {
    enabled: true, provider: "sportmonks", cacheSize: 0, lastRunAt: null, lastSuccessAt: null, lastError: null,
    capabilityMap: { ...EMPTY_CAPABILITIES }, rateLimitRemaining: null, rateLimitResetSeconds: null,
    snapshotsStored: 0, results: [],
  };

  constructor(
    private readonly provider: SportmonksMatchIntelligenceProvider,
    private readonly repository: MatchIntelligenceSnapshotRepository,
    private readonly options: { cacheMinutes: number; minSample: number },
  ) { this.engine = new MatchIntelligenceEngine(options.minSample); }

  async refresh(fixtures: MatchFixture[], now = new Date()): Promise<MatchIntelligenceStatus> {
    if (this.activeRefresh) return this.activeRefresh;
    this.activeRefresh = this.executeRefresh(fixtures, now).finally(() => { this.activeRefresh = null; });
    return this.activeRefresh;
  }

  private async executeRefresh(fixtures: MatchFixture[], now: Date): Promise<MatchIntelligenceStatus> {
    this.statusValue.lastRunAt = now.toISOString();
    const targets = fixtures.filter((fixture): fixture is MatchFixture & { canonicalEventId: string } =>
      fixture.provider === "sportmonks" && fixture.phase === "prematch" && Boolean(fixture.canonicalEventId)
      && Date.parse(fixture.commenceTime) > now.getTime());
    const results: MatchIntelligenceResult[] = [];
    for (const target of targets) {
      const cached = this.cache.get(target.canonicalEventId);
      if (cached && cached.expiresAt > now.getTime()) { results.push(cached.result); continue; }
      try {
        const providerResult = await this.provider.fetch(target);
        const result = this.engine.analyze({ ...providerResult.input, generatedAt: now });
        this.cache.set(target.canonicalEventId, { expiresAt: now.getTime() + this.options.cacheMinutes * 60_000, result });
        await this.repository.save(result);
        this.statusValue.snapshotsStored = await this.repository.count();
        this.statusValue.capabilityMap = { ...providerResult.input.capabilityMap };
        this.statusValue.rateLimitRemaining = providerResult.rateLimitRemaining;
        this.statusValue.rateLimitResetSeconds = providerResult.rateLimitResetSeconds;
        this.statusValue.lastSuccessAt = now.toISOString();
        this.statusValue.lastError = null;
        results.push(result);
      } catch (error) {
        this.statusValue.lastError = errorMessage(error);
        logger.warn("Match Intelligence guncellenemedi; odds monitor devam ediyor.", { error: errorMessage(error) });
      }
    }
    this.statusValue.cacheSize = this.cache.size;
    this.statusValue.results = results.slice(0, 20);
    setProviderDiagnostic("match_intelligence", {
      enabled: true, provider: "sportmonks", cacheSize: this.statusValue.cacheSize,
      lastRunAt: this.statusValue.lastRunAt, lastSuccessAt: this.statusValue.lastSuccessAt,
      lastError: this.statusValue.lastError, rateLimitRemaining: this.statusValue.rateLimitRemaining,
      rateLimitResetSeconds: this.statusValue.rateLimitResetSeconds, snapshotsStored: this.statusValue.snapshotsStored,
      capabilityMap: Object.entries(this.statusValue.capabilityMap).map(([key, value]) => `${key}:${value}`),
    });
    return this.getStatus();
  }

  getStatus(): MatchIntelligenceStatus {
    return JSON.parse(JSON.stringify(this.statusValue)) as MatchIntelligenceStatus;
  }
}

export function disabledMatchIntelligenceStatus(): MatchIntelligenceStatus {
  return { enabled: false, provider: "sportmonks", cacheSize: 0, lastRunAt: null, lastSuccessAt: null, lastError: null,
    capabilityMap: { ...EMPTY_CAPABILITIES }, rateLimitRemaining: null, rateLimitResetSeconds: null, snapshotsStored: 0, results: [] };
}
