import type { SelectionConsensus } from "./market-analysis-engine.js";

export type CouponVerdict = "PLAYABLE" | "WATCH" | "AVOID";

export interface CouponCandidate {
  event: string;
  phase: "prematch" | "live";
  market: string;
  selection: string;
  line: number | null;
  bookmaker: string;
  odds: number;
  fairOdds: number;
  fairProbabilityPercent: number;
  valuePercent: number;
  confidenceScore: number;
  sourceCount: number;
  dispersionPercent: number;
  score: number;
  verdict: CouponVerdict;
  reasons: string[];
  detectedAt: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rankCouponCandidates(consensus: SelectionConsensus[], limit = 5): CouponCandidate[] {
  return consensus
    .filter((row) => row.bestPrice > 1 && row.fairProbabilityPercent > 0)
    .map((row) => {
      const fairOdds = 100 / row.fairProbabilityPercent;
      const valuePercent = ((row.bestPrice / fairOdds) - 1) * 100;
      const coverageScore = clamp(row.sourceCount / 5, 0, 1) * 15;
      const agreementScore = clamp(1 - row.dispersionPercent / 12, 0, 1) * 15;
      const valueScore = clamp(valuePercent / 8, 0, 1) * 30;
      const confidenceComponent = clamp(row.confidenceScore / 100, 0, 1) * 40;
      const score = Math.round(confidenceComponent + coverageScore + agreementScore + valueScore);
      const verdict: CouponVerdict = score >= 75 && valuePercent >= 2 && row.sourceCount >= 3
        ? "PLAYABLE"
        : score >= 58 && valuePercent > 0
          ? "WATCH"
          : "AVOID";
      const reasons: string[] = [];
      reasons.push(`${row.sourceCount} kaynak karşılaştırıldı`);
      reasons.push(`Piyasa güveni ${row.confidenceScore}/100`);
      reasons.push(valuePercent > 0 ? `En iyi oran adil orana göre %${valuePercent.toFixed(1)} yüksek` : "Belirgin fiyat avantajı yok");
      if (row.dispersionPercent <= 4) reasons.push("Kaynaklar birbirine yakın fiyatlıyor");
      return {
        event: row.event,
        phase: row.phase,
        market: row.market,
        selection: row.selection,
        line: row.line,
        bookmaker: row.bestBookmaker,
        odds: row.bestPrice,
        fairOdds,
        fairProbabilityPercent: row.fairProbabilityPercent,
        valuePercent,
        confidenceScore: row.confidenceScore,
        sourceCount: row.sourceCount,
        dispersionPercent: row.dispersionPercent,
        score,
        verdict,
        reasons,
        detectedAt: row.detectedAt,
      };
    })
    .sort((a, b) => b.score - a.score || b.valuePercent - a.valuePercent)
    .slice(0, limit);
}
