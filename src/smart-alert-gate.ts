import type { OddsAnalysisSignal } from "./domain.js";
import type { SelectionConsensus } from "./market-analysis-engine.js";

export interface SmartAlertGateOptions {
  minSources?: number;
  minConfidenceScore?: number;
  minValuePercent?: number;
  maxDispersionPercent?: number;
  blockLiveWinnerWithoutGameState?: boolean;
}

function sameLine(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.001;
}

function findConsensus(signal: OddsAnalysisSignal, consensus: SelectionConsensus[]): SelectionConsensus | undefined {
  return consensus.find((row) =>
    row.event === signal.event &&
    row.market === signal.market &&
    row.selection === signal.selection &&
    sameLine(row.line, signal.line)
  );
}

export function fairOdds(row: SelectionConsensus): number {
  if (!Number.isFinite(row.fairProbabilityPercent) || row.fairProbabilityPercent <= 0) return 0;
  return 100 / row.fairProbabilityPercent;
}

export function valuePercent(price: number, row: SelectionConsensus): number {
  const fair = fairOdds(row);
  if (!Number.isFinite(price) || price <= 1 || fair <= 1) return Number.NEGATIVE_INFINITY;
  return ((price / fair) - 1) * 100;
}

/**
 * Telegram bildirimi icin ham oran hareketini "aday" sanmayiz.
 *
 * Kurallar:
 * - arbitraj ayri matematiksel sinyal oldugu icin korunur;
 * - oran dususu tek basina asla aday degildir (daha dusuk odeme = otomatik edge degil);
 * - en az 3 bagimsiz kaynak ve yuksek piyasa guveni gerekir;
 * - fiyat, marj-temizlenmis adil oranin anlamli sekilde UZERINDE olmali;
 * - piyasanin altindaki source outlier (kotu fiyat) bildirim olmaz;
 * - canli 1X2/kazanan sinyali skor+dakika baglami olmadan gonderilmez.
 */
export function selectSmartAnalysisAlerts(
  signals: OddsAnalysisSignal[],
  consensus: SelectionConsensus[],
  options: SmartAlertGateOptions = {},
): OddsAnalysisSignal[] {
  const minSources = options.minSources ?? 3;
  const minConfidence = options.minConfidenceScore ?? 75;
  const minValue = options.minValuePercent ?? 2.5;
  const maxDispersion = options.maxDispersionPercent ?? 12;
  const blockLiveWinner = options.blockLiveWinnerWithoutGameState ?? true;

  const selected: OddsAnalysisSignal[] = [];
  for (const signal of signals) {
    if (signal.type === "arbitrage") {
      selected.push(signal);
      continue;
    }

    // Dusen oran, sonucu tahmin eden bir model degildir. Sadece piyasa hareketidir.
    if (signal.type === "odds_drop" || signal.type === "close_odds") continue;

    const row = findConsensus(signal, consensus);
    if (!row) continue;
    if (row.sourceCount < minSources) continue;
    if (row.confidenceScore < minConfidence) continue;
    if (row.dispersionPercent > maxDispersion) continue;

    // Canli mac sonucu orani skor ve dakika nedeniyle dusmus olabilir. Bu baglam
    // OddsQuote icinde yok; bu nedenle bunu takim gucu gibi yorumlamiyoruz.
    if (
      blockLiveWinner &&
      row.phase === "live" &&
      (row.marketKey === "match_winner_3way" || row.marketKey === "match_winner_2way")
    ) {
      continue;
    }

    const price = signal.currentPrice ?? row.bestPrice;
    if (!Number.isFinite(price) || price <= 1) continue;

    // Kaynagin orani piyasa medyanindan dusukse bu firsat degil, daha kotu fiyattir.
    if (
      signal.type === "source_outlier" &&
      Number.isFinite(signal.consensusPrice) &&
      price <= (signal.consensusPrice ?? 0)
    ) {
      continue;
    }

    if (valuePercent(price, row) < minValue) continue;
    selected.push(signal);
  }
  return selected;
}
