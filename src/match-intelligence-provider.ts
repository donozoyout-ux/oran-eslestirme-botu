import type { MatchFixture } from "./domain.js";
import type { MatchIntelligenceInput } from "./match-intelligence.js";

export interface MatchIntelligenceResolution {
  status: "resolved" | "not_found" | "ambiguous";
  confidence?: number;
  error?: string;
}

export interface MatchIntelligenceProviderResult {
  input: MatchIntelligenceInput;
  rateLimitRemaining: number | null;
  rateLimitResetSeconds: number | null;
  resolution?: MatchIntelligenceResolution;
  sources?: string[];
}

export interface MatchIntelligenceDataProvider {
  fetch(
    target: MatchFixture & { canonicalEventId: string },
    signal?: AbortSignal,
  ): Promise<MatchIntelligenceProviderResult>;
}
