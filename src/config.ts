import "dotenv/config";
import path from "node:path";

export type ProviderName = "mock" | "the_odds_api";

export interface AppConfig {
  provider: ProviderName;
  oddsApiKey?: string;
  sportKeys: string[];
  bookmakerKeys: string[];
  regions: string[];
  tolerancePercent: number;
  pollIntervalSeconds: number;
  maxQuoteAgeSeconds: number;
  maxLiveEventAgeMinutes: number;
  alertCooldownSeconds: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  dryRun: boolean;
  port: number;
  adminToken?: string;
  stateFile: string;
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
  const providerRaw = optional("ODDS_PROVIDER") ?? "mock";
  if (providerRaw !== "mock" && providerRaw !== "the_odds_api") {
    throw new Error("ODDS_PROVIDER mock veya the_odds_api olmali.");
  }

  const config: AppConfig = {
    provider: providerRaw,
    oddsApiKey: optional("ODDS_API_KEY"),
    sportKeys: csv("SPORT_KEYS", "soccer_epl,soccer_uefa_champs_league"),
    bookmakerKeys: csv("BOOKMAKER_KEYS", "pinnacle,betfair_ex_eu,betfair,bet365"),
    regions: csv("REGIONS", "eu,uk"),
    tolerancePercent: numberValue("ODDS_TOLERANCE_PERCENT", 2, { min: 0, max: 100 }),
    pollIntervalSeconds: numberValue("POLL_INTERVAL_SECONDS", 60, { min: 10, max: 86_400 }),
    maxQuoteAgeSeconds: numberValue("MAX_QUOTE_AGE_SECONDS", 300, { min: 1, max: 86_400 }),
    maxLiveEventAgeMinutes: numberValue("MAX_LIVE_EVENT_AGE_MINUTES", 180, { min: 1, max: 600 }),
    alertCooldownSeconds: numberValue("ALERT_COOLDOWN_SECONDS", 600, { min: 0, max: 604_800 }),
    telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
    telegramChatId: optional("TELEGRAM_CHAT_ID"),
    dryRun: booleanValue("DRY_RUN", true),
    port: numberValue("PORT", 3000, { min: 1, max: 65_535 }),
    adminToken: optional("ADMIN_TOKEN"),
    stateFile: path.resolve(optional("STATE_FILE") ?? "./data/alert-state.json"),
  };

  if (config.provider === "the_odds_api" && !config.oddsApiKey) {
    throw new Error("ODDS_PROVIDER=the_odds_api icin ODDS_API_KEY gerekli.");
  }
  if (!config.dryRun && (!config.telegramBotToken || !config.telegramChatId)) {
    throw new Error("DRY_RUN=false iken TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID gerekli.");
  }
  return config;
}
