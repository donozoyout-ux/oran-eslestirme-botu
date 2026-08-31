import type { AppConfig } from "../config.js";
import type { OddsProvider } from "../domain.js";
import { MockOddsProvider } from "./mock-provider.js";
import { TheOddsApiProvider } from "./the-odds-api-provider.js";
import { BetExplorerScraperProvider } from "./betexplorer-scraper-provider.js";
import { CompositeOddsProvider } from "./composite-provider.js";
import { ApiFootballProvider } from "./api-football-provider.js";
import { FootballDataFixtureProvider } from "./football-data-fixture-provider.js";
import { ResilientOddsProvider } from "./resilient-provider.js";
import { TieredOddsProvider } from "./tiered-provider.js";

function theOddsApiProvider(config: AppConfig): TheOddsApiProvider {
  if (!config.oddsApiKey) throw new Error("ODDS_API_KEY eksik.");
  return new TheOddsApiProvider({
    apiKey: config.oddsApiKey,
    sportKeys: config.sportKeys,
    bookmakerKeys: config.bookmakerKeys,
    regions: config.regions,
    maxLiveEventAgeMinutes: config.maxLiveEventAgeMinutes,
  });
}

function betExplorerScraper(config: AppConfig): BetExplorerScraperProvider {
  return new BetExplorerScraperProvider({
    bookmakerKeys: config.bookmakerKeys,
    maxMatches: config.scraperMaxMatches,
    maxLiveEventAgeMinutes: config.maxLiveEventAgeMinutes,
    pageTimeoutMs: config.scraperPageTimeoutMs,
    waitMs: config.scraperWaitMs,
    allowVisibleBookmakerFallback: config.scraperAllowVisibleBookmakerFallback,
    leagueScope: config.leagueScope,
    prematchTrackHours: config.prematchTrackHours,
    prematchFarPollMinutes: config.prematchFarPollMinutes,
    prematchNearPollMinutes: config.prematchNearPollMinutes,
    prematchFinalPollMinutes: config.prematchFinalPollMinutes,
    livePollMinutes: config.livePollMinutes,
    executablePath: config.chromiumExecutablePath,
  });
}

function apiFootballProvider(config: AppConfig): ApiFootballProvider | null {
  if (!config.apiFootballKey) return null;
  return new ApiFootballProvider({
    apiKey: config.apiFootballKey,
    bookmakerKeys: config.bookmakerKeys,
    maxFixtures: config.apiFootballMaxFixtures,
    fixtureCacheMinutes: config.apiFootballFixtureCacheMinutes,
    prematchCacheMinutes: config.apiFootballPrematchCacheMinutes,
    liveCacheMinutes: config.apiFootballLiveCacheMinutes,
    dailyRequestBudget: config.apiFootballDailyRequestBudget,
    leagueScope: config.leagueScope,
    maxLiveEventAgeMinutes: config.maxLiveEventAgeMinutes,
  });
}

function footballDataProvider(config: AppConfig): FootballDataFixtureProvider | null {
  if (!config.footballDataToken) return null;
  return new FootballDataFixtureProvider({
    apiKey: config.footballDataToken,
    competitionCodes: config.footballDataCompetitionCodes,
    cacheMinutes: config.footballDataCacheMinutes,
    dailyRequestBudget: config.footballDataDailyRequestBudget,
  });
}

export function createProvider(config: AppConfig): OddsProvider {
  if (config.provider === "mock") return new MockOddsProvider();

  // Kullanici ODDS_PROVIDER=the_odds_api diye acikca sectiyse eski davranis
  // korunur: bu durumda The Odds API ana kaynaktir ve her tur kullanilabilir.
  if (config.provider === "the_odds_api") {
    const providers: OddsProvider[] = [theOddsApiProvider(config)];
    const apiFootball = apiFootballProvider(config);
    const footballData = footballDataProvider(config);
    if (apiFootball) providers.push(apiFootball);
    if (footballData) providers.push(footballData);
    return providers.length === 1 ? providers[0]! : new CompositeOddsProvider(providers);
  }

  // Normal production modu: BetExplorer + API-Football ana oran kaynaklari.
  // football-data sadece fikstur kaynagidir. ODDS_API_KEY mevcut olsa bile
  // The Odds API normal dongude cagrilmaz; sadece tum ana oran kaynaklari
  // gercekten hata verirse son-care fallback olarak kullanilir.
  const primaryProviders: OddsProvider[] = [betExplorerScraper(config)];
  const apiFootball = apiFootballProvider(config);
  if (apiFootball) primaryProviders.push(apiFootball);

  const fixtureProviders: OddsProvider[] = [];
  const footballData = footballDataProvider(config);
  if (footballData) fixtureProviders.push(footballData);

  const fallbackProvider = config.oddsApiKey ? theOddsApiProvider(config) : undefined;
  const tiered = new TieredOddsProvider(primaryProviders, fixtureProviders, fallbackProvider);

  // Fallback de hata verirse veya fallback yoksa monitor tamamen cokmesin;
  // son bilinen fikstur katalogu ve Sheet temizleme dongusu devam etsin.
  return new ResilientOddsProvider(tiered);
}
