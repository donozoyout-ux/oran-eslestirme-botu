import type { AppConfig } from "../config.js";
import type { OddsProvider } from "../domain.js";
import { setProviderDiagnostic } from "../provider-diagnostics.js";
import { MockOddsProvider } from "./mock-provider.js";
import { TheOddsApiProvider } from "./the-odds-api-provider.js";
import { BetExplorerScraperProvider } from "./betexplorer-scraper-provider.js";
import { CompositeOddsProvider } from "./composite-provider.js";
import { ApiFootballProvider } from "./api-football-provider.js";
import { ManagedApiFootballProvider } from "./api-football-managed-provider.js";
import { FootballDataFixtureProvider } from "./football-data-fixture-provider.js";
import { ResilientOddsProvider } from "./resilient-provider.js";
import { RoleSeparatedOddsProvider } from "./role-separated-provider.js";

const TRACKED_ODDS_API_SPORT_KEYS = [
  "soccer_epl",
  "soccer_efl_champ",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
] as const;

const TRACKED_FOOTBALL_DATA_CODES = ["PL", "ELC", "PD", "BL1", "SA", "FL1"] as const;
const TRACKED_LEAGUE_LABEL = "Premier League, Championship, La Liga, Bundesliga, Serie A, Ligue 1";

function theOddsApiProvider(config: AppConfig): TheOddsApiProvider {
  if (!config.oddsApiKey) throw new Error("ODDS_API_KEY eksik.");
  return new TheOddsApiProvider({
    apiKey: config.oddsApiKey,
    sportKeys: [...TRACKED_ODDS_API_SPORT_KEYS],
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

function apiFootballProvider(config: AppConfig): OddsProvider | null {
  if (!config.apiFootballKey) {
    setProviderDiagnostic("api_football", {
      enabled: false,
      status: "disabled",
      leagueScope: TRACKED_LEAGUE_LABEL,
      fixtureCount: 0,
      quoteCount: 0,
      lastProviderRunAt: null,
      lastSuccessAt: null,
      lastError: "API_FOOTBALL_KEY ayarlanmamis.",
      nextFixtureRetryAt: null,
    });
    return null;
  }

  // Monitor 5 dakikadan eski quote'u varsayilan ayarda stale sayiyor. Railway'de
  // eski API_FOOTBALL_LIVE_CACHE_MINUTES=10 gibi bir env kalsa bile live odds
  // cache'i freshness penceresinin disina tasmasin. 30 sn guvenlik payi birak.
  const freshnessSafeLiveCacheMinutes = Math.max(
    1,
    Math.min(
      config.apiFootballLiveCacheMinutes,
      Math.floor(Math.max(60, config.maxQuoteAgeSeconds - 30) / 60),
    ),
  );

  const factory = (): ApiFootballProvider => new ApiFootballProvider({
    apiKey: config.apiFootballKey!,
    bookmakerKeys: config.bookmakerKeys,
    maxFixtures: config.apiFootballMaxFixtures,
    fixtureCacheMinutes: config.apiFootballFixtureCacheMinutes,
    prematchCacheMinutes: config.apiFootballPrematchCacheMinutes,
    liveCacheMinutes: freshnessSafeLiveCacheMinutes,
    dailyRequestBudget: config.apiFootballDailyRequestBudget,
    leagueScope: config.leagueScope,
    maxLiveEventAgeMinutes: config.maxLiveEventAgeMinutes,
  });

  return new ManagedApiFootballProvider(factory, { retryMinutes: 15 });
}

function footballDataProvider(config: AppConfig): FootballDataFixtureProvider | null {
  if (!config.footballDataToken) return null;
  return new FootballDataFixtureProvider({
    apiKey: config.footballDataToken,
    competitionCodes: [...TRACKED_FOOTBALL_DATA_CODES],
    cacheMinutes: config.footballDataCacheMinutes,
    dailyRequestBudget: config.footballDataDailyRequestBudget,
  });
}

export function createProvider(config: AppConfig): OddsProvider {
  if (config.provider === "mock") return new MockOddsProvider();

  // Acikca ODDS_PROVIDER=the_odds_api secilirse The Odds API ana kaynak olur.
  // Lig kapsami Big Five ust ligleri + English Championship'tir.
  if (config.provider === "the_odds_api") {
    const providers: OddsProvider[] = [theOddsApiProvider(config)];
    const apiFootball = apiFootballProvider(config);
    const footballData = footballDataProvider(config);
    if (apiFootball) providers.push(apiFootball);
    if (footballData) providers.push(footballData);
    return providers.length === 1 ? providers[0]! : new CompositeOddsProvider(providers);
  }

  // Normal production gorev paylasimi:
  // Premier League, Championship, La Liga, Bundesliga, Serie A, Ligue 1.
  // 1) BetExplorer scraping: ana prematch + ek live oranlar.
  // 2) API-Football: gunluk fixture ID katalogu + baslangictan sonra live odds.
  // 3) football-data: gunluk fixture/durum dogrulamasi; odds gorevi yok.
  // 4) The Odds API: scraper gercekten hata verirse sadece prematch acil yedek.
  const scraper = betExplorerScraper(config);
  const liveApi = apiFootballProvider(config) ?? undefined;
  const footballData = footballDataProvider(config);
  const fixtureProviders = footballData ? [footballData] : [];
  const fallbackProvider = config.oddsApiKey ? theOddsApiProvider(config) : undefined;

  const routed = new RoleSeparatedOddsProvider(
    scraper,
    liveApi,
    fixtureProviders,
    fallbackProvider,
    { fallbackCooldownMinutes: 60 },
  );

  // Tek tek kaynak hatalari monitor/Sheet dongusunu durdurmasin.
  return new ResilientOddsProvider(routed);
}
