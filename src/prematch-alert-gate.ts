import { createHash } from "node:crypto";
import type { OddsMatch } from "./domain.js";
import type { SelectionConsensus } from "./market-analysis-engine.js";

export interface PrematchAlertGateOptions {
  windowMinutes: number;
  minSources: number;
  minConfidenceScore: number;
  maxDispersionPercent: number;
}

function normalizedLine(line: number | null): string {
  return line === null ? "none" : Number(line).toFixed(3);
}

function consensusKey(row: SelectionConsensus): string {
  return [row.eventKey, row.marketKey, row.period, row.selectionKey, normalizedLine(row.line)].join("|");
}

function matchConsensusKey(match: OddsMatch): string {
  const quote = match.quoteA;
  return [match.eventKey, quote.marketKey, quote.period, quote.selectionKey, normalizedLine(quote.line)].join("|");
}

function minutesUntilKickoff(match: OddsMatch, now: Date): number {
  const kickoff = Date.parse(match.quoteA.commenceTime);
  if (!Number.isFinite(kickoff)) return Number.POSITIVE_INFINITY;
  return (kickoff - now.getTime()) / 60_000;
}

function stableEventAlertId(match: OddsMatch): string {
  return `prematch-close:${createHash("sha256").update(match.eventKey).digest("hex").slice(0, 20)}`;
}

/**
 * Telegram'a her yakin oran ciftini yollamak yerine sadece mac baslamadan onceki
 * son pencerede, en az birkac bagimsiz bookmaker tarafindan dogrulanan sikisik
 * piyasalari secer. Her gercek mac icin en fazla bir yakinlik alarmi doner.
 */
export function selectPrematchCloseAlerts(
  matches: OddsMatch[],
  consensus: SelectionConsensus[],
  now: Date,
  options: PrematchAlertGateOptions,
): OddsMatch[] {
  const consensusByKey = new Map(consensus.map((row) => [consensusKey(row), row]));
  const bestByEvent = new Map<string, { match: OddsMatch; confidence: number; dispersion: number }>();

  for (const match of matches) {
    if (match.phase !== "prematch") continue;
    const minutes = minutesUntilKickoff(match, now);
    if (minutes < 0 || minutes > options.windowMinutes) continue;

    const row = consensusByKey.get(matchConsensusKey(match));
    if (!row) continue;
    if (row.sourceCount < options.minSources) continue;
    if (row.confidenceScore < options.minConfidenceScore) continue;
    if (row.dispersionPercent > options.maxDispersionPercent) continue;

    const candidate = {
      match: { ...match, id: stableEventAlertId(match) },
      confidence: row.confidenceScore,
      dispersion: row.dispersionPercent,
    };
    const existing = bestByEvent.get(match.eventKey);
    if (
      !existing ||
      candidate.confidence > existing.confidence ||
      (candidate.confidence === existing.confidence && candidate.dispersion < existing.dispersion) ||
      (candidate.confidence === existing.confidence &&
        candidate.dispersion === existing.dispersion &&
        candidate.match.relativeDifferencePercent < existing.match.relativeDifferencePercent)
    ) {
      bestByEvent.set(match.eventKey, candidate);
    }
  }

  return [...bestByEvent.values()]
    .sort((a, b) => b.confidence - a.confidence || a.dispersion - b.dispersion)
    .map((candidate) => candidate.match);
}
