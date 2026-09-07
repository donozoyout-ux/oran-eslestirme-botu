import { createHash } from "node:crypto";
import { CanonicalMatchResolver } from "./canonical-match-resolver.js";
import { selectClosingSnapshots } from "./closing-odds.js";
import type { MatchFixture, OddsQuote } from "./domain.js";
import type { HistoricalPatternResult } from "./historical-odds-pattern-engine.js";
import { HistoricalOddsPatternEngine } from "./historical-odds-pattern-engine.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot, ProviderEventReference } from "./historical-odds.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";

export interface HistoricalOddsArchiveOptions {
  maxQuoteAgeSeconds: number;
}

export interface HistoricalPatternDiagnostic {
  enabled: true;
  storage: "memory" | "json" | "postgres";
  completedFixtures: number;
  oddsSnapshots: number;
  oldestEvent: string | null;
  newestEvent: string | null;
  lastArchiveWrite: string | null;
  health: "ok" | "error";
  lastError: string | null;
  completeness: {
    totalEvents: number;
    withResults: number;
    withClosingOdds: number;
    withAhAndOuClosing: number;
    patternEligible: number;
  };
  analysis: HistoricalPatternResult | null;
  message: string;
}

function lineKey(line: number | null): string {
  return line === null ? "none" : line.toFixed(3);
}

function logicalSnapshotKey(snapshot: HistoricalOddsSnapshot): string {
  return [
    snapshot.canonicalEventId,
    snapshot.provider,
    snapshot.bookmakerKey,
    snapshot.marketKey,
    snapshot.period,
    snapshot.selectionKey,
    lineKey(snapshot.line),
  ].join("|");
}

export function historicalSnapshotId(snapshot: Omit<HistoricalOddsSnapshot, "id">): string {
  const identity = [
    logicalSnapshotKey({ ...snapshot, id: "" }),
    snapshot.snapshotType,
    snapshot.providerUpdatedAt,
    snapshot.price.toFixed(6),
  ].join("|");
  return `snapshot:${createHash("sha256").update(identity).digest("hex").slice(0, 28)}`;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
}

function modeLine(quotes: OddsQuote[]): number | null {
  const counts = new Map<string, number>();
  for (const quote of quotes) {
    if (quote.line === null) continue;
    const key = quote.line.toFixed(3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const selected = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0];
  return selected ? Number(selected[0]) : null;
}

export class HistoricalOddsArchive {
  private readonly resolver = new CanonicalMatchResolver();

  constructor(
    private readonly repository: HistoricalOddsRepository,
    private readonly engine: HistoricalOddsPatternEngine,
    private readonly options: HistoricalOddsArchiveOptions,
  ) {}

  get storage(): "memory" | "json" | "postgres" { return this.repository.storage; }

  async record(quotes: OddsQuote[], fixtures: MatchFixture[], now: Date): Promise<void> {
    const resolvedQuotes = this.resolver.resolveQuotes(quotes);
    const resolvedFixtures = this.resolver.resolveFixtures(fixtures);
    const snapshots = resolvedQuotes
      .map((quote) => this.toSnapshot(quote, now))
      .filter((snapshot): snapshot is HistoricalOddsSnapshot => snapshot !== null);

    const byEvent = new Map<string, HistoricalOddsSnapshot[]>();
    for (const snapshot of snapshots) {
      const group = byEvent.get(snapshot.canonicalEventId) ?? [];
      group.push(snapshot);
      byEvent.set(snapshot.canonicalEventId, group);
    }
    for (const [canonicalEventId, eventSnapshots] of byEvent) {
      const existing = await this.repository.getByCanonicalEvent(canonicalEventId);
      const latestByKey = new Map<string, HistoricalOddsSnapshot>();
      for (const prior of existing.snapshots
        .filter((snapshot) => snapshot.snapshotType === "prematch" || snapshot.snapshotType === "live")
        .sort((a, b) => Date.parse(a.providerUpdatedAt) - Date.parse(b.providerUpdatedAt))) {
        latestByKey.set(logicalSnapshotKey(prior), prior);
      }
      const changed: HistoricalOddsSnapshot[] = [];
      for (const snapshot of eventSnapshots.sort((a, b) => Date.parse(a.providerUpdatedAt) - Date.parse(b.providerUpdatedAt))) {
        const key = logicalSnapshotKey(snapshot);
        const prior = latestByKey.get(key);
        if (prior && prior.price === snapshot.price && prior.line === snapshot.line && prior.phase === snapshot.phase) continue;
        changed.push(snapshot);
        latestByKey.set(key, snapshot);
      }
      const openingKeys = new Set(
        existing.snapshots
          .filter((snapshot) => snapshot.snapshotType === "opening")
          .map(logicalSnapshotKey),
      );
      const openings: HistoricalOddsSnapshot[] = [];
      for (const snapshot of changed) {
        const key = logicalSnapshotKey(snapshot);
        if (snapshot.snapshotType !== "prematch" || openingKeys.has(key)) continue;
        openingKeys.add(key);
        const opening = { ...snapshot, snapshotType: "opening" as const };
        openings.push({ ...opening, id: historicalSnapshotId(opening) });
      }
      await this.repository.saveOddsSnapshots([...changed, ...openings]);
    }

    for (const fixture of resolvedFixtures) {
      const kickoffReached = Date.parse(fixture.commenceTime) <= now.getTime();
      const closingDue = kickoffReached || fixture.phase === "live"
        || fixture.resultStatus === "finished" || fixture.resultStatus === "cancelled";
      if (!closingDue) continue;
      const canonicalEventId = fixture.canonicalEventId!;
      const event = await this.repository.getByCanonicalEvent(canonicalEventId);
      const refs: ProviderEventReference[] = [
        { provider: fixture.provider, eventId: fixture.sourceEventId },
        ...event.snapshots.map((snapshot) => ({ provider: snapshot.provider, eventId: snapshot.sourceEventId })),
      ];
      const historicalFixture: HistoricalCompletedFixture = {
        canonicalEventId,
        providerEventIds: refs,
        league: fixture.leagueName,
        normalizedLeagueKey: this.resolver.normalizeLeague(fixture.leagueName),
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        kickoff: fixture.commenceTime,
        fixtureResult: fixture.resultStatus ?? "scheduled",
        ...(fixture.homeScore === undefined ? {} : { homeScore: fixture.homeScore }),
        ...(fixture.awayScore === undefined ? {} : { awayScore: fixture.awayScore }),
        ...(fixture.halftimeHomeScore === undefined ? {} : { halftimeHomeScore: fixture.halftimeHomeScore }),
        ...(fixture.halftimeAwayScore === undefined ? {} : { halftimeAwayScore: fixture.halftimeAwayScore }),
        archivedAt: now.toISOString(),
      };
      if (fixture.resultStatus === "finished" || fixture.resultStatus === "cancelled") {
        await this.repository.saveCompletedFixture(historicalFixture);
      }
      const closing = selectClosingSnapshots(event.snapshots, historicalFixture, {
        maxProviderAgeSeconds: this.options.maxQuoteAgeSeconds,
      });
      await this.repository.saveOddsSnapshots(closing);
    }
  }

  async diagnostics(quotes: OddsQuote[], now: Date): Promise<HistoricalPatternDiagnostic> {
    const [stats, completeness] = await Promise.all([
      this.repository.getStats(),
      this.repository.getCompletenessDiagnostics(),
    ]);
    const input = this.currentPatternInput(quotes, now);
    const analysis = input ? await this.engine.analyze(input) : null;
    return {
      enabled: true,
      ...stats,
      completeness,
      analysis,
      message: analysis?.status === "ok" ? "Historical pattern hazir" : "Yetersiz tarihsel veri",
    };
  }

  private toSnapshot(quote: OddsQuote, now: Date): HistoricalOddsSnapshot | null {
    if (!quote.canonicalEventId || !Number.isFinite(quote.price) || quote.price <= 1) return null;
    const updatedAt = Date.parse(quote.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    const age = now.getTime() - updatedAt;
    if (age < -60_000 || age > this.options.maxQuoteAgeSeconds * 1_000) return null;
    if (quote.phase === "prematch" && Date.parse(quote.commenceTime) <= now.getTime()) return null;
    const value: Omit<HistoricalOddsSnapshot, "id"> = {
      canonicalEventId: quote.canonicalEventId,
      provider: quote.provider,
      sourceEventId: quote.sourceEventId,
      league: quote.leagueName,
      normalizedLeagueKey: this.resolver.normalizeLeague(quote.leagueName),
      homeTeam: quote.homeTeam,
      awayTeam: quote.awayTeam,
      kickoff: quote.commenceTime,
      snapshotAt: now.toISOString(),
      providerUpdatedAt: new Date(updatedAt).toISOString(),
      snapshotType: quote.phase === "prematch" ? "prematch" : "live",
      phase: quote.phase,
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
    return { ...value, id: historicalSnapshotId(value) };
  }

  private currentPatternInput(quotes: OddsQuote[], now: Date) {
    const prematch = this.resolver.resolveQuotes(quotes).filter(
      (quote) => quote.phase === "prematch" && Date.parse(quote.commenceTime) > now.getTime(),
    );
    const byEvent = new Map<string, OddsQuote[]>();
    for (const quote of prematch) {
      const group = byEvent.get(quote.canonicalEventId!) ?? [];
      group.push(quote);
      byEvent.set(quote.canonicalEventId!, group);
    }
    for (const [canonicalEventId, group] of [...byEvent].sort(
      (a, b) => Date.parse(a[1][0]!.commenceTime) - Date.parse(b[1][0]!.commenceTime),
    )) {
      const ah = group.filter((quote) => quote.marketKey === "handicap" && quote.selectionKey === "home");
      const totals = group.filter((quote) => quote.marketKey === "total_goals" && quote.selectionKey === "over");
      const closingAhLine = modeLine(ah);
      const closingTotalGoalsLine = modeLine(totals);
      if (closingAhLine === null || closingTotalGoalsLine === null) continue;
      const sample = group[0]!;
      return {
        canonicalEventId,
        normalizedLeagueKey: this.resolver.normalizeLeague(sample.leagueName),
        kickoff: sample.commenceTime,
        phase: "prematch" as const,
        direction: "home" as const,
        closingAhLine,
        closingTotalGoalsLine,
        closingPrice: median(ah.filter((quote) => quote.line === closingAhLine).map((quote) => quote.price)),
      };
    }
    return null;
  }
}
