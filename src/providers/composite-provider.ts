import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage, logger } from "../logger.js";

/**
 * Bir kaynak geçici olarak yanıt vermezse diğer kaynaktan gelen oranlarla
 * taramaya devam eder. Böylece ek API, mevcut scraper'ın yerine geçmez.
 */
export class CompositeOddsProvider implements OddsProvider {
  readonly name: string;

  constructor(private readonly providers: OddsProvider[]) {
    if (providers.length < 2) throw new Error("Birlestirilmis saglayici en az iki kaynak ister.");
    this.name = providers.map((provider) => provider.name).join("+");
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const results = await Promise.allSettled(this.providers.map((provider) => provider.fetchQuotes(signal)));
    const quotes: OddsQuote[] = [];
    const errors: string[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      if (result.status === "fulfilled") {
        quotes.push(...result.value);
        continue;
      }
      const provider = this.providers[index]!;
      const reason = errorMessage(result.reason);
      errors.push(`${provider.name}: ${reason}`);
      logger.warn("Ek oran kaynagi gecici olarak okunamadi; diger kaynakla devam ediliyor.", {
        provider: provider.name,
        error: reason,
      });
    }
    if (quotes.length > 0) return quotes;
    throw new Error(`Tum oran kaynaklari basarisiz: ${errors.join("; ")}`);
  }

  getLastFixtures(): MatchFixture[] {
    const unique = new Map<string, MatchFixture>();
    for (const provider of this.providers) {
      for (const fixture of provider.getLastFixtures?.() ?? []) {
        unique.set(`${fixture.provider}:${fixture.sourceEventId}`, fixture);
      }
    }
    return [...unique.values()];
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.close?.()));
  }
}
