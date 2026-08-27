import type { AlertStore, Notifier, OddsProvider, RunSummary } from "./domain.js";
import { findOddsMatches } from "./comparison-engine.js";
import { errorMessage, logger } from "./logger.js";

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
  totals: {
    runs: number;
    alertsSent: number;
    errors: number;
  };
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
    return JSON.parse(JSON.stringify(this.statusValue)) as MonitorStatus;
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
      // Hata execute icinde kaydedildi; dongu bir sonraki turda devam eder.
    }
    if (this.stopped) return;
    this.scheduler = setTimeout(() => void this.runLoop(), this.options.pollIntervalSeconds * 1000);
  }

  private async execute(): Promise<RunSummary> {
    const startedAt = new Date();
    this.statusValue.running = true;
    try {
      const quotes = await this.provider.fetchQuotes();
      const comparison = findOddsMatches(
        quotes,
        {
          tolerancePercent: this.options.tolerancePercent,
          maxQuoteAgeSeconds: this.options.maxQuoteAgeSeconds,
        },
        startedAt,
      );
      let alertsSent = 0;
      let alertsSuppressed = 0;

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
        alertsSuppressed,
      };
      this.statusValue.lastRun = summary;
      this.statusValue.lastSuccessAt = finishedAt.toISOString();
      this.statusValue.lastError = null;
      this.statusValue.totals.runs += 1;
      this.statusValue.totals.alertsSent += alertsSent;
      logger.info("Oran taramasi tamamlandi.", { ...summary });
      return summary;
    } catch (error) {
      const message = errorMessage(error);
      this.statusValue.lastError = message;
      this.statusValue.lastErrorAt = new Date().toISOString();
      this.statusValue.totals.errors += 1;
      logger.error("Oran taramasi basarisiz.", { error: message });
      throw error;
    }
  }
}
