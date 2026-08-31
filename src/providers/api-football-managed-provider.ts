import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { setProviderDiagnostic } from "../provider-diagnostics.js";

export interface ManagedApiFootballOptions {
  retryMinutes?: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ManagedApiFootballProvider implements OddsProvider {
  readonly name = "api_football";
  private inner: OddsProvider;
  private readonly retryMs: number;
  private lastProviderRunAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private nextFixtureRetryAt: number | null = null;
  private fixtureCount = 0;
  private quoteCount = 0;

  constructor(
    private readonly factory: () => OddsProvider,
    options: ManagedApiFootballOptions = {},
  ) {
    this.retryMs = Math.max(1, options.retryMinutes ?? 15) * 60_000;
    this.inner = this.factory();
    this.publish("starting");
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = Date.now();

    if (this.nextFixtureRetryAt !== null && now < this.nextFixtureRetryAt) {
      this.publish("retry_wait");
      return [];
    }

    if (this.nextFixtureRetryAt !== null && now >= this.nextFixtureRetryAt) {
      await this.inner.close?.().catch(() => undefined);
      this.inner = this.factory();
      this.nextFixtureRetryAt = null;
    }

    this.lastProviderRunAt = now;

    try {
      const quotes = await this.inner.fetchQuotes(signal);
      const fixtures = this.inner.getLastFixtures?.() ?? [];
      this.fixtureCount = fixtures.length;
      this.quoteCount = quotes.length;

      if (fixtures.length === 0) {
        this.lastError = "API-Football bugunun Big Five fiksturunda 0 uygun mac dondurdu.";
        this.nextFixtureRetryAt = now + this.retryMs;
        this.publish("empty_fixture_catalog");
        return quotes;
      }

      this.lastError = null;
      this.lastSuccessAt = now;
      this.nextFixtureRetryAt = null;
      this.publish("ok");
      return quotes;
    } catch (error) {
      const fixtures = this.inner.getLastFixtures?.() ?? [];
      this.fixtureCount = fixtures.length;
      this.quoteCount = 0;
      this.lastError = errorText(error);

      // Fikstur katalogu hic olusmadiysa dakikada bir ayni hatali cagrinin
      // kotayi tuketmesini engelle; 15 dakika sonra temiz instance ile dene.
      if (fixtures.length === 0) {
        this.nextFixtureRetryAt = now + this.retryMs;
        this.publish("fixture_error");
      } else {
        // Katalog var, sadece live odds gibi sonraki bir endpoint hata vermis
        // olabilir. Fiksturu koru ve normal polling dongusunun devam etmesine izin ver.
        this.publish("odds_error");
      }
      throw error;
    }
  }

  getLastFixtures(): MatchFixture[] {
    return this.inner.getLastFixtures?.() ?? [];
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }

  private publish(status: string): void {
    setProviderDiagnostic(this.name, {
      enabled: true,
      status,
      leagueScope: "Premier League, La Liga, Bundesliga, Serie A, Ligue 1",
      fixtureCount: this.fixtureCount,
      quoteCount: this.quoteCount,
      lastProviderRunAt: this.lastProviderRunAt === null ? null : new Date(this.lastProviderRunAt).toISOString(),
      lastSuccessAt: this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
      lastError: this.lastError,
      nextFixtureRetryAt: this.nextFixtureRetryAt === null ? null : new Date(this.nextFixtureRetryAt).toISOString(),
    });
  }
}
