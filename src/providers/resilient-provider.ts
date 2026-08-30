import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage, logger } from "../logger.js";

/**
 * Bir veri kaynagi gecici olarak hata verdiginde tum monitor turunun
 * durmasini engeller. Son bilinen fikstur katalogu korunur; bu sayede
 * Google Sheets aktif/stale satir temizligini yine yapabilir.
 */
export class ResilientOddsProvider implements OddsProvider {
  readonly name: string;

  constructor(private readonly inner: OddsProvider) {
    this.name = inner.name;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    try {
      return await this.inner.fetchQuotes(signal);
    } catch (error) {
      logger.warn("Oran kaynagi gecici olarak okunamadi; monitor turu devam ediyor.", {
        provider: this.inner.name,
        error: errorMessage(error),
      });
      return [];
    }
  }

  getLastFixtures(): MatchFixture[] {
    return this.inner.getLastFixtures?.() ?? [];
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
