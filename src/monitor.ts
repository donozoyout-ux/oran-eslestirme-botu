import type { AlertStore, Notifier, OddsProvider, RunSummary } from "./domain.js";
import { findOddsMatches } from "./comparison-engine.js";
import { rankCouponCandidates, type CouponCandidate } from "./coupon-engine.js";
import type { DailySheetSnapshot, JsonDailyMatchSheet } from "./daily-match-sheet.js";
import { errorMessage, logger } from "./logger.js";
import { analyzeOddsMarket, type ArbitrageOpportunity, type SelectionConsensus } from "./market-analysis-engine.js";

export interface MonitorOptions {
  tolerancePercent: number;
  maxQuoteAgeSeconds: number;
  pollIntervalSeconds: number;
}

export interface MonitorStatus {
  provider: string;
  notifier: string;
  running: boolean;
  startedAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastRun: RunSummary | null;
  recentQuotes: Array<{
    event: string;
    phase: "prematch" | "live";
    market: string;
    selection: string;
    line: number | null;
    bookmaker: string;
    price: number;
    updatedAt: string;
  }>;
  recentMatches: Array<{
    event: string;
    phase: "prematch" | "live";
    market: string;
    selection: string;
    line: number | null;
    bookmakerA: string;
    priceA: number;
    bookmakerB: string;
    priceB: number;
    differencePercent: number;
    detectedAt: string;
  }>;
  marketAnalysis: { consensus: SelectionConsensus[]; arbitrage: ArbitrageOpportunity[] };
  couponCandidates: CouponCandidate[];
  dailySheet: DailySheetSnapshot;
  totals: { runs: number; alertsSent: number; errors: number };
}

export class OddsMonitor {
  private activeRun: Promise<RunSummary> | null = null;
  private scheduler: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly statusValue: MonitorStatus;

  constructor(
    private readonly provider: OddsProvider,
    private readonly notifier: Notifier,
    private readonly alertStore: AlertStore,
    private readonly options: MonitorOptions,
    private readonly dailySheet: JsonDailyMatchSheet,
  ) {
    this.statusValue = {
      provider: provider.name,
      notifier: notifier.name,
      running: false,
      startedAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastRun: null,
      recentQuotes: [],
      recentMatches: [],
      marketAnalysis: { consensus: [], arbitrage: [] },
      couponCandidates: [],
      dailySheet: dailySheet.getSnapshot(),
      totals: { runs: 0, alertsSent: 0, errors: 0 },
    };
  }

  start(): void {
    this.stopped = false;
    void this.runLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.scheduler) clearTimeout(this.scheduler);
    this.scheduler = null;
  }

  getStatus(): MonitorStatus {
    this.statusValue.dailySheet = this.dailySheet.getSnapshot();
    return JSON.parse(JSON.stringify(this.statusValue)) as MonitorStatus;
  }

  getDailyFixturesCsv(): string {
    return this.dailySheet.fixturesCsv();
  }

  getOddsHistoryCsv(): string {
    return this.dailySheet.oddsHistoryCsv();
  }

  runOnce(): Promise<RunSummary> {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.execute().finally(() => {
      this.activeRun = null;
      this.statusValue.running = false;
    });
    return this.activeRun;
  }

  private async runLoop(): Promise<void> {
    try {
      await this.runOnce();
    } catch {
      // Error is already logged by execute(). Scheduler must continue.
    }
    if (this.stopped) return;
    this.scheduler = setTimeout(() => void this.runLoop(), this.options.pollIntervalSeconds * 1000);
  }

  private async execute(): Promise<RunSummary> {
    const startedAt = new Date();
    this.statusValue.running = true;

    try {
      const quotes = await this.provider.fetchQuotes();
      const comparisonTime = new Date();
      const comparison = findOddsMatches(
        quotes,
        {
          tolerancePercent: this.options.tolerancePercent,
          maxQuoteAgeSeconds: this.options.maxQuoteAgeSeconds,
        },
        comparisonTime,
      );
      const marketAnalysis = analyzeOddsMarket(comparison.freshQuotes, {}, comparisonTime);

      this.statusValue.marketAnalysis = {
        consensus: marketAnalysis.consensus.slice(0, 50),
        arbitrage: marketAnalysis.arbitrage.slice(0, 20),
      };
      this.statusValue.couponCandidates = rankCouponCandidates(marketAnalysis.consensus, 5);

      let alertsSent = 0;
      let movementAlertsSent = 0;
      let marketAnalysisAlertsSent = 0;
      let alertsSuppressed = 0;

      try {
        const sheetResult = await this.dailySheet.record(
          this.provider.getLastFixtures?.() ?? [],
          comparison.freshQuotes,
          comparison.matches,
          comparisonTime,
        );
        this.statusValue.dailySheet = this.dailySheet.getSnapshot();

        if (this.notifier.sendAnalysisSignal) {
          for (const signal of sheetResult.pendingMovementSignals) {
            try {
              await this.notifier.sendAnalysisSignal(signal);
              await this.dailySheet.markSignalNotified(signal.id, new Date());
              alertsSent += 1;
              movementAlertsSent += 1;
            } catch (error) {
              this.statusValue.totals.errors += 1;
              logger.error("Oran hareketi bildirimi gonderilemedi.", {
                signalId: signal.id,
                error: errorMessage(error),
              });
            }
          }
        }
      } catch (error) {
        this.statusValue.totals.errors += 1;
        logger.warn("Gunluk mac tablosu kaydedilemedi.", { error: errorMessage(error) });
      }

      if (this.notifier.sendAnalysisSignal) {
        for (const signal of marketAnalysis.alertSignals) {
          const now = new Date();
          if (!this.alertStore.shouldSend(signal.id, now)) {
            alertsSuppressed += 1;
            continue;
          }
          try {
            await this.notifier.sendAnalysisSignal(signal);
            await this.alertStore.markSent(signal.id, now);
            alertsSent += 1;
            marketAnalysisAlertsSent += 1;
          } catch (error) {
            this.statusValue.totals.errors += 1;
            logger.error("Piyasa analizi bildirimi gonderilemedi.", {
              signalId: signal.id,
              error: errorMessage(error),
            });
          }
        }
      }

      for (const match of comparison.matches) {
        const now = new Date();
        if (!this.alertStore.shouldSend(match.id, now)) {
          alertsSuppressed += 1;
          continue;
        }
        try {
          await this.notifier.send(match);
          await this.alertStore.markSent(match.id, now);
          alertsSent += 1;
        } catch (error) {
          this.statusValue.totals.errors += 1;
          logger.error("Bildirim gonderilemedi.", { alertId: match.id, error: errorMessage(error) });
        }
      }

      const finishedAt = new Date();
      const summary: RunSummary = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        quotesFetched: quotes.length,
        quotesFresh: comparison.freshQuotes.length,
        matchesFound: comparison.matches.length,
        alertsSent,
        movementAlertsSent,
        marketAnalysisAlertsSent,
        consensusSignalsFound: marketAnalysis.consensus.length,
        arbitrageFound: marketAnalysis.arbitrage.length,
        alertsSuppressed,
      };

      this.statusValue.lastRun = summary;
      this.statusValue.recentQuotes = comparison.freshQuotes.slice(0, 40).map((quote) => ({
        event: `${quote.homeTeam} - ${quote.awayTeam}`,
        phase: quote.phase,
        market: quote.marketName,
        selection: quote.selectionName,
        line: quote.line,
        bookmaker: quote.bookmakerName,
        price: quote.price,
        updatedAt: quote.updatedAt,
      }));
      this.statusValue.recentMatches = comparison.matches.slice(0, 20).map((match) => ({
        event: `${match.quoteA.homeTeam} - ${match.quoteA.awayTeam}`,
        phase: match.phase,
        market: match.quoteA.marketName,
        selection: match.quoteA.selectionName,
        line: match.quoteA.line,
        bookmakerA: match.quoteA.bookmakerName,
        priceA: match.quoteA.price,
        bookmakerB: match.quoteB.bookmakerName,
        priceB: match.quoteB.price,
        differencePercent: Number(match.relativeDifferencePercent.toFixed(2)),
        detectedAt: match.detectedAt,
      }));
      this.statusValue.lastSuccessAt = finishedAt.toISOString();
      this.statusValue.lastError = null;
      this.statusValue.totals.runs += 1;
      this.statusValue.totals.alertsSent += alertsSent;
      logger.info("Oran taramasi tamamlandi.", { ...summary });
      return summary;
    } catch (error) {
      const message = errorMessage(error);

      // Provider tarafinda tamamen hata olsa bile Sheet aynasini guncelle. Böylece
      // bitmis/stale maclar bir veri kaynagi timeout oldu diye tabloda takili kalmaz.
      try {
        const cleanupTime = new Date();
        await this.dailySheet.record(this.provider.getLastFixtures?.() ?? [], [], [], cleanupTime);
        this.statusValue.dailySheet = this.dailySheet.getSnapshot();
        logger.warn("Veri kaynagi hatasina ragmen Google Sheet/yerel tablo temizleme turu calistirildi.", {
          fixtures: this.statusValue.dailySheet.fixtures.length,
        });
      } catch (sheetError) {
        this.statusValue.totals.errors += 1;
        logger.warn("Provider hatasi sonrasi tablo temizleme de basarisiz.", {
          error: errorMessage(sheetError),
        });
      }

      this.statusValue.lastError = message;
      this.statusValue.lastErrorAt = new Date().toISOString();
      this.statusValue.totals.errors += 1;
      logger.error("Oran taramasi basarisiz.", { error: message });
      throw error;
    }
  }
}
