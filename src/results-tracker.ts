import fs from "node:fs";
import path from "node:path";
import type { MarketKey, MatchFixture, OddsQuote, PeriodKey } from "./domain.js";
import { errorMessage, logger } from "./logger.js";

export type ResultPickStatus = "pending" | "won" | "lost" | "void" | "unsupported";
export type ResultPickDecision = "GÜÇLÜ ADAY" | "İZLE";

export interface ResultPick {
  id: string;
  date: string;
  eventKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  marketKey: MarketKey;
  market: string;
  period: PeriodKey;
  selectionKey: string;
  selection: string;
  line: number | null;
  bookmaker: string;
  price: number;
  fairOdds: number;
  valuePercent: number;
  sourceCount: number;
  confidenceScore: number;
  decision: ResultPickDecision;
  detectedAt: string;
  status: ResultPickStatus;
  finalScore?: string;
  settledAt?: string;
  settlementSource?: string;
}

export interface ResultsSummary {
  total: number;
  settled: number;
  won: number;
  lost: number;
  void: number;
  pending: number;
  unsupported: number;
  hitRatePercent: number | null;
}

export interface ResultsSnapshot {
  picks: ResultPick[];
  summary: ResultsSummary;
  updatedAt: string;
}

export interface ResultsMirror {
  sync(snapshot: ResultsSnapshot): Promise<void>;
}

interface PersistedResultsState {
  version: 1;
  picks: ResultPick[];
}

interface Candidate {
  eventKey: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  marketKey: MarketKey;
  market: string;
  period: PeriodKey;
  selectionKey: string;
  selection: string;
  line: number | null;
  bookmaker: string;
  price: number;
  fairOdds: number;
  valuePercent: number;
  sourceCount: number;
  confidenceScore: number;
  decision: ResultPickDecision;
}

export interface ResultsTrackerOptions {
  mirror?: ResultsMirror;
  mirrorSyncMinutes?: number;
  maxPicks?: number;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\b(fc|cf|afc|sc|club)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function eventKey(homeTeam: string, awayTeam: string): string {
  return `${normalizeName(homeTeam)}|${normalizeName(awayTeam)}`;
}

function istanbulDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1]! + sorted[middle]!) / 2;
  return sorted[middle]!;
}

function candidateGroups(quotes: OddsQuote[], now: Date): Candidate[] {
  const latestByBookmaker = new Map<string, OddsQuote>();
  for (const quote of quotes) {
    if (quote.phase !== "prematch") continue;
    if (!Number.isFinite(quote.price) || quote.price <= 1) continue;
    const kickoff = Date.parse(quote.commenceTime);
    if (!Number.isFinite(kickoff) || kickoff <= now.getTime()) continue;
    const key = [
      eventKey(quote.homeTeam, quote.awayTeam),
      quote.marketKey,
      quote.period,
      quote.selectionKey,
      quote.line ?? "",
      quote.provider,
      quote.bookmakerKey,
    ].join("|");
    const existing = latestByBookmaker.get(key);
    if (!existing || Date.parse(quote.updatedAt) >= Date.parse(existing.updatedAt)) latestByBookmaker.set(key, quote);
  }

  const groups = new Map<string, OddsQuote[]>();
  for (const quote of latestByBookmaker.values()) {
    const key = [
      eventKey(quote.homeTeam, quote.awayTeam),
      quote.marketKey,
      quote.period,
      quote.selectionKey,
      quote.line ?? "",
    ].join("|");
    const list = groups.get(key) ?? [];
    list.push(quote);
    groups.set(key, list);
  }

  const candidates: Candidate[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (!first) continue;
    const prices = list.map((quote) => quote.price).filter((price) => Number.isFinite(price) && price > 1);
    if (prices.length === 0) continue;
    const best = [...list].sort((a, b) => b.price - a.price)[0]!;
    const fairOdds = median(prices);
    const valuePercent = ((best.price / fairOdds) - 1) * 100;
    const dispersionPercent = fairOdds > 0 ? ((Math.max(...prices) - Math.min(...prices)) / fairOdds) * 100 : 100;
    const sourceCount = new Set(list.map((quote) => `${quote.provider}:${quote.bookmakerKey}`)).size;
    const coverageScore = Math.min(sourceCount / 5, 1) * 35;
    const agreementScore = Math.max(0, 1 - dispersionPercent / 12) * 35;
    const valueScore = Math.min(Math.max(valuePercent, 0) / 8, 1) * 30;
    const confidenceScore = Math.round(coverageScore + agreementScore + valueScore);
    if (confidenceScore < 58 || valuePercent <= 0) continue;
    const decision: ResultPickDecision = confidenceScore >= 75 && valuePercent >= 2 && sourceCount >= 3
      ? "GÜÇLÜ ADAY"
      : "İZLE";
    candidates.push({
      eventKey: eventKey(first.homeTeam, first.awayTeam),
      date: istanbulDayKey(new Date(first.commenceTime)),
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      commenceTime: first.commenceTime,
      marketKey: first.marketKey,
      market: first.marketName,
      period: first.period,
      selectionKey: first.selectionKey,
      selection: first.selectionName,
      line: first.line,
      bookmaker: best.bookmakerName,
      price: best.price,
      fairOdds,
      valuePercent,
      sourceCount,
      confidenceScore,
      decision,
    });
  }
  return candidates;
}

function bestCandidatePerMatch(quotes: OddsQuote[], now: Date): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const candidate of candidateGroups(quotes, now)) {
    const key = `${candidate.date}:${candidate.eventKey}`;
    const existing = best.get(key);
    if (!existing || candidate.confidenceScore > existing.confidenceScore ||
      (candidate.confidenceScore === existing.confidenceScore && candidate.valuePercent > existing.valuePercent)) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}

function scoreOutcome(pick: ResultPick, homeScore: number, awayScore: number): ResultPickStatus {
  if (pick.period !== "full_time") return "unsupported";
  const total = homeScore + awayScore;
  switch (pick.marketKey) {
    case "match_winner_3way":
    case "match_winner_2way": {
      const winner = homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";
      return pick.selectionKey === winner ? "won" : "lost";
    }
    case "total_goals": {
      if (pick.line === null) return "unsupported";
      if (total === pick.line) return "void";
      if (pick.selectionKey === "over") return total > pick.line ? "won" : "lost";
      if (pick.selectionKey === "under") return total < pick.line ? "won" : "lost";
      return "unsupported";
    }
    case "both_teams_to_score": {
      const yes = homeScore > 0 && awayScore > 0;
      if (pick.selectionKey === "yes") return yes ? "won" : "lost";
      if (pick.selectionKey === "no") return yes ? "lost" : "won";
      return "unsupported";
    }
    case "double_chance": {
      const home = homeScore > awayScore;
      const draw = homeScore === awayScore;
      const away = homeScore < awayScore;
      if (pick.selectionKey === "home_or_draw") return home || draw ? "won" : "lost";
      if (pick.selectionKey === "draw_or_away") return draw || away ? "won" : "lost";
      if (pick.selectionKey === "home_or_away") return home || away ? "won" : "lost";
      return "unsupported";
    }
    case "handicap": {
      if (pick.line === null) return "unsupported";
      const base = pick.selectionKey === "home"
        ? homeScore - awayScore
        : pick.selectionKey === "away"
          ? awayScore - homeScore
          : Number.NaN;
      if (!Number.isFinite(base)) return "unsupported";
      const adjusted = base + pick.line;
      if (adjusted === 0) return "void";
      return adjusted > 0 ? "won" : "lost";
    }
    case "correct_score": {
      const text = `${pick.selectionKey} ${pick.selection}`;
      const match = text.match(/(\d+)\s*[-:]\s*(\d+)/);
      if (!match) return "unsupported";
      return Number(match[1]) === homeScore && Number(match[2]) === awayScore ? "won" : "lost";
    }
    default:
      return "unsupported";
  }
}

function summaryFor(picks: ResultPick[]): ResultsSummary {
  const won = picks.filter((pick) => pick.status === "won").length;
  const lost = picks.filter((pick) => pick.status === "lost").length;
  const voidCount = picks.filter((pick) => pick.status === "void").length;
  const pending = picks.filter((pick) => pick.status === "pending").length;
  const unsupported = picks.filter((pick) => pick.status === "unsupported").length;
  const settled = won + lost + voidCount;
  const graded = won + lost;
  return {
    total: picks.length,
    settled,
    won,
    lost,
    void: voidCount,
    pending,
    unsupported,
    hitRatePercent: graded > 0 ? (won / graded) * 100 : null,
  };
}

export class ResultsTracker {
  private state: PersistedResultsState = { version: 1, picks: [] };
  private readonly mirror?: ResultsMirror;
  private readonly mirrorSyncMinutes: number;
  private readonly maxPicks: number;
  private lastMirrorAttemptAt: number | null = null;

  constructor(private readonly filePath: string, options: ResultsTrackerOptions = {}) {
    this.mirror = options.mirror;
    this.mirrorSyncMinutes = Math.max(1, options.mirrorSyncMinutes ?? 5);
    this.maxPicks = Math.max(50, options.maxPicks ?? 500);
    this.load();
  }

  async record(quotes: OddsQuote[], fixtures: MatchFixture[], now = new Date()): Promise<void> {
    let changed = this.capturePicks(quotes, now);
    if (this.settlePicks(fixtures, now)) changed = true;
    if (this.state.picks.length > this.maxPicks) {
      this.state.picks = this.state.picks
        .sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt))
        .slice(-this.maxPicks);
      changed = true;
    }
    if (changed) await this.persist();
    await this.syncIfDue(now, changed);
  }

  getSnapshot(now = new Date()): ResultsSnapshot {
    const picks = [...this.state.picks].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
    return { picks, summary: summaryFor(picks), updatedAt: now.toISOString() };
  }

  private capturePicks(quotes: OddsQuote[], now: Date): boolean {
    const existingIds = new Set(this.state.picks.map((pick) => pick.id));
    let changed = false;
    for (const candidate of bestCandidatePerMatch(quotes, now)) {
      const id = `${candidate.date}:${candidate.eventKey}`;
      if (existingIds.has(id)) continue;
      this.state.picks.push({
        id,
        date: candidate.date,
        eventKey: candidate.eventKey,
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        commenceTime: candidate.commenceTime,
        marketKey: candidate.marketKey,
        market: candidate.market,
        period: candidate.period,
        selectionKey: candidate.selectionKey,
        selection: candidate.selection,
        line: candidate.line,
        bookmaker: candidate.bookmaker,
        price: candidate.price,
        fairOdds: candidate.fairOdds,
        valuePercent: candidate.valuePercent,
        sourceCount: candidate.sourceCount,
        confidenceScore: candidate.confidenceScore,
        decision: candidate.decision,
        detectedAt: now.toISOString(),
        status: "pending",
      });
      existingIds.add(id);
      changed = true;
    }
    return changed;
  }

  private settlePicks(fixtures: MatchFixture[], now: Date): boolean {
    const completed = fixtures.filter((fixture) =>
      fixture.resultStatus === "finished" || fixture.resultStatus === "cancelled",
    );
    let changed = false;
    for (const pick of this.state.picks) {
      if (pick.status !== "pending") continue;
      const kickoff = Date.parse(pick.commenceTime);
      const fixture = completed.find((candidate) => {
        if (eventKey(candidate.homeTeam, candidate.awayTeam) !== pick.eventKey) return false;
        const candidateKickoff = Date.parse(candidate.commenceTime);
        return !Number.isFinite(kickoff) || !Number.isFinite(candidateKickoff) || Math.abs(candidateKickoff - kickoff) <= 6 * 60 * 60_000;
      });
      if (!fixture) continue;
      pick.finalScore = Number.isFinite(fixture.homeScore) && Number.isFinite(fixture.awayScore)
        ? `${fixture.homeScore}-${fixture.awayScore}`
        : "-";
      pick.settledAt = now.toISOString();
      pick.settlementSource = fixture.provider;
      if (fixture.resultStatus === "cancelled") {
        pick.status = "void";
      } else if (fixture.homeScore === undefined || fixture.awayScore === undefined) {
        pick.status = "unsupported";
      } else {
        pick.status = scoreOutcome(pick, fixture.homeScore, fixture.awayScore);
      }
      changed = true;
    }
    return changed;
  }

  private async syncIfDue(now: Date, changed: boolean): Promise<void> {
    if (!this.mirror) return;
    const due = this.lastMirrorAttemptAt === null || now.getTime() - this.lastMirrorAttemptAt >= this.mirrorSyncMinutes * 60_000;
    if (!changed && !due) return;
    this.lastMirrorAttemptAt = now.getTime();
    try {
      await this.mirror.sync(this.getSnapshot(now));
    } catch (error) {
      logger.warn("Sonuclar Google Sheet senkronizasyonu basarisiz.", { error: errorMessage(error) });
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedResultsState>;
      if (parsed.version !== 1 || !Array.isArray(parsed.picks)) return;
      this.state = { version: 1, picks: parsed.picks as ResultPick[] };
    } catch (error) {
      logger.warn("Sonuc takip dosyasi okunamadi; bos kayitla baslanacak.", { error: errorMessage(error) });
    }
  }

  private async persist(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}

export const resultsTrackerInternals = { eventKey, scoreOutcome, summaryFor, bestCandidatePerMatch };
