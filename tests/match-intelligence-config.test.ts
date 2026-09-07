import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("Match Intelligence config", () => {
  it("az sayidaki env ile enable, recent, cache ve min sample ayarlarini okur", () => {
    vi.stubEnv("ODDS_PROVIDER", "mock");
    vi.stubEnv("DRY_RUN", "true");
    vi.stubEnv("HISTORICAL_STORAGE", "json");
    vi.stubEnv("MATCH_INTELLIGENCE_ENABLED", "false");
    vi.stubEnv("MATCH_INTELLIGENCE_RECENT_MATCHES", "15");
    vi.stubEnv("MATCH_INTELLIGENCE_CACHE_MINUTES", "60");
    vi.stubEnv("MATCH_INTELLIGENCE_MIN_SAMPLE", "6");
    expect(loadConfig()).toMatchObject({ matchIntelligenceEnabled: false, matchIntelligenceRecentMatches: 15,
      matchIntelligenceCacheMinutes: 60, matchIntelligenceMinSample: 6 });
  });
});
