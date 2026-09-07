import { loadConfig } from "../config.js";
import { HistoricalExistingDataImporter } from "../historical-existing-data-importer.js";
import { createHistoricalRepository } from "../historical-repository-factory.js";

const config = loadConfig();
const repository = await createHistoricalRepository(config);
try {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
  const result = await new HistoricalExistingDataImporter(repository).importDailyFile(fileArg?.slice(7) ?? config.dailySheetFile, dryRun);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await repository.close?.(); }
