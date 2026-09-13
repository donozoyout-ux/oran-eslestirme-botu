import { CanonicalMatchResolver } from "./canonical-match-resolver.js";
import type { AlertSignalState, AlertStore, Notifier, OddsAnalysisSignal, OddsMatch, OddsProvider, RunSummary } from "./domain.js";
import { findOddsMatches } from "./comparison-engine.js";
import { rankCouponCandidates, type CouponCandidate } from "./coupon-engine.js";
import type { DailySheetSnapshot, JsonDailyMatchSheet } from "./daily-match-sheet.js";
import { errorMessage, logger } from "./logger.js";
import type { HistoricalOddsArchive, HistoricalPatternDiagnostic } from "./historical-odds-archive.js";
import { disabledMatchIntelligenceStatus, type MatchIntelligenceService, type MatchIntelligenceStatus } from "./match-intelligence-service.js";
import { analyzeOddsMarket, type ArbitrageOpportunity, type SelectionConsensus } from "./market-analysis-engine.js";
import { selectPrematchCloseAlerts } from "./prematch-alert-gate.js";
import { selectSmartAnalysisAlerts } from "./smart-alert-gate.js";

export interface MonitorOptions {
  tolerancePercent: number;
  maxQuoteAgeSeconds: number;
  pollIntervalSeconds: number;
  prematchAlertWindowMinutes: number;
  prematchAlertMinSources: number;
  prematchAlertMinConfidence: number;
  eventKickoffToleranceMinutes?: number;
  turkishOddsTelegramEnabled?: boolean;
}

function matchAlertState(match: OddsMatch): AlertSignalState {
  const quotes = [match.quoteA, match.quoteB]
    .sort((a, b) => a.bookmakerKey.localeCompare(b.bookmakerKey) || a.provider.localeCompare(b.provider));
  const first = quotes[0]!;
  const second = quotes[1]!;
  return {
    // Ayni bookmaker baska bir feed'den gelmeye baslarsa bu yeni ekonomik
    // sinyal sayilmaz; provider gecisi duplicate bildirim uretmemeli.
    stateKey: quotes.map((quote) => quote.bookmakerKey).join("|"),
    metrics: {
      firstPrice: first.price,
      secondPrice: second.price,
      differencePercent: match.relativeDifferencePercent,
    },
    thresholds: {
      firstPrice: { relativePercent: 3 },
      secondPrice: { relativePercent: 3 },
      differencePercent: { absolute: 0.5 },
    },
  };
}

function analysisAlertState(signal: OddsAnalysisSignal): AlertSignalState {
  const metrics: Record<string, number> = {};
  const thresholds: AlertSignalState["thresholds"] = {};
  if (signal.currentPrice !== undefined) {
    metrics.currentPrice = signal.currentPrice;
    thresholds.currentPrice = { relativePercent: 3 };
  }
  if (signal.consensusPrice !== undefined) {
    metrics.consensusPrice = signal.consensusPrice;
    thresholds.consensusPrice = { relativePercent: 3 };
  }
  if (signal.changePercent !== undefined) {
    metrics.changePercent = signal.changePercent;
    thresholds.changePercent = { absolute: 2 };
  }
  if (signal.arbitrageMarginPercent !== undefined) {
    metrics.arbitrageMarginPercent = signal.arbitrageMarginPercent;
    thresholds.arbitrageMarginPercent = { absolute: 0.5 };
  }
  if (signal.confidenceScore !== undefined) {
    metrics.confidenceScore = signal.confidenceScore;
    thresholds.confidenceScore = { absolute: 10 };
  }
  if (signal.sourceCount !== undefined) {
    metrics.sourceCount = signal.sourceCount;
    thresholds.sourceCount = { absolute: 1 };
  }
  return {
    stateKey: [signal.type, signal.bookmaker ?? "market", signal.selection, signal.line ?? "none"].join("|"),
    metrics,
    thresholds,
  };
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
  recentQuotesUpdatedAt: string | null;
  recentMatchesUpdatedAt: string | null;
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
  historicalPattern: HistoricalPatternDiagnostic | {
    enabled: false;
    storage: "memory" | "json" | "postgres";
    completedFixtures: 0;
    oddsSnapshots: 0;
    oldestEvent: null;
    newestEvent: null;
    lastArchiveWrite: null;
    health: "ok" | "error";
    lastError: string | null;
    completeness: { totalEvents: 0; withResults: 0; withClosingOdds: 0; withAhAndOuClosing: 0; patternEligible: 0 };
    analysis: null;
    message: "Yetersiz tarihsel veri";
  };
  matchIntelligence: MatchIntelligenceStatus;
  totals: { runs: number; alertsSent: number; errors: number };
}

export class OddsMonitor {
  private activeRun: Promise<RunSummary> | null = null;
  private scheduler: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly statusValue: MonitorStatus;
  private readonly canonicalMatchResolver: CanonicalMatchResolver;

  constructor(
    private readonly provider: OddsProvider,
    private readonly notifier: Notifier,
    private readonly alertStore: AlertStore,
    private readonly options: MonitorOptions,
    private readonly dailySheet: JsonDailyMatchSheet,
    private readonly historicalArchive?: HistoricalOddsArchive,
    private readonly matchIntelligence?: MatchIntelligenceService,
  ) {
    this.canonicalMatchResolver = new CanonicalMatchResolver({
      kickoffToleranceMinutes: options.eventKickoffToleranceMinutes,
    });
    this.statusValue = {
      provider: provider.name,
      notifier: notifier.name,
      running: false,
      startedAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastRun: null,
      recentQuotesUpdatedAt: null,
      recentMatchesUpdatedAt: null,
      recentQuotes: [],
      recentMatches: [],
      marketAnalysis: { consensus: [], arbitrage: [] },
      couponCandidates: [],
      dailySheet: dailySheet.getSnapshot(),
      historicalPattern: {
        enabled: false,
        storage: "memory",
        completedFixtures: 0,
        oddsSnapshots: 0,
        oldestEvent: null,
        newestEvent: null,
        lastArchiveWrite: null,
        health: "ok",
        lastError: null,
        completeness: { totalEvents: 0, withResults: 0, withClosingOdds: 0, withAhAndOuClosing: 0, patternEligible: 0 },
        analysis: null,
        message: "Yetersiz tarihsel veri",
      },
      matchIntelligence: disabledMatchIntelligenceStatus(),
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
          canonicalMatchResolver: this.canonicalMatchResolver,
        },
        comparisonTime,
      );
      const canonicalFixtures = this.canonicalMatchResolver.resolveFixtures(
        this.provider.getLastFixtures?.() ?? [],
      );
      const marketAnalysis = analyzeOddsMarket(comparison.freshQuotes, {}, comparisonTime);
      const prematchCloseAlerts = selectPrematchCloseAlerts(
        comparison.matches,
        marketAnalysis.consensus,
        comparisonTime,
        {
          windowMinutes: this.options.prematchAlertWindowMinutes,
          minSources: this.options.prematchAlertMinSources,
          minConfidenceScore: this.options.prematchAlertMinConfidence,
          maxDispersionPercent: this.options.tolerancePercent,
          minValuePercent: 2,
        },
      );

      this.statusValue.marketAnalysis = {
        consensus: marketAnalysis.consensus.slice(0, 50),
        arbitrage: marketAnalysis.arbitrage.slice(0, 20),
      };
      this.statusValue.couponCandidates = rankCouponCandidates(marketAnalysis.consensus, 5);

      let alertsSent = 0;
      let movementAlertsSent = 0;
      let marketAnalysisAlertsSent = 0;
      let alertsSuppressed = 0;

      if (this.options.turkishOddsTelegramEnabled && this.notifier.sendOddsSnapshot) {
        const groups = new Map<string, typeof comparison.freshQuotes>();
        for (const quote of comparison.freshQuotes) {
          if (quote.provider !== "mackolik_iddaa" || quote.phase !== "prematch") continue;
          const key = quote.canonicalEventId ?? quote.sourceEventId;
          const rows = groups.get(key) ?? [];
          rows.push(quote);
          groups.set(key, rows);
        }
        const orderedGroups = [...groups.entries()]
          .sort((a, b) => Date.parse(a[1][0]?.commenceTime ?? "") - Date.parse(b[1][0]?.commenceTime ?? ""))
          .slice(0, 6);
        for (const [eventId, quotesForEvent] of orderedGroups) {
          const sorted = [...quotesForEvent].sort((a, b) =>
            [a.marketKey, a.selectionKey, a.line ?? 0].join("|").localeCompare([b.marketKey, b.selectionKey, b.line ?? 0].join("|"))
          );
          const stateKey = sorted.map((quote) => [quote.marketKey, quote.selectionKey, quote.line ?? "none"].join(":")).join("|");
          const metrics: Record<string, number> = {};
          const thresholds: AlertSignalState["thresholds"] = {};
          sorted.forEach((quote, index) => {
            metrics[`p${index}`] = quote.price;
            thresholds[`p${index}`] = { relativePercent: 1 };
          });
          const alertId = `turkish-odds:${eventId}`;
          const snapshotState: AlertSignalState = { stateKey, metrics, thresholds };
          const now = new Date();
          if (!this.alertStore.shouldSend(alertId, now, snapshotState)) {
            alertsSuppressed += 1;
            continue;
          }
          try {
            await this.notifier.sendOddsSnapshot(sorted);
            await this.alertStore.markSent(alertId, now, snapshotState);
            alertsSent += 1;
          } catch (error) {
            this.statusValue.totals.errors += 1;
            logger.warn("Turkiye oran snapshot Telegram bildirimi gonderilemedi.", {
              eventId,
              error: errorMessage(error),
            });
          }
        }
      }

      if (this.historicalArchive) {
        try {
          await this.historicalArchive.record(comparison.freshQuotes, canonicalFixtures, comparisonTime);
          this.statusValue.historicalPattern = await this.historicalArchive.diagnostics(
            comparison.freshQuotes,
            comparisonTime,
          );
        } catch (error) {
          this.statusValue.totals.errors += 1;
          this.statusValue.historicalPattern = {
            ...this.statusValue.historicalPattern,
            storage: this.historicalArchive.storage,
            health: "error",
            lastError: errorMessage(error),
          };
          logger.warn("Historical odds arsivi guncellenemedi; ana monitor devam ediyor.", {
            error: errorMessage(error),
          });
        }
      }

      if (this.matchIntelligence) {
        void this.matchIntelligence.refresh(canonicalFixtures, comparisonTime)
          .then((status) => { this.statusValue.matchIntelligence = status; })
          .catch((error) => {
            this.statusValue.totals.errors += 1;
            this.statusValue.matchIntelligence = { ...this.statusValue.matchIntelligence, enabled: true,
              lastRunAt: comparisonTime.toISOString(), lastError: errorMessage(error) };
            logger.warn("Match Intelligence alt sistemi hata verdi; odds monitor devam ediyor.", { error: errorMessage(error) });
          });
      }

      try {
        const sheetResult = await this.dailySheet.record(
          canonicalFixtures,
          comparison.freshQuotes,
          comparison.matches,
          comparisonTime,
        );
        this.statusValue.dailySheet = this.dailySheet.getSnapshot();

        if (this.notifier.sendAnalysisSignal) {
          const smartMovementSignals = selectSmartAnalysisAlerts(
            sheetResult.pendingMovementSignals,
            marketAnalysis.consensus,
          );
          alertsSuppressed += sheetResult.pendingMovementSignals.length - smartMovementSignals.length;

          for (const signal of smartMovementSignals) {
            const now = new Date();
            const alertState = analysisAlertState(signal);
            if (!this.alertStore.shouldSend(signal.id, now, alertState)) {
              alertsSuppressed += 1;
              continue;
            }
            try {
              await this.notifier.sendAnalysisSignal(signal);
              await this.alertStore.markSent(signal.id, now, alertState);
              await this.dailySheet.markSignalNotified(signal.id, now);
              alertsSent += 1;
              movementAlertsSent += 1;
            } catch (error) {
              this.statusValue.totals.errors += 1;
              logger.error("Akilli oran hareketi bildirimi gonderilemedi.", {
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
        const smartMarketSignals = selectSmartAnalysisAlerts(
          marketAnalysis.alertSignals,
          marketAnalysis.consensus,
        );
        alertsSuppressed += marketAnalysis.alertSignals.length - smartMarketSignals.length;

        for (const signal of smartMarketSignals) {
          const now = new Date();
          const alertState = analysisAlertState(signal);
          if (!this.alertStore.shouldSend(signal.id, now, alertState)) {
            alertsSuppressed += 1;
            continue;
          }
          try {
            await this.notifier.sendAnalysisSignal(signal);
            await this.alertStore.markSent(signal.id, now, alertState);
            alertsSent += 1;
            marketAnalysisAlertsSent += 1;
          } catch (error) {
            this.statusValue.totals.errors += 1;
            logger.error("Akilli piyasa analizi bildirimi gonderilemedi.", {
              signalId: signal.id,
              error: errorMessage(error),
            });
          }
        }
      }

      // Yakin oran alarmi artik yalnizca yakinlik degil, adil orana gore pozitif
      // value de tasiyorsa gider. Dusuk oran tek basina bildirim sebebi degildir.
      for (const match of prematchCloseAlerts) {
        const now = new Date();
        const alertState = matchAlertState(match);
        if (!this.alertStore.shouldSend(match.id, now, alertState)) {
          alertsSuppressed += 1;
          continue;
        }
        try {
          await this.notifier.send(match);
          await this.alertStore.markSent(match.id, now, alertState);
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

      if (comparison.freshQuotes.length > 0) {
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
        this.statusValue.recentQuotesUpdatedAt = finishedAt.toISOString();
      }

      if (comparison.matches.length > 0) {
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
        this.statusValue.recentMatchesUpdatedAt = finishedAt.toISOString();
      }

      this.statusValue.lastSuccessAt = finishedAt.toISOString();
      this.statusValue.lastError = null;
      this.statusValue.totals.runs += 1;
      this.statusValue.totals.alertsSent += alertsSent;
      logger.info("Oran taramasi tamamlandi.", {
        ...summary,
        prematchCloseAlertsEligible: prematchCloseAlerts.length,
        prematchAlertWindowMinutes: this.options.prematchAlertWindowMinutes,
      });
      return summary;
    } catch (error) {
      const message = errorMessage(error);

      try {
        const cleanupTime = new Date();
        await this.dailySheet.record(
          this.canonicalMatchResolver.resolveFixtures(this.provider.getLastFixtures?.() ?? []),
          [],
          [],
          cleanupTime,
        );
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
