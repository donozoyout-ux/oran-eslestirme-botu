import "dotenv/config";
import path from "node:path";

export type ProviderName = "mock" | "the_odds_api" | "betexplorer_scraper";

export interface AppConfig {
  provider: ProviderName;
  oddsApiKey?: string;
  sportKeys: string[];
  bookmakerKeys: string[];
  regions: string[];
  scraperMaxMatches: number;
  scraperPageTimeoutMs: number;
  scraperWaitMs: number;
  scraperAllowVisibleBookmakerFallback: boolean;
  prematchTrackHours: number;
  prematchFarPollMinutes: number;
  prematchNearPollMinutes: number;
  prematchFinalPollMinutes: number;
  livePollMinutes: number;
  chromiumExecutablePath?: string;
  tolerancePercent: number;
  pollIntervalSeconds: number;
  maxQuoteAgeSeconds: number;
  maxLiveEventAgeMinutes: number;
  alertCooldownSeconds: number;
  surpriseOddsThreshold: number;
  oddsMovementThresholdPercent: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  dryRun: boolean;
  port: number;
  adminToken?: string;
  stateFile: string;
  dailySheetFile: string;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function csv(name: string, fallback: string): string[] {
  return (optional(name) ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberValue(name: string, fallback: number, constraints: { min: number; max: number }): number {
  const raw = optional(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < constraints.min || value > constraints.max) {
    throw new Error(`${name} ${constraints.min}-${constraints.max} araliginda sayi olmali.`);
  }
  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const raw = optional(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} true veya false olmali.`);
}

export function loadConfig(): AppConfig {
  const configuredProvider = optional("ODDS_PROVIDER") ?? "mock";
  const upgradeLegacyProductionMock =
    configuredProvider === "mock" &&
    process.env.NODE_ENV === "production" &&
    !booleanValue("ALLOW_MOCK_IN_PRODUCTION", false);
  const providerRaw = upgradeLegacyProductionMock ? "betexplorer_scraper" : configuredProvider;
  if (providerRaw !== "mock" && providerRaw !== "the_odds_api" && providerRaw !== "betexplorer_scraper") {
    throw new Error("ODDS_PROVIDER mock, the_odds_api veya betexplorer_scraper olmali.");
  }

  const config: AppConfig = {
    provider: providerRaw,
    oddsApiKey: optional("ODDS_API_KEY"),
    sportKeys: csv("SPORT_KEYS", "soccer_epl,soccer_uefa_champs_league"),
    bookmakerKeys: csv("BOOKMAKER_KEYS", "pinnacle,betfair_ex_eu,betfair,bet365"),
    regions: csv("REGIONS", "eu,uk"),
    scraperMaxMatches: numberValue("SCRAPER_MAX_MATCHES", 2, { min: 1, max: 10 }),
    scraperPageTimeoutMs: numberValue("SCRAPER_PAGE_TIMEOUT_MS", 60_000, { min: 5_000, max: 60_000 }),
    scraperWaitMs: numberValue("SCRAPER_WAIT_MS", 2_500, { min: 500, max: 10_000 }),
    scraperAllowVisibleBookmakerFallback: booleanValue("SCRAPER_ALLOW_VISIBLE_BOOKMAKER_FALLBACK", true),
    prematchTrackHours: numberValue("PREMATCH_TRACK_HOURS", 6, { min: 1, max: 48 }),
    prematchFarPollMinutes: numberValue("PREMATCH_FAR_POLL_MINUTES", 60, { min: 1, max: 720 }),
    prematchNearPollMinutes: numberValue("PREMATCH_NEAR_POLL_MINUTES", 15, { min: 1, max: 180 }),
    prematchFinalPollMinutes: numberValue("PREMATCH_FINAL_POLL_MINUTES", 5, { min: 1, max: 60 }),
    livePollMinutes: numberValue("LIVE_POLL_MINUTES", 3, { min: 1, max: 30 }),
    chromiumExecutablePath: optional("CHROMIUM_EXECUTABLE_PATH"),
    tolerancePercent: numberValue("ODDS_TOLERANCE_PERCENT", 2, { min: 0, max: 100 }),
    pollIntervalSeconds: numberValue("POLL_INTERVAL_SECONDS", 60, { min: 10, max: 86_400 }),
    maxQuoteAgeSeconds: numberValue("MAX_QUOTE_AGE_SECONDS", 300, { min: 1, max: 86_400 }),
    maxLiveEventAgeMinutes: numberValue("MAX_LIVE_EVENT_AGE_MINUTES", 180, { min: 1, max: 600 }),
    alertCooldownSeconds: numberValue("ALERT_COOLDOWN_SECONDS", 600, { min: 0, max: 604_800 }),
    surpriseOddsThreshold: numberValue("SURPRISE_ODDS_THRESHOLD", 2.5, { min: 1.01, max: 1_000 }),
    oddsMovementThresholdPercent: numberValue("ODDS_MOVEMENT_THRESHOLD_PERCENT", 8, { min: 0.1, max: 100 }),
    telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
    telegramChatId: optional("TELEGRAM_CHAT_ID"),
    dryRun: booleanValue("DRY_RUN", true),
    port: numberValue("PORT", 3000, { min: 1, max: 65_535 }),
    adminToken: optional("ADMIN_TOKEN"),
    stateFile: path.resolve(optional("STATE_FILE") ?? "./data/alert-state.json"),
    dailySheetFile: path.resolve(optional("DAILY_SHEET_FILE") ?? "./data/daily-match-sheet.json"),
  };

  if (config.provider === "the_odds_api" && !config.oddsApiKey) {
    throw new Error("ODDS_PROVIDER=the_odds_api icin ODDS_API_KEY gerekli.");
  }
  if (!config.dryRun && (!config.telegramBotToken || !config.telegramChatId)) {
    throw new Error("DRY_RUN=false iken TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID gerekli.");
  }
  return config;
}
