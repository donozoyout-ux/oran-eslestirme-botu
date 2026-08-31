import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage, logger } from "../logger.js";

/**
 * Ucretli/kotali bir kaynagi normal tarama dongusune sokmadan son care olarak
 * kullanir. En az bir ana oran kaynagi saglikli cevap verdiyse (cevap bos olsa
 * bile) fallback cagrilmaz. Fallback sadece tum ana oran kaynaklari gercekten
 * hata verdiginde devreye girer.
 *
 * Fixture-only kaynaklar (ornegin football-data) fikstur kataluguna katkida
 * bulunur ama fallback kararini etkilemez.
 */
export class TieredOddsProvider implements OddsProvider {
  readonly name: string;

  constructor(
    private readonly primaryProviders: OddsProvider[],
    private readonly fixtureProviders: OddsProvider[] = [],
    private readonly fallbackProvider?: OddsProvider,
  ) {
    if (primaryProviders.length === 0) throw new Error("En az bir ana oran kaynagi gerekli.");
    const names = [
      ...primaryProviders.map((provider) => provider.name),
      ...fixtureProviders.map((provider) => provider.name),
      ...(fallbackProvider ? [`${fallbackProvider.name}:fallback`] : []),
    ];
    this.name = names.join("+");
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const [primaryResults, fixtureResults] = await Promise.all([
      Promise.allSettled(this.primaryProviders.map((provider) => provider.fetchQuotes(signal))),
      Promise.allSettled(this.fixtureProviders.map((provider) => provider.fetchQuotes(signal))),
    ]);

    const quotes: OddsQuote[] = [];
    const primaryErrors: string[] = [];
    let fulfilledPrimary = 0;

    for (let index = 0; index < primaryResults.length; index += 1) {
      const result = primaryResults[index]!;
      const provider = this.primaryProviders[index]!;
      if (result.status === "fulfilled") {
        fulfilledPrimary += 1;
        quotes.push(...result.value);
        continue;
      }
      const reason = errorMessage(result.reason);
      primaryErrors.push(`${provider.name}: ${reason}`);
      logger.warn("Ana oran kaynagi gecici olarak okunamadi.", { provider: provider.name, error: reason });
    }

    for (let index = 0; index < fixtureResults.length; index += 1) {
      const result = fixtureResults[index]!;
      if (result.status === "fulfilled") continue;
      const provider = this.fixtureProviders[index]!;
      logger.warn("Fikstur kaynagi gecici olarak okunamadi; oran taramasi devam ediyor.", {
        provider: provider.name,
        error: errorMessage(result.reason),
      });
    }

    // Saglikli bir ana kaynak cevap verdiyse fallback'i asla yakma. Bos cevap,
    // "su anda kontrol zamani gelen oran yok" anlamina gelebilir ve kota
    // tuketmek icin sebep degildir.
    if (fulfilledPrimary > 0) return quotes;

    if (!this.fallbackProvider) {
      throw new Error(`Tum ana oran kaynaklari basarisiz: ${primaryErrors.join("; ")}`);
    }

    logger.warn("Tum ana oran kaynaklari basarisiz; kota korumali fallback devreye giriyor.", {
      fallback: this.fallbackProvider.name,
      errors: primaryErrors,
    });
    return this.fallbackProvider.fetchQuotes(signal);
  }

  getLastFixtures(): MatchFixture[] {
    const unique = new Map<string, MatchFixture>();
    const providers = [
      ...this.primaryProviders,
      ...this.fixtureProviders,
      ...(this.fallbackProvider ? [this.fallbackProvider] : []),
    ];
    for (const provider of providers) {
      for (const fixture of provider.getLastFixtures?.() ?? []) {
        unique.set(`${fixture.provider}:${fixture.sourceEventId}`, fixture);
      }
    }
    return [...unique.values()];
  }

  async close(): Promise<void> {
    const providers = [
      ...this.primaryProviders,
      ...this.fixtureProviders,
      ...(this.fallbackProvider ? [this.fallbackProvider] : []),
    ];
    await Promise.allSettled(providers.map((provider) => provider.close?.()));
  }
}
