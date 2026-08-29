import { createHash } from "node:crypto";
import type { OddsAnalysisSignal, OddsQuote } from "./domain.js";
import { eventKey } from "./comparison-engine.js";

export interface MarketAnalysisOptions {
  outlierThresholdPercent?: number;
  minConfidenceScore?: number;
  minArbitrageMarginPercent?: number;
}

export interface SelectionConsensus {
  eventKey: string;
  event: string;
  phase: OddsQuote["phase"];
  marketKey: OddsQuote["marketKey"];
  market: string;
  period: OddsQuote["period"];
  selectionKey: string;
  selection: string;
  line: number | null;
  sourceCount: number;
  consensusPrice: number;
  fairProbabilityPercent: number;
  dispersionPercent: number;
  confidenceScore: number;
  bestBookmaker: string;
  bestPrice: number;
  detectedAt: string;
}

export interface ArbitrageLeg {
  selectionKey: string;
  selection: string;
  bookmaker: string;
  price: number;
}

export interface ArbitrageOpportunity {
  id: string;
  eventKey: string;
  event: string;
  phase: OddsQuote["phase"];
  marketKey: OddsQuote["marketKey"];
  market: string;
  period: OddsQuote["period"];
  line: number | null;
  impliedProbabilitySum: number;
  marginPercent: number;
  legs: ArbitrageLeg[];
  detectedAt: string;
}

export interface MarketAnalysisResult {
  consensus: SelectionConsensus[];
  arbitrage: ArbitrageOpportunity[];
  alertSignals: OddsAnalysisSignal[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function relativeDifferencePercent(value: number, reference: number): number {
  if (value <= 0 || reference <= 0) return 0;
  return (Math.abs(value - reference) / reference) * 100;
}

function normalizedLine(line: number | null): string {
  return line === null ? "none" : Number(line).toFixed(3);
}

function marketGroupKey(quote: OddsQuote): string {
  return [eventKey(quote), quote.marketKey, quote.period, normalizedLine(quote.line)].join("|");
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function expectedOutcomeCount(marketKey: OddsQuote["marketKey"]): number | null {
  if (marketKey === "match_winner_3way" || marketKey === "double_chance") return 3;
  if (
    marketKey === "match_winner_2way" ||
    marketKey === "total_goals" ||
    marketKey === "handicap" ||
    marketKey === "both_teams_to_score"
  ) {
    return 2;
  }
  return null;
}

function confidenceScore(sourceCount: number, dispersionPercent: number, completeBookmakers: number): number {
  const coverage = Math.min(sourceCount / 5, 1) * 45;
  const agreement = Math.max(0, 1 - dispersionPercent / 12) * 35;
  const completeness = Math.min(completeBookmakers / 3, 1) * 20;
  return Math.round(Math.max(0, Math.min(100, coverage + agreement + completeness)));
}

function latestQuotes(quotes: OddsQuote[]): OddsQuote[] {
  const latest = new Map<string, OddsQuote>();
  for (const quote of quotes) {
    if (!Number.isFinite(quote.price) || quote.price <= 1) continue;
    const key = [marketGroupKey(quote), quote.bookmakerKey, quote.selectionKey].join("|");
    const existing = latest.get(key);
    if (!existing || Date.parse(quote.updatedAt) > Date.parse(existing.updatedAt)) latest.set(key, quote);
  }
  return [...latest.values()];
}

export function analyzeOddsMarket(
  quotes: OddsQuote[],
  options: MarketAnalysisOptions = {},
  now = new Date(),
): MarketAnalysisResult {
  const outlierThreshold = options.outlierThresholdPercent ?? 7;
  const minConfidence = options.minConfidenceScore ?? 70;
  const minArbitrageMargin = options.minArbitrageMarginPercent ?? 0.2;
  const grouped = new Map<string, OddsQuote[]>();

  for (const quote of latestQuotes(quotes)) {
    const key = marketGroupKey(quote);
    const group = grouped.get(key) ?? [];
    group.push(quote);
    grouped.set(key, group);
  }

  const consensus: SelectionConsensus[] = [];
  const arbitrage: ArbitrageOpportunity[] = [];
  const alertSignals: OddsAnalysisSignal[] = [];

  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const sample = group[0]!;
    const byBookmaker = new Map<string, OddsQuote[]>();
    for (const quote of group) {
      const bookmakerQuotes = byBookmaker.get(quote.bookmakerKey) ?? [];
      bookmakerQuotes.push(quote);
      byBookmaker.set(quote.bookmakerKey, bookmakerQuotes);
    }

    const expected = expectedOutcomeCount(sample.marketKey);
    const fairProbabilities = new Map<string, number[]>();
    let completeBookmakers = 0;
    for (const bookmakerQuotes of byBookmaker.values()) {
      const uniqueSelections = new Map(bookmakerQuotes.map((quote) => [quote.selectionKey, quote]));
      if (expected !== null && uniqueSelections.size < expected) continue;
      if (uniqueSelections.size < 2) continue;
      const overround = [...uniqueSelections.values()].reduce((sum, quote) => sum + 1 / quote.price, 0);
      if (!Number.isFinite(overround) || overround <= 0) continue;
      completeBookmakers += 1;
      for (const quote of uniqueSelections.values()) {
        const list = fairProbabilities.get(quote.selectionKey) ?? [];
        list.push((1 / quote.price) / overround);
        fairProbabilities.set(quote.selectionKey, list);
      }
    }

    const bySelection = new Map<string, OddsQuote[]>();
    for (const quote of group) {
      const selectionQuotes = bySelection.get(quote.selectionKey) ?? [];
      selectionQuotes.push(quote);
      bySelection.set(quote.selectionKey, selectionQuotes);
    }

    for (const selectionQuotes of bySelection.values()) {
      const first = selectionQuotes[0]!;
      const prices = selectionQuotes.map((quote) => quote.price);
      const consensusPrice = median(prices);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const dispersionPercent = consensusPrice > 0 ? ((maxPrice - minPrice) / consensusPrice) * 100 : 0;
      const best = selectionQuotes.reduce((current, quote) => (quote.price > current.price ? quote : current));
      const fairValues = fairProbabilities.get(first.selectionKey) ?? [];
      const fairProbability =
        fairValues.length > 0
          ? fairValues.reduce((sum, value) => sum + value, 0) / fairValues.length
          : 1 / consensusPrice;
      const confidence = confidenceScore(selectionQuotes.length, dispersionPercent, completeBookmakers);
      const row: SelectionConsensus = {
        eventKey: eventKey(first),
        event: `${first.homeTeam} - ${first.awayTeam}`,
        phase: first.phase,
        marketKey: first.marketKey,
        market: first.marketName,
        period: first.period,
        selectionKey: first.selectionKey,
        selection: first.selectionName,
        line: first.line,
        sourceCount: selectionQuotes.length,
        consensusPrice,
        fairProbabilityPercent: fairProbability * 100,
        dispersionPercent,
        confidenceScore: confidence,
        bestBookmaker: best.bookmakerName,
        bestPrice: best.price,
        detectedAt: now.toISOString(),
      };
      consensus.push(row);

      if (selectionQuotes.length >= 3 && confidence >= minConfidence) {
        for (const quote of selectionQuotes) {
          const deviation = relativeDifferencePercent(quote.price, consensusPrice);
          if (deviation < outlierThreshold) continue;
          const direction = quote.price > consensusPrice ? "yüksek" : "düşük";
          const signalKey = [marketGroupKey(quote), quote.selectionKey, quote.bookmakerKey, direction].join("|");
          alertSignals.push({
            id: stableId("outlier", signalKey),
            type: "source_outlier",
            event: row.event,
            market: row.market,
            selection: row.selection,
            line: row.line,
            detail: `${quote.bookmakerName} oranı ${quote.price.toFixed(2)}; piyasa medyanı ${consensusPrice.toFixed(2)}. Sapma %${deviation.toFixed(1)} (${direction}). Güven ${confidence}/100.`,
            detectedAt: now.toISOString(),
            bookmaker: quote.bookmakerName,
            currentPrice: quote.price,
            consensusPrice,
            fairProbabilityPercent: row.fairProbabilityPercent,
            sourceCount: row.sourceCount,
            confidenceScore: confidence,
            changePercent: quote.price > consensusPrice ? deviation : -deviation,
          });
        }
      }
    }

    const bestBySelection = [...bySelection.values()].map((selectionQuotes) =>
      selectionQuotes.reduce((current, quote) => (quote.price > current.price ? quote : current)),
    );
    const uniqueSelectionCount = bestBySelection.length;
    if (uniqueSelectionCount < 2 || (expected !== null && uniqueSelectionCount < expected)) continue;
    const impliedProbabilitySum = bestBySelection.reduce((sum, quote) => sum + 1 / quote.price, 0);
    const marginPercent = (1 - impliedProbabilitySum) * 100;
    if (marginPercent < minArbitrageMargin) continue;
    const arbKey = [marketGroupKey(sample), ...bestBySelection.map((quote) => `${quote.selectionKey}:${quote.bookmakerKey}:${quote.price}`)].join("|");
    const opportunity: ArbitrageOpportunity = {
      id: stableId("arb", arbKey),
      eventKey: eventKey(sample),
      event: `${sample.homeTeam} - ${sample.awayTeam}`,
      phase: sample.phase,
      marketKey: sample.marketKey,
      market: sample.marketName,
      period: sample.period,
      line: sample.line,
      impliedProbabilitySum,
      marginPercent,
      legs: bestBySelection.map((quote) => ({
        selectionKey: quote.selectionKey,
        selection: quote.selectionName,
        bookmaker: quote.bookmakerName,
        price: quote.price,
      })),
      detectedAt: now.toISOString(),
    };
    arbitrage.push(opportunity);
    alertSignals.push({
      id: opportunity.id,
      type: "arbitrage",
      event: opportunity.event,
      market: opportunity.market,
      selection: opportunity.legs.map((leg) => leg.selection).join(" / "),
      line: opportunity.line,
      detail: `Teorik arbitraj marjı %${marginPercent.toFixed(2)}. ${opportunity.legs.map((leg) => `${leg.selection}: ${leg.bookmaker} ${leg.price.toFixed(2)}`).join(" | ")}`,
      detectedAt: now.toISOString(),
      confidenceScore: 100,
      arbitrageMarginPercent: marginPercent,
      sourceCount: new Set(bestBySelection.map((quote) => quote.bookmakerKey)).size,
    });
  }

  return {
    consensus: consensus.sort((a, b) => b.confidenceScore - a.confidenceScore),
    arbitrage: arbitrage.sort((a, b) => b.marginPercent - a.marginPercent),
    alertSignals,
  };
}
