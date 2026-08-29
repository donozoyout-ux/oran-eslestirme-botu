import type { AppConfig } from "../config.js";
import type { OddsProvider } from "../domain.js";
import { MockOddsProvider } from "./mock-provider.js";
import { TheOddsApiProvider } from "./the-odds-api-provider.js";
import { BetExplorerScraperProvider } from "./betexplorer-scraper-provider.js";
import { CompositeOddsProvider } from "./composite-provider.js";

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

export function createProvider(config: AppConfig): OddsProvider {
  if (config.provider === "mock") return new MockOddsProvider();
  if (config.provider === "betexplorer_scraper") {
    const scraper = new BetExplorerScraperProvider({
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
    return config.oddsApiKey ? new CompositeOddsProvider([scraper, theOddsApiProvider(config)]) : scraper;
  }
  return theOddsApiProvider(config);
}
