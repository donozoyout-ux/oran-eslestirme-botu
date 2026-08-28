import fs from "node:fs";
import path from "node:path";
import type { MatchFixture, OddsMatch, OddsQuote } from "./domain.js";
import { errorMessage, logger } from "./logger.js";

export interface OddsHistoryEntry {
  capturedAt: string;
  provider: string;
  sourceEventId: string;
  event: string;
  phase: "prematch" | "live";
  marketKey: string;
  market: string;
  period: string;
  selectionKey: string;
  selection: string;
  line: number | null;
  bookmakerKey: string;
  bookmaker: string;
  price: number;
  sourceUpdatedAt: string;
}

export interface AnalysisSignal {
  id: string;
  type: "close_odds" | "odds_drop" | "odds_rise";
  event: string;
  market: string;
  selection: string;
  line: number | null;
  detail: string;
  detectedAt: string;
}

export interface DailySheetSnapshot {
  date: string;
  fixtures: MatchFixture[];
  oddsSnapshotCount: number;
  signalCount: number;
  recentSignals: AnalysisSignal[];
}

interface PersistedDailySheet {
  version: 1;
  date: string;
  fixtures: MatchFixture[];
  oddsHistory: OddsHistoryEntry[];
  signals: AnalysisSignal[];
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

function quoteKey(quote: Pick<OddsQuote, "sourceEventId" | "bookmakerKey" | "marketKey" | "period" | "selectionKey" | "line">): string {
  return [
    quote.sourceEventId,
    quote.bookmakerKey,
    quote.marketKey,
    quote.period,
    quote.selectionKey,
    quote.line ?? "none",
  ].join("|");
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export class JsonDailyMatchSheet {
  private state: PersistedDailySheet;

  constructor(
    private readonly filePath: string,
    private readonly movementThresholdPercent: number,
    private readonly maxHistoryEntries = 10_000,
  ) {
    this.state = this.emptyState(new Date());
    this.load();
    this.ensureCurrentDay(new Date());
  }

  async record(fixtures: MatchFixture[], quotes: OddsQuote[], matches: OddsMatch[], now: Date): Promise<void> {
    this.ensureCurrentDay(now);
    const relevantFixtures = fixtures.filter((fixture) => this.isCurrentFixture(fixture.commenceTime, fixture.phase));
    const relevantQuotes = quotes.filter((quote) => this.isCurrentFixture(quote.commenceTime, quote.phase));
    const relevantEventIds = new Set(relevantQuotes.map((quote) => quote.sourceEventId));
    const relevantMatches = matches.filter((match) => relevantEventIds.has(match.quoteA.sourceEventId));
    this.mergeFixtures(relevantFixtures, relevantQuotes);
    this.recordQuotes(relevantQuotes, now);
    this.recordMatches(relevantMatches);
    await this.persist();
  }

  getSnapshot(): DailySheetSnapshot {
    this.ensureCurrentDay(new Date());
    return {
      date: this.state.date,
      fixtures: [...this.state.fixtures].sort(
        (a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime),
      ),
      oddsSnapshotCount: this.state.oddsHistory.length,
      signalCount: this.state.signals.length,
      recentSignals: [...this.state.signals]
        .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
        .slice(0, 30),
    };
  }

  fixturesCsv(): string {
    const rows: unknown[][] = [[
      "Tarih",
      "Mac Kimligi",
      "Lig",
      "Ev Sahibi",
      "Deplasman",
      "Baslangic",
      "Durum",
      "Son Oran Kontrolu",
      "Sonraki Oran Kontrolu",
      "Kaynak",
    ]];
    for (const fixture of this.getSnapshot().fixtures) {
      rows.push([
        this.state.date,
        fixture.sourceEventId,
        fixture.leagueName,
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.commenceTime,
        fixture.phase,
        fixture.lastOddsCheckAt,
        fixture.nextOddsCheckAt,
        fixture.sourceUrl,
      ]);
    }
    return toCsv(rows);
  }

  oddsHistoryCsv(): string {
    const rows: unknown[][] = [[
      "Kayit Saati",
      "Mac Kimligi",
      "Mac",
      "Durum",
      "Pazar",
      "Periyot",
      "Secim",
      "Cizgi",
      "Bookmaker",
      "Oran",
      "Kaynak Guncelleme Saati",
    ]];
    for (const entry of this.state.oddsHistory) {
      rows.push([
        entry.capturedAt,
        entry.sourceEventId,
        entry.event,
        entry.phase,
        entry.market,
        entry.period,
        entry.selection,
        entry.line,
        entry.bookmaker,
        entry.price,
        entry.sourceUpdatedAt,
      ]);
    }
    return toCsv(rows);
  }

  private mergeFixtures(fixtures: MatchFixture[], quotes: OddsQuote[]): void {
    const merged = new Map(this.state.fixtures.map((fixture) => [fixture.sourceEventId, fixture]));
    for (const fixture of fixtures) merged.set(fixture.sourceEventId, { ...merged.get(fixture.sourceEventId), ...fixture });
    for (const quote of quotes) {
      const existing = merged.get(quote.sourceEventId);
      merged.set(quote.sourceEventId, {
        ...existing,
        provider: quote.provider,
        sourceEventId: quote.sourceEventId,
        leagueName: quote.leagueName,
        homeTeam: quote.homeTeam,
        awayTeam: quote.awayTeam,
        commenceTime: quote.commenceTime,
        phase: quote.phase,
        sourceUrl: quote.sourceUrl,
      });
    }
    this.state.fixtures = [...merged.values()].slice(0, 1_000);
  }

  private recordQuotes(quotes: OddsQuote[], now: Date): void {
    const openingByKey = new Map<string, OddsHistoryEntry>();
    for (const entry of this.state.oddsHistory) {
      const key = [
        entry.sourceEventId,
        entry.bookmakerKey,
        entry.marketKey,
        entry.period,
        entry.selectionKey,
        entry.line ?? "none",
      ].join("|");
      if (!openingByKey.has(key)) openingByKey.set(key, entry);
    }
    const signals = new Map(this.state.signals.map((signal) => [signal.id, signal]));
    for (const quote of quotes) {
      const key = quoteKey(quote);
      const entry: OddsHistoryEntry = {
        capturedAt: now.toISOString(),
        provider: quote.provider,
        sourceEventId: quote.sourceEventId,
        event: `${quote.homeTeam} - ${quote.awayTeam}`,
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
        sourceUpdatedAt: quote.updatedAt,
      };
      const opening = openingByKey.get(key);
      this.state.oddsHistory.push(entry);
      if (!opening) {
        openingByKey.set(key, entry);
        continue;
      }
      const changePercent = ((quote.price - opening.price) / opening.price) * 100;
      if (Math.abs(changePercent) < this.movementThresholdPercent) continue;
      const type: AnalysisSignal["type"] = changePercent < 0 ? "odds_drop" : "odds_rise";
      const direction = changePercent < 0 ? "düştü" : "yükseldi";
      signals.set(`movement:${key}:${type}`, {
        id: `movement:${key}:${type}`,
        type,
        event: entry.event,
        market: entry.market,
        selection: entry.selection,
        line: entry.line,
        detail: `${entry.bookmaker}: ${opening.price.toFixed(2)} → ${entry.price.toFixed(2)} (%${Math.abs(changePercent).toFixed(1)} ${direction})`,
        detectedAt: now.toISOString(),
      });
    }
    if (this.state.oddsHistory.length > this.maxHistoryEntries) {
      this.state.oddsHistory = this.state.oddsHistory.slice(-this.maxHistoryEntries);
    }
    this.state.signals = [...signals.values()].slice(-1_000);
  }

  private recordMatches(matches: OddsMatch[]): void {
    const signals = new Map(this.state.signals.map((signal) => [signal.id, signal]));
    for (const match of matches) {
      signals.set(`close:${match.id}`, {
        id: `close:${match.id}`,
        type: "close_odds",
        event: `${match.quoteA.homeTeam} - ${match.quoteA.awayTeam}`,
        market: match.quoteA.marketName,
        selection: match.quoteA.selectionName,
        line: match.quoteA.line,
        detail: `${match.quoteA.bookmakerName} ${match.quoteA.price.toFixed(2)} ↔ ${match.quoteB.bookmakerName} ${match.quoteB.price.toFixed(2)} (fark %${match.relativeDifferencePercent.toFixed(2)})`,
        detectedAt: match.detectedAt,
      });
    }
    this.state.signals = [...signals.values()].slice(-1_000);
  }

  private emptyState(now: Date): PersistedDailySheet {
    return { version: 1, date: istanbulDayKey(now), fixtures: [], oddsHistory: [], signals: [] };
  }

  private isCurrentFixture(commenceTime: string, phase: "prematch" | "live"): boolean {
    const parsed = new Date(commenceTime);
    return phase === "live" || (Number.isFinite(parsed.getTime()) && istanbulDayKey(parsed) === this.state.date);
  }

  private ensureCurrentDay(now: Date): void {
    if (this.state.date !== istanbulDayKey(now)) this.state = this.emptyState(now);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedDailySheet>;
      if (
        parsed.version !== 1 ||
        typeof parsed.date !== "string" ||
        !Array.isArray(parsed.fixtures) ||
        !Array.isArray(parsed.oddsHistory) ||
        !Array.isArray(parsed.signals)
      ) {
        return;
      }
      this.state = parsed as PersistedDailySheet;
    } catch (error) {
      logger.warn("Gunluk mac tablosu okunamadi; bos tabloyla baslanacak.", { error: errorMessage(error) });
    }
  }

  private async persist(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}
