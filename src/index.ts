import { JsonAlertStore } from "./alert-store.js";
import { loadConfig } from "./config.js";
import { JsonDailyMatchSheet } from "./daily-match-sheet.js";
import { GoogleSheetsMirror } from "./google-sheets-mirror.js";
import { errorMessage, logger } from "./logger.js";
import { OddsMonitor } from "./monitor.js";
import { ConsoleNotifier, TelegramNotifier } from "./notifiers.js";
import { createProvider } from "./providers/index.js";
import { createServer } from "./server.js";
import { sendTelegramStartupMessage } from "./telegram-health.js";

try {
  const config = loadConfig();
  const provider = createProvider(config);
  const notifier = config.dryRun
    ? new ConsoleNotifier()
    : new TelegramNotifier(config.telegramBotToken!, config.telegramChatId!, config.surpriseOddsThreshold);
  const alertStore = new JsonAlertStore(config.stateFile, config.alertCooldownSeconds);
  const googleSheetsMirror =
    config.googleSheetsSpreadsheetId && config.googleServiceAccountEmail && config.googlePrivateKey
      ? new GoogleSheetsMirror({
          spreadsheetId: config.googleSheetsSpreadsheetId,
          serviceAccountEmail: config.googleServiceAccountEmail,
          privateKey: config.googlePrivateKey,
        })
      : undefined;
  const dailySheet = new JsonDailyMatchSheet(config.dailySheetFile, config.oddsMovementThresholdPercent, {
    mirror: googleSheetsMirror,
    mirrorSyncMinutes: config.googleSheetsSyncMinutes,
  });
  const monitor = new OddsMonitor(provider, notifier, alertStore, {
    tolerancePercent: config.tolerancePercent,
    maxQuoteAgeSeconds: config.maxQuoteAgeSeconds,
    pollIntervalSeconds: config.pollIntervalSeconds,
    prematchAlertWindowMinutes: config.prematchAlertWindowMinutes,
    prematchAlertMinSources: config.prematchAlertMinSources,
    prematchAlertMinConfidence: config.prematchAlertMinConfidence,
  }, dailySheet);
  const server = createServer(monitor, config.adminToken);

  server.listen(config.port, "0.0.0.0", () => {
    logger.info("Servis baslatildi.", {
      port: config.port,
      provider: provider.name,
      notifier: notifier.name,
      tolerancePercent: config.tolerancePercent,
      pollIntervalSeconds: config.pollIntervalSeconds,
      prematchAlertWindowMinutes: config.prematchAlertWindowMinutes,
      prematchAlertMinSources: config.prematchAlertMinSources,
      prematchAlertMinConfidence: config.prematchAlertMinConfidence,
      surpriseOddsThreshold: config.surpriseOddsThreshold,
      googleSheetsEnabled: Boolean(googleSheetsMirror),
      googleSheetsSyncMinutes: config.googleSheetsSyncMinutes,
      sportKeys: config.sportKeys,
      bookmakerKeys: config.bookmakerKeys,
    });

    if (!config.dryRun) {
      void sendTelegramStartupMessage(config.telegramBotToken!, config.telegramChatId!)
        .then(() => logger.info("Telegram baslangic testi basarili."))
        .catch((error) => logger.error("Telegram baslangic testi basarisiz.", { error: errorMessage(error) }));
    } else {
      logger.warn("Telegram bildirimleri kapali: DRY_RUN=true. Railway Variables icinde DRY_RUN=false yapin.");
    }

    monitor.start();
  });

  const shutdown = (signal: string): void => {
    logger.info("Servis kapatiliyor.", { signal });
    monitor.stop();
    server.close(() => {
      if (!provider.close) {
        process.exit(0);
        return;
      }
      void provider
        .close()
        .catch((error) => logger.warn("Saglayici kapatilamadi.", { error: errorMessage(error) }))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} catch (error) {
  logger.error("Servis baslatilamadi.", { error: errorMessage(error) });
  process.exitCode = 1;
}
