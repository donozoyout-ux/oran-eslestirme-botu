import { loadConfig } from "../config.js";
import { PostgresHistoricalOddsRepository } from "../postgres-historical-odds-repository.js";

const config = loadConfig();
if (!config.databaseUrl) throw new Error("db:migrate icin DATABASE_URL gerekli.");
const repository = new PostgresHistoricalOddsRepository(config.databaseUrl);
try { await repository.initialize(); process.stdout.write("Historical PostgreSQL migration tamamlandi.\n"); }
finally { await repository.close(); }
