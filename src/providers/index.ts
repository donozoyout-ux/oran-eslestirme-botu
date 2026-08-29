import type { AppConfig } from "../config.js";
import type { OddsProvider } from "../domain.js";
import { MockOddsProvider } from "./mock-provider.js";
import { TheOddsApiProvider } from "./the-odds-api-provider.js";
import { BetExplorerScraperProvider } from "./betexplorer-scraper-provider.js";
import { CompositeOddsProvider } from "./composite-provider.js";
import { ApiFootballProvider } from "./api-football-provider.js";
import { FootballDataFixtureProvider } from "./football-data-fixture-provider.js";

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

function betExplorerProvider(config: AppConfig): BetExplorerScraperProvider {
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

export function createProvider(config: AppConfig): OddsProvider {
  if (config.provider === "mock") return new MockOddsProvider();

  const providers: OddsProvider[] = [];
  if (config.provider === "betexplorer_scraper") providers.push(betExplorerProvider(config));
  if (config.provider === "the_odds_api") providers.push(theOddsApiProvider(config));

  // BetExplorer ana kaynakken eski davranış korunur: ODDS_API_KEY varsa The Odds API yedek kaynak olarak eklenir.
  if (config.provider === "betexplorer_scraper" && config.oddsApiKey) providers.push(theOddsApiProvider(config));

  if (config.apiFootballKey) {
    providers.push(new ApiFootballProvider({
      apiKey: config.apiFootballKey,
      bookmakerKeys: config.bookmakerKeys,
      maxFixtures: config.apiFootballMaxFixtures,
      fixtureCacheMinutes: config.apiFootballFixtureCacheMinutes,
      prematchCacheMinutes: config.apiFootballPrematchCacheMinutes,
      liveCacheMinutes: config.apiFootballLiveCacheMinutes,
      dailyRequestBudget: config.apiFootballDailyRequestBudget,
      leagueScope: config.leagueScope,
      maxLiveEventAgeMinutes: config.maxLiveEventAgeMinutes,
    }));
  }

  if (config.footballDataToken) {
    providers.push(new FootballDataFixtureProvider({
      apiKey: config.footballDataToken,
      competitionCodes: config.footballDataCompetitionCodes,
      cacheMinutes: config.footballDataCacheMinutes,
      dailyRequestBudget: config.footballDataDailyRequestBudget,
    }));
  }

  if (providers.length === 0) throw new Error("Aktif veri kaynağı bulunamadı.");
  return providers.length === 1 ? providers[0]! : new CompositeOddsProvider(providers);
}
