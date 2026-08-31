import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage, logger } from "../logger.js";
import type { ResultsTracker } from "../results-tracker.js";

/**
 * Oran akisini degistirmeden her poll sonunda gelen prematch adaylarini ve
 * fixture sonuc bilgisini sonuc takip sistemine aktarir. Sonuc takibi hata
 * verse bile ana monitor/Telegram akisi kesilmez.
 */
export class ResultTrackingProvider implements OddsProvider {
  readonly name: string;

  constructor(
    private readonly inner: OddsProvider,
    private readonly tracker: ResultsTracker,
  ) {
    this.name = inner.name;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const quotes = await this.inner.fetchQuotes(signal);
    const fixtures = this.inner.getLastFixtures?.() ?? [];
    try {
      await this.tracker.record(quotes, fixtures, new Date());
    } catch (error) {
      logger.warn("Gun sonu sonuc takibi gecici olarak guncellenemedi.", { error: errorMessage(error) });
    }
    return quotes;
  }

  getLastFixtures(): MatchFixture[] {
    return this.inner.getLastFixtures?.() ?? [];
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
