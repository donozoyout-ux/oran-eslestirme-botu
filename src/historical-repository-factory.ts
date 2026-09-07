import type { AppConfig } from "./config.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";
import { JsonHistoricalOddsRepository } from "./historical-odds-repository.js";
import { PostgresHistoricalOddsRepository } from "./postgres-historical-odds-repository.js";

export async function createHistoricalRepository(config: Pick<AppConfig, "databaseUrl"|"historicalStorage"|"historicalOddsFile">): Promise<HistoricalOddsRepository> {
  const usePostgres = config.historicalStorage === "postgres" || (config.historicalStorage === "auto" && Boolean(config.databaseUrl));
  if (usePostgres && !config.databaseUrl) throw new Error("HISTORICAL_STORAGE=postgres icin DATABASE_URL gerekli.");
  const repository: HistoricalOddsRepository = usePostgres
    ? new PostgresHistoricalOddsRepository(config.databaseUrl!)
    : new JsonHistoricalOddsRepository(config.historicalOddsFile);
  await repository.initialize?.();
  return repository;
}
