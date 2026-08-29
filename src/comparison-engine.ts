import { createHash } from "node:crypto";
import type { OddsMatch, OddsQuote } from "./domain.js";

export interface ComparisonOptions {
  tolerancePercent: number;
  maxQuoteAgeSeconds: number;
}

export interface ComparisonResult {
  freshQuotes: OddsQuote[];
  matches: OddsMatch[];
}

export function normalizeName(value: string): string {
  return value
    .replaceAll("ı", "i")
    .replaceAll("İ", "I")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+(fc|cf|fk|sk)$/g, "");
}

function kickoffBucket(isoTime: string): string {
  const value = Date.parse(isoTime);
  if (!Number.isFinite(value)) return "invalid-time";
  return String(Math.round(value / (5 * 60_000)));
}

export function eventKey(quote: OddsQuote): string {
  return [
    normalizeName(quote.homeTeam),
    normalizeName(quote.awayTeam),
    kickoffBucket(quote.commenceTime),
    quote.phase,
  ].join("|");
}

function normalizedLine(line: number | null): string {
  return line === null ? "none" : Number(line).toFixed(3);
}

export function marketSignature(quote: OddsQuote): string {
  return [quote.marketKey, quote.period, quote.selectionKey, normalizedLine(quote.line)].join("|");
}

export function relativeDifferencePercent(priceA: number, priceB: number): number {
  if (!Number.isFinite(priceA) || !Number.isFinite(priceB) || priceA <= 0 || priceB <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (Math.abs(priceA - priceB) / ((priceA + priceB) / 2)) * 100;
}

function isFresh(quote: OddsQuote, now: Date, maxAgeSeconds: number): boolean {
  const timestamp = Date.parse(quote.updatedAt);
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = now.getTime() - timestamp;
  return ageMs <= maxAgeSeconds * 1000 && ageMs >= -60_000;
}

function stableAlertId(event: string, market: string, quoteA: OddsQuote, quoteB: OddsQuote): string {
  // Ayni mac/pazar ve ayni fiyat cifti tek alarmdir. Oranlardan biri gercekten
  // degistiginde yeni ID olusur ve yeni Telegram bildirimi gonderilebilir.
  const prices = [
    `${quoteA.bookmakerKey}:${quoteA.price.toFixed(3)}`,
    `${quoteB.bookmakerKey}:${quoteB.price.toFixed(3)}`,
  ].sort();
  return createHash("sha256").update(`${event}|${market}|${prices.join("|")}`).digest("hex").slice(0, 24);
}

export function findOddsMatches(
  quotes: OddsQuote[],
  options: ComparisonOptions,
  now = new Date(),
): ComparisonResult {
  const freshQuotes = quotes.filter((quote) => isFresh(quote, now, options.maxQuoteAgeSeconds));
  const grouped = new Map<string, Map<string, OddsQuote>>();

  for (const quote of freshQuotes) {
    if (!Number.isFinite(quote.price) || quote.price <= 1) continue;
    const event = eventKey(quote);
    const market = marketSignature(quote);
    const groupKey = `${event}::${market}`;
    const byBookmaker = grouped.get(groupKey) ?? new Map<string, OddsQuote>();
    const existing = byBookmaker.get(quote.bookmakerKey);
    if (!existing || Date.parse(quote.updatedAt) > Date.parse(existing.updatedAt)) {
      byBookmaker.set(quote.bookmakerKey, quote);
    }
    grouped.set(groupKey, byBookmaker);
  }

  const matches: OddsMatch[] = [];
  for (const byBookmaker of grouped.values()) {
    const group = [...byBookmaker.values()].sort((a, b) => a.bookmakerKey.localeCompare(b.bookmakerKey));
    let bestPair: { quoteA: OddsQuote; quoteB: OddsQuote; difference: number } | null = null;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const quoteA = group[i];
        const quoteB = group[j];
        if (!quoteA || !quoteB) continue;
        const difference = relativeDifferencePercent(quoteA.price, quoteB.price);
        if (difference > options.tolerancePercent) continue;
        if (!bestPair || difference < bestPair.difference) bestPair = { quoteA, quoteB, difference };
      }
    }
    if (!bestPair) continue;
    const event = eventKey(bestPair.quoteA);
    const market = marketSignature(bestPair.quoteA);
    matches.push({
      id: stableAlertId(event, market, bestPair.quoteA, bestPair.quoteB),
      eventKey: event,
      marketSignature: market,
      phase: bestPair.quoteA.phase,
      relativeDifferencePercent: bestPair.difference,
      quoteA: bestPair.quoteA,
      quoteB: bestPair.quoteB,
      detectedAt: now.toISOString(),
    });
  }

  return { freshQuotes, matches };
}
