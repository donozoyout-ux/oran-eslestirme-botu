import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage, logger } from "../logger.js";

export interface RoleSeparatedProviderOptions {
  fallbackCooldownMinutes?: number;
}

/**
 * Kaynaklara tek tek gorev verir:
 * - scraper: ana prematch + ek live oran kaynagi
 * - liveApi: fixture katalogu + baslangictan sonra live oran
 * - fixtureProviders: fikstur/durum katkisi; oran donduren resmi kaynaklarin oranlari da birlestirilir
 * - fallback: scraper hata verirse prematch icin son-care kaynak
 *
 * Boylece ayni polling turunda ucretli/kotali API'lere ayni isi yaptirmayiz.
 */
export class RoleSeparatedOddsProvider implements OddsProvider {
  readonly name: string;
  private readonly fallbackCooldownMs: number;
  private lastFallbackAttemptAt = 0;

  constructor(
    private readonly scraper: OddsProvider,
    private readonly liveApi: OddsProvider | undefined,
    private readonly fixtureProviders: OddsProvider[] = [],
    private readonly fallbackProvider?: OddsProvider,
    options: RoleSeparatedProviderOptions = {},
  ) {
    this.fallbackCooldownMs = Math.max(1, options.fallbackCooldownMinutes ?? 60) * 60_000;
    this.name = [
      `scrape:${scraper.name}`,
      ...(liveApi ? [`live:${liveApi.name}`] : []),
      ...fixtureProviders.map((provider) => `fixture:${provider.name}`),
      ...(fallbackProvider ? [`prematch-fallback:${fallbackProvider.name}`] : []),
    ].join("+");
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const supportProviders = [
      ...(this.liveApi ? [this.liveApi] : []),
      ...this.fixtureProviders,
    ];

    const [scraperResult, supportResults] = await Promise.all([
      this.settle(this.scraper, signal),
      Promise.all(supportProviders.map((provider) => this.settle(provider, signal))),
    ]);

    const quotes: OddsQuote[] = [];
    for (const result of supportResults) {
      if (result.ok) quotes.push(...result.quotes);
    }

    if (scraperResult.ok) {
      quotes.push(...scraperResult.quotes);
      return quotes;
    }

    logger.warn("Web scraping oran kaynagi hata verdi; gorev paylasimli fallback degerlendiriliyor.", {
      provider: this.scraper.name,
      error: scraperResult.error,
    });

    if (!this.fallbackProvider) return quotes;

    const now = Date.now();
    if (this.lastFallbackAttemptAt && now - this.lastFallbackAttemptAt < this.fallbackCooldownMs) {
      logger.info("The Odds API fallback cooldown nedeniyle atlandi.", {
        cooldownMinutes: Math.round(this.fallbackCooldownMs / 60_000),
      });
      return quotes;
    }

    this.lastFallbackAttemptAt = now;
    try {
      const fallbackQuotes = await this.fallbackProvider.fetchQuotes(signal);
      // The Odds API'nin gorevi sadece prematch acil yedektir. Live tarafini
      // API-Football + scraper ustlenir; burada live quote'lari bilincli atariz.
      const prematchOnly = fallbackQuotes.filter((quote) => quote.phase === "prematch");
      logger.warn("Web scraping basarisiz oldugu icin prematch fallback kullanildi.", {
        fallback: this.fallbackProvider.name,
        quotes: prematchOnly.length,
      });
      return [...quotes, ...prematchOnly];
    } catch (error) {
      logger.warn("Prematch fallback kaynagi da okunamadi.", {
        fallback: this.fallbackProvider.name,
        error: errorMessage(error),
      });
      return quotes;
    }
  }

  getLastFixtures(): MatchFixture[] {
    const unique = new Map<string, MatchFixture>();
    const providers = [
      this.scraper,
      ...(this.liveApi ? [this.liveApi] : []),
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
      this.scraper,
      ...(this.liveApi ? [this.liveApi] : []),
      ...this.fixtureProviders,
      ...(this.fallbackProvider ? [this.fallbackProvider] : []),
    ];
    await Promise.allSettled(providers.map((provider) => provider.close?.()));
  }

  private async settle(
    provider: OddsProvider,
    signal?: AbortSignal,
  ): Promise<{ ok: true; quotes: OddsQuote[] } | { ok: false; quotes: []; error: string }> {
    try {
      return { ok: true, quotes: await provider.fetchQuotes(signal) };
    } catch (error) {
      const message = errorMessage(error);
      logger.warn("Gorevli veri kaynagi gecici olarak okunamadi.", { provider: provider.name, error: message });
      return { ok: false, quotes: [], error: message };
    }
  }
}
