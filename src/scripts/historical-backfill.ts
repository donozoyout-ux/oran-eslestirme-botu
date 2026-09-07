import { loadConfig } from "../config.js";
import { createHistoricalRepository } from "../historical-repository-factory.js";
import { SportmonksProvider } from "../providers/sportmonks-provider.js";
import { SportmonksHistoricalBackfill } from "../sportmonks-historical-backfill.js";

const config = loadConfig();
if (!config.sportmonksToken) throw new Error("Historical backfill icin SPORTMONKS_API_TOKEN gerekli.");
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = daysArg ? Number(daysArg.slice(7)) : config.historicalBackfillDays;
const recheck = process.argv.includes("--recheck");
const repository = await createHistoricalRepository(config);
try {
  const provider = new SportmonksProvider({ apiToken:config.sportmonksToken,bookmakerKeys:config.bookmakerKeys,
    refreshMinutes:config.sportmonksRefreshMinutes,maxPages:config.sportmonksMaxPages,leagueScope:config.historicalLeagueScope,
    maxLiveEventAgeMinutes:config.maxLiveEventAgeMinutes,includeOdds:false });
  const result = await new SportmonksHistoricalBackfill(provider, repository, {
    historicalLeagueScope: config.historicalLeagueScope,
    databaseConfigured: Boolean(config.databaseUrl),
    storageRequested: config.historicalStorage,
  }).run(days, new Date(), { recheck });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await repository.close?.(); }
