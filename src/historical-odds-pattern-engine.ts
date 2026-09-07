import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "./historical-odds.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";

export type HistoricalPatternPhase = "prematch" | "halftime";
export type HistoricalDataQuality = "insufficient" | "very_low" | "low" | "medium" | "high";

export interface HistoricalPatternInput {
  canonicalEventId: string;
  normalizedLeagueKey: string;
  kickoff: string;
  phase: HistoricalPatternPhase;
  direction: "home" | "away";
  closingAhLine: number | null;
  closingTotalGoalsLine: number | null;
  closingPrice?: number;
  halftimeHomeScore?: number;
  halftimeAwayScore?: number;
}

export interface HistoricalPatternOptions {
  minSampleSize?: number;
  priceTolerancePercent?: number;
  lineTolerance?: number;
  recencyHalfLifeDays?: number;
  requireSameLeague?: boolean;
  maxEvents?: number;
}

export interface HistoricalOutcomeRates {
  homeWinPercent: number;
  drawPercent: number;
  awayWinPercent: number;
  over15Percent: number;
  over25Percent: number;
  over35Percent: number;
  bttsYesPercent: number;
  averageGoals: number;
}

export interface HistoricalMatchedEvent {
  canonicalEventId: string;
  kickoff: string;
  ahLine: number | null;
  totalGoalsLine: number | null;
  similarityScore: number;
  recencyWeight: number;
  exactLineMatch: boolean;
}

export interface HistoricalPatternResult extends HistoricalOutcomeRates {
  status: "ok" | "insufficient_data";
  phase: HistoricalPatternPhase;
  sampleSize: number;
  effectiveSampleSize: number;
  matchedEvents: HistoricalMatchedEvent[];
  exactLineMatches: number;
  nearLineMatches: number;
  medianGoals: number;
  weighted: HistoricalOutcomeRates;
  confidenceScore: number;
  dataQuality: HistoricalDataQuality;
  filtersApplied: string[];
}

interface MarketShape {
  ahLine: number | null;
  totalLine: number | null;
  ahPrice: number | null;
  completeness: number;
}

interface Candidate {
  fixture: HistoricalCompletedFixture;
  shape: MarketShape;
  similarity: number;
  recency: number;
  weight: number;
  exact: boolean;
}

const EMPTY_RATES: HistoricalOutcomeRates = {
  homeWinPercent: 0,
  drawPercent: 0,
  awayWinPercent: 0,
  over15Percent: 0,
  over25Percent: 0,
  over35Percent: 0,
  bttsYesPercent: 0,
  averageGoals: 0,
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function modeLine(snapshots: HistoricalOddsSnapshot[]): { line: number | null; price: number | null } {
  const withLine = snapshots.filter((snapshot) => snapshot.line !== null);
  if (withLine.length === 0) return { line: null, price: null };
  const groups = new Map<string, HistoricalOddsSnapshot[]>();
  for (const snapshot of withLine) {
    const key = snapshot.line!.toFixed(3);
    const group = groups.get(key) ?? [];
    group.push(snapshot);
    groups.set(key, group);
  }
  const selected = [...groups.entries()].sort((a, b) =>
    b[1].length - a[1].length || Number(a[0]) - Number(b[0]),
  )[0];
  if (!selected) return { line: null, price: null };
  return { line: Number(selected[0]), price: median(selected[1].map((snapshot) => snapshot.price)) };
}

function marketShape(snapshots: HistoricalOddsSnapshot[], direction: "home" | "away"): MarketShape {
  const closing = snapshots.filter(
    (snapshot) => snapshot.snapshotType === "closing" && snapshot.phase === "prematch" && snapshot.period === "full_time",
  );
  const ah = modeLine(closing.filter(
    (snapshot) => snapshot.marketKey === "handicap" && snapshot.selectionKey === direction,
  ));
  const total = modeLine(closing.filter(
    (snapshot) => snapshot.marketKey === "total_goals" && snapshot.selectionKey === "over",
  ));
  return {
    ahLine: ah.line,
    totalLine: total.line,
    ahPrice: ah.price,
    completeness: Number(ah.line !== null) + Number(total.line !== null),
  };
}

function lineSimilarity(input: number | null, candidate: number | null, tolerance: number): number | null {
  if (input === null) return 1;
  if (candidate === null) return null;
  const delta = Math.abs(input - candidate);
  if (delta > tolerance) return null;
  return tolerance === 0 ? Number(delta < 0.001) : Math.max(0, 1 - delta / tolerance);
}

function outcomeRates(candidates: Candidate[], weighted: boolean): HistoricalOutcomeRates {
  const denominator = candidates.reduce((sum, candidate) => sum + (weighted ? candidate.weight : 1), 0);
  if (denominator <= 0) return { ...EMPTY_RATES };
  const sum = (predicate: (candidate: Candidate) => boolean): number => candidates.reduce(
    (total, candidate) => total + (predicate(candidate) ? (weighted ? candidate.weight : 1) : 0),
    0,
  );
  const goals = candidates.reduce((total, candidate) => {
    const value = (candidate.fixture.homeScore ?? 0) + (candidate.fixture.awayScore ?? 0);
    return total + value * (weighted ? candidate.weight : 1);
  }, 0);
  const percent = (value: number): number => round((value / denominator) * 100);
  return {
    homeWinPercent: percent(sum((candidate) => candidate.fixture.homeScore! > candidate.fixture.awayScore!)),
    drawPercent: percent(sum((candidate) => candidate.fixture.homeScore === candidate.fixture.awayScore)),
    awayWinPercent: percent(sum((candidate) => candidate.fixture.homeScore! < candidate.fixture.awayScore!)),
    over15Percent: percent(sum((candidate) => candidate.fixture.homeScore! + candidate.fixture.awayScore! > 1.5)),
    over25Percent: percent(sum((candidate) => candidate.fixture.homeScore! + candidate.fixture.awayScore! > 2.5)),
    over35Percent: percent(sum((candidate) => candidate.fixture.homeScore! + candidate.fixture.awayScore! > 3.5)),
    bttsYesPercent: percent(sum((candidate) => candidate.fixture.homeScore! > 0 && candidate.fixture.awayScore! > 0)),
    averageGoals: round(goals / denominator),
  };
}

function quality(sampleSize: number): HistoricalDataQuality {
  if (sampleSize < 10) return "insufficient";
  if (sampleSize < 30) return "very_low";
  if (sampleSize < 50) return "low";
  if (sampleSize < 100) return "medium";
  return "high";
}

export class HistoricalOddsPatternEngine {
  private readonly options: Required<HistoricalPatternOptions>;

  constructor(
    private readonly repository: HistoricalOddsRepository,
    options: HistoricalPatternOptions = {},
  ) {
    this.options = {
      minSampleSize: options.minSampleSize ?? 10,
      priceTolerancePercent: options.priceTolerancePercent ?? 10,
      lineTolerance: options.lineTolerance ?? 0.5,
      recencyHalfLifeDays: options.recencyHalfLifeDays ?? 730,
      requireSameLeague: options.requireSameLeague ?? true,
      maxEvents: options.maxEvents ?? 5_000,
    };
  }

  async analyze(input: HistoricalPatternInput): Promise<HistoricalPatternResult> {
    const filtersApplied = [
      `phase=${input.phase}`,
      `league=${input.normalizedLeagueKey}`,
      `line_tolerance=${this.options.lineTolerance}`,
      `price_tolerance_percent=${this.options.priceTolerancePercent}`,
      `recency_half_life_days=${this.options.recencyHalfLifeDays}`,
      `exclude_event=${input.canonicalEventId}`,
    ];
    if (input.phase === "halftime") {
      filtersApplied.push(`halftime_score=${input.halftimeHomeScore ?? "?"}-${input.halftimeAwayScore ?? "?"}`);
    }

    if (
      input.closingAhLine === null || input.closingTotalGoalsLine === null ||
      input.phase === "halftime" && (input.halftimeHomeScore === undefined || input.halftimeAwayScore === undefined)
    ) return this.empty(input.phase, filtersApplied);

    const fixtures = await this.repository.queryCompletedFixtures({
      ...(this.options.requireSameLeague ? { normalizedLeagueKey: input.normalizedLeagueKey } : {}),
      before: input.kickoff,
      excludeCanonicalEventId: input.canonicalEventId,
      limit: this.options.maxEvents,
    });
    const candidates: Candidate[] = [];
    const inputKickoff = Date.parse(input.kickoff);

    for (const fixture of fixtures) {
      if (fixture.fixtureResult !== "finished") continue;
      if (fixture.resultConflict) continue;
      if (fixture.homeScore === undefined || fixture.awayScore === undefined) continue;
      if (this.options.requireSameLeague && fixture.normalizedLeagueKey !== input.normalizedLeagueKey) continue;
      if (
        input.phase === "halftime" &&
        (fixture.halftimeHomeScore !== input.halftimeHomeScore || fixture.halftimeAwayScore !== input.halftimeAwayScore)
      ) continue;
      const event = await this.repository.getByCanonicalEvent(fixture.canonicalEventId);
      const shape = marketShape(event.snapshots, input.direction);
      if (shape.ahLine === null || shape.totalLine === null) continue;
      const ahSimilarity = lineSimilarity(input.closingAhLine, shape.ahLine, this.options.lineTolerance);
      const totalSimilarity = lineSimilarity(input.closingTotalGoalsLine, shape.totalLine, this.options.lineTolerance);
      if (ahSimilarity === null || totalSimilarity === null) continue;
      if (input.closingPrice !== undefined) {
        if (shape.ahPrice === null) continue;
        const difference = Math.abs(shape.ahPrice - input.closingPrice) / input.closingPrice * 100;
        if (difference > this.options.priceTolerancePercent) continue;
      }
      const expectedParts = Number(input.closingAhLine !== null) + Number(input.closingTotalGoalsLine !== null);
      const completeness = expectedParts === 0 ? 0 : Math.min(1, shape.completeness / expectedParts);
      const lineQuality = (ahSimilarity + totalSimilarity) / 2;
      const priceQuality = input.closingPrice === undefined || shape.ahPrice === null
        ? 1
        : Math.max(0, 1 - (Math.abs(shape.ahPrice - input.closingPrice) / input.closingPrice * 100) / this.options.priceTolerancePercent);
      const leagueQuality = fixture.normalizedLeagueKey === input.normalizedLeagueKey ? 1 : 0.5;
      const similarity = 0.55 * lineQuality + 0.2 * priceQuality + 0.15 * completeness + 0.1 * leagueQuality;
      const ageDays = Math.max(0, (inputKickoff - Date.parse(fixture.kickoff)) / 86_400_000);
      const recency = 0.5 ** (ageDays / this.options.recencyHalfLifeDays);
      const exact = (input.closingAhLine === null || Math.abs(input.closingAhLine - shape.ahLine!) < 0.001)
        && (input.closingTotalGoalsLine === null || Math.abs(input.closingTotalGoalsLine - shape.totalLine!) < 0.001);
      candidates.push({ fixture, shape, similarity, recency, weight: similarity * recency, exact });
    }

    const sampleSize = candidates.length;
    const exactLineMatches = candidates.filter((candidate) => candidate.exact).length;
    const nearLineMatches = sampleSize - exactLineMatches;
    const weights = candidates.map((candidate) => candidate.weight);
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    const effectiveSampleSize = weights.length === 0
      ? 0
      : round((weightSum ** 2) / weights.reduce((sum, value) => sum + value ** 2, 0));
    const raw = outcomeRates(candidates, false);
    const weightedRates = outcomeRates(candidates, true);
    const exactRatio = sampleSize ? exactLineMatches / sampleSize : 0;
    const averageSimilarity = sampleSize ? candidates.reduce((sum, value) => sum + value.similarity, 0) / sampleSize : 0;
    const averageCompleteness = sampleSize ? candidates.reduce((sum, value) => sum + value.shape.completeness / 2, 0) / sampleSize : 0;
    const averageRecency = sampleSize ? candidates.reduce((sum, value) => sum + value.recency, 0) / sampleSize : 0;
    const sampleScore = Math.min(sampleSize / 100, 1);
    let confidenceScore = Math.round(
      sampleScore * 40 + exactRatio * 20 + averageSimilarity * 15 + averageCompleteness * 10 + 10 + averageRecency * 5,
    );
    if (sampleSize < this.options.minSampleSize) confidenceScore = Math.min(confidenceScore, 24);

    return {
      status: sampleSize < this.options.minSampleSize ? "insufficient_data" : "ok",
      phase: input.phase,
      sampleSize,
      effectiveSampleSize,
      matchedEvents: candidates.map((candidate) => ({
        canonicalEventId: candidate.fixture.canonicalEventId,
        kickoff: candidate.fixture.kickoff,
        ahLine: candidate.shape.ahLine,
        totalGoalsLine: candidate.shape.totalLine,
        similarityScore: round(candidate.similarity * 100),
        recencyWeight: round(candidate.recency, 4),
        exactLineMatch: candidate.exact,
      })),
      exactLineMatches,
      nearLineMatches,
      ...raw,
      medianGoals: round(median(candidates.map((candidate) => candidate.fixture.homeScore! + candidate.fixture.awayScore!))),
      weighted: weightedRates,
      confidenceScore: Math.max(0, Math.min(100, confidenceScore)),
      dataQuality: quality(sampleSize),
      filtersApplied,
    };
  }

  private empty(phase: HistoricalPatternPhase, filtersApplied: string[]): HistoricalPatternResult {
    return {
      status: "insufficient_data",
      phase,
      sampleSize: 0,
      effectiveSampleSize: 0,
      matchedEvents: [],
      exactLineMatches: 0,
      nearLineMatches: 0,
      ...EMPTY_RATES,
      medianGoals: 0,
      weighted: { ...EMPTY_RATES },
      confidenceScore: 0,
      dataQuality: "insufficient",
      filtersApplied,
    };
  }
}
