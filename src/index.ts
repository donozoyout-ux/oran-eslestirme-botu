import { JsonAlertStore } from "./alert-store.js";
import { loadConfig } from "./config.js";
import { errorMessage, logger } from "./logger.js";
import { OddsMonitor } from "./monitor.js";
import { ConsoleNotifier, TelegramNotifier } from "./notifiers.js";
import { createProvider } from "./providers/index.js";
import { createServer } from "./server.js";

try {
  const config = loadConfig();
  const provider = createProvider(config);
  const notifier = config.dryRun
    ? new ConsoleNotifier()
    : new TelegramNotifier(config.telegramBotToken!, config.telegramChatId!, config.surpriseOddsThreshold);
  const alertStore = new JsonAlertStore(config.stateFile, config.alertCooldownSeconds);
  const monitor = new OddsMonitor(provider, notifier, alertStore, {
    tolerancePercent: config.tolerancePercent,
    maxQuoteAgeSeconds: config.maxQuoteAgeSeconds,
    pollIntervalSeconds: config.pollIntervalSeconds,
  });
  const server = createServer(monitor, config.adminToken);

  server.listen(config.port, "0.0.0.0", () => {
    logger.info("Servis baslatildi.", {
      port: config.port,
      provider: provider.name,
      notifier: notifier.name,
      tolerancePercent: config.tolerancePercent,
      pollIntervalSeconds: config.pollIntervalSeconds,
      surpriseOddsThreshold: config.surpriseOddsThreshold,
      sportKeys: config.sportKeys,
      bookmakerKeys: config.bookmakerKeys,
    });
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
