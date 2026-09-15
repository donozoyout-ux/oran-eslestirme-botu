import { createHash } from "node:crypto";
import type { MatchIntelligenceResult } from "./match-intelligence.js";
import type { MonitorStatus, RecentQuoteView } from "./monitor.js";

export type V2Decision = "strong_candidate" | "candidate" | "watch" | "pass" | "insufficient_data";

export interface V2OddsCell { label: string; price: number; bookmaker: string; provider: string; }
export interface V2SourceOddsRow { provider: string; source: string; prices: Record<string, number>; }
export interface V2FavoriteAnalysis {
  side: "home" | "draw" | "away" | "none";
  team: string | null;
  score: number;
  marketProbability: number | null;
  reasons: string[];
  risks: string[];
}
export interface V2Recommendation {
  decision: V2Decision;
  market: string | null;
  selection: string | null;
  bestPrice: number | null;
  bookmaker: string | null;
  score: number;
  confidence: number;
  sourceCount: number;
  priceAdvantagePercent: number | null;
  reasons: string[];
  risks: string[];
}
export interface V2Match {
  canonicalEventId: string;
  event: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  phase: "prematch" | "live";
  sources: string[];
  sourceCount: number;
  bestOdds: Record<string, V2OddsCell>;
  oddsTable: V2SourceOddsRow[];
  favorite: V2FavoriteAnalysis;
  recommendation: V2Recommendation;
  dataConfidence: number;
  form: {
    available: boolean;
    home?: { team: string; last5: Record<string, number | null>; venue: Record<string, number | null> };
    away?: { team: string; last5: Record<string, number | null>; venue: Record<string, number | null> };
  };
  intelligence: MatchIntelligenceResult | null;
  movements: Array<{ type: string; market: string; selection: string; detail: string; detectedAt: string }>;
}
export interface V2MatchesPayload {
  generatedAt: string;
  summary: { matches: number; strongCandidates: number; candidates: number; withMultipleSources: number; iddaaMatches: number };
  matches: V2Match[];
}

function normalize(value: string): string {
  return value.replaceAll("ı", "i").replaceAll("İ", "I").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
function sourceLabel(provider: string): string {
  if (provider === "mackolik_iddaa") return "Mackolik / İddaa";
  if (provider === "betexplorer_scraper") return "BetExplorer";
  if (provider === "the_odds_api") return "The Odds API";
  if (provider === "api_football") return "API-Football";
  if (provider === "football_data") return "football-data";
  if (provider === "sportmonks") return "SportMonks";
  return provider.replaceAll("_", " ");
}
function selectionLabel(quote: RecentQuoteView): string | null {
  if (quote.marketKey === "match_winner_3way") {
    if (quote.selectionKey === "home") return "1";
    if (quote.selectionKey === "draw") return "X";
    if (quote.selectionKey === "away") return "2";
  }
  if (quote.marketKey === "double_chance") {
    if (quote.selectionKey === "home_or_draw") return "1X";
    if (quote.selectionKey === "home_or_away") return "12";
    if (quote.selectionKey === "draw_or_away") return "X2";
  }
  if (quote.marketKey === "total_goals" && quote.line === 2.5) {
    if (quote.selectionKey === "over") return "O2.5";
    if (quote.selectionKey === "under") return "U2.5";
  }
  if (quote.marketKey === "both_teams_to_score") {
    if (quote.selectionKey === "yes") return "BTTS Yes";
    if (quote.selectionKey === "no") return "BTTS No";
  }
  return null;
}
function median(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value > 1).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle]! : ((clean[middle - 1] ?? 0) + (clean[middle] ?? 0)) / 2;
}
function average(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value > 1);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }

function latestQuotes(status: MonitorStatus): RecentQuoteView[] {
  const combined = [...(status.recentQuotes ?? []), ...(status.turkishOdds ?? [])];
  const latest = new Map<string, RecentQuoteView>();
  for (const quote of combined) {
    const key = [quote.canonicalEventId ?? quote.sourceEventId, quote.provider, quote.bookmakerKey,
      quote.marketKey, quote.selectionKey, quote.line ?? "none"].join("|");
    const current = latest.get(key);
    if (!current || Date.parse(quote.updatedAt) > Date.parse(current.updatedAt)) latest.set(key, quote);
  }
  return [...latest.values()];
}
function eventIdentity(quote: RecentQuoteView): string {
  return quote.canonicalEventId ?? "v2:" + stableId(normalize(quote.event) + "|" + quote.commenceTime);
}
function intelligenceFor(status: MonitorStatus, id: string, event: string): MatchIntelligenceResult | null {
  const results = status.matchIntelligence?.results ?? [];
  return results.find((item) => item.canonicalEventId === id)
    ?? results.find((item) => normalize(item.home.team + " - " + item.away.team) === normalize(event))
    ?? null;
}
function featureNumber(feature: { value: number | null; availability: string } | undefined): number | null {
  if (!feature || feature.availability === "unavailable" || feature.value === null || !Number.isFinite(feature.value)) return null;
  return feature.value;
}
function formSummary(intelligence: MatchIntelligenceResult | null): V2Match["form"] {
  if (!intelligence) return { available: false };
  const side = (profile: MatchIntelligenceResult["home"] | MatchIntelligenceResult["away"]) => ({
    team: profile.team,
    last5: {
      matches: featureNumber(profile.form.last5.matches), wins: featureNumber(profile.form.last5.wins),
      draws: featureNumber(profile.form.last5.draws), losses: featureNumber(profile.form.last5.losses),
      ppg: featureNumber(profile.form.last5.pointsPerGame), gf: featureNumber(profile.form.last5.goalsScoredPerGame),
      ga: featureNumber(profile.form.last5.goalsConcededPerGame), btts: featureNumber(profile.form.last5.bttsRate),
      over25: featureNumber(profile.form.last5.over25Rate),
    },
    venue: {
      ppg: featureNumber(profile.venue.pointsPerGame), gf: featureNumber(profile.venue.goalsForPerGame),
      ga: featureNumber(profile.venue.goalsAgainstPerGame), btts: featureNumber(profile.venue.bttsRate),
      over25: featureNumber(profile.venue.over25Rate),
    },
  });
  return { available: true, home: side(intelligence.home), away: side(intelligence.away) };
}
function marketProbabilities(quotes: RecentQuoteView[]): { home: number; draw: number; away: number } | null {
  const prices: Record<"home" | "draw" | "away", number[]> = { home: [], draw: [], away: [] };
  for (const quote of quotes) {
    if (quote.marketKey !== "match_winner_3way") continue;
    if (quote.selectionKey === "home" || quote.selectionKey === "draw" || quote.selectionKey === "away") prices[quote.selectionKey].push(quote.price);
  }
  const home = median(prices.home), draw = median(prices.draw), away = median(prices.away);
  if (!home || !draw || !away) return null;
  const raw = { home: 1 / home, draw: 1 / draw, away: 1 / away };
  const total = raw.home + raw.draw + raw.away;
  return total > 0 ? { home: raw.home / total * 100, draw: raw.draw / total * 100, away: raw.away / total * 100 } : null;
}
function weighted(parts: Array<{ value: number | null; weight: number }>): number {
  const active = parts.filter((part): part is { value: number; weight: number } => part.value !== null && Number.isFinite(part.value));
  const total = active.reduce((sum, part) => sum + part.weight, 0);
  return total ? Math.round(active.reduce((sum, part) => sum + part.value * part.weight, 0) / total) : 0;
}
function intelligenceSupport(side: "home" | "draw" | "away", intel: MatchIntelligenceResult | null) {
  if (!intel || side === "draw") return { score: null as number | null, reasons: [] as string[], risks: ["Bağımsız takım/form desteği sınırlı"] };
  const reasons: string[] = [], risks: string[] = [];
  let score = 50;
  const target = side === "home" ? intel.home : intel.away;
  const opponent = side === "home" ? intel.away : intel.home;
  const edge = (side === "home" && intel.teamStrengthEnvironment === "home_edge")
    || (side === "away" && intel.teamStrengthEnvironment === "away_edge");
  if (edge) { score += 20; reasons.push("Takım güç profili favoriyi destekliyor"); }
  else if (intel.teamStrengthEnvironment === "balanced") risks.push("Takım güç profili dengeli");
  else { score -= 15; risks.push("Takım güç profili favoriyle aynı yönde değil"); }
  const ppg = featureNumber(target.form.last5.pointsPerGame), oppPpg = featureNumber(opponent.form.last5.pointsPerGame);
  if (ppg !== null && oppPpg !== null) {
    if (ppg - oppPpg >= 0.5) { score += 15; reasons.push("Son 5 maç formu favori taraf lehine"); }
    else if (ppg - oppPpg <= -0.35) { score -= 15; risks.push("Son 5 form favoriyi desteklemiyor"); }
  } else risks.push("Form örneklemi eksik");
  const venue = featureNumber(target.venue.pointsPerGame), oppVenue = featureNumber(opponent.venue.pointsPerGame);
  if (venue !== null && oppVenue !== null && venue - oppVenue >= 0.35) {
    score += 10; reasons.push("İç/dış saha performansı favori taraf lehine");
  } else if (venue === null || oppVenue === null) risks.push("İç/dış saha verisi eksik");
  score += (intel.confidence.score - 50) * 0.2;
  return { score: Math.round(clamp(score)), reasons, risks };
}
function buildAnalysis(quotes: RecentQuoteView[], intel: MatchIntelligenceResult | null) {
  const probabilities = marketProbabilities(quotes);
  const bookmakers = new Set(quotes.map((quote) => quote.bookmakerKey));
  const providers = new Set(quotes.map((quote) => quote.provider));
  const timestamps = quotes.map((quote) => Date.parse(quote.updatedAt)).filter(Number.isFinite);
  const newest = timestamps.length ? Math.max(...timestamps) : Number.NaN;
  const ageMinutes = Number.isFinite(newest) ? Math.max(0, (Date.now() - newest) / 60000) : 999;
  const sourceScore = clamp(Math.min(bookmakers.size, 4) / 4 * 100);
  const freshnessScore = clamp(100 - ageMinutes * 4);
  const dataConfidence = weighted([{ value: sourceScore, weight: 45 }, { value: freshnessScore, weight: 25 },
    { value: intel?.confidence.score ?? null, weight: 30 }]);

  if (!probabilities) {
    return {
      dataConfidence,
      favorite: { side: "none" as const, team: null, score: 0, marketProbability: null,
        reasons: [] as string[], risks: ["Tam 1-X-2 piyasa verisi yok"] },
      recommendation: { decision: "insufficient_data" as V2Decision, market: null, selection: null,
        bestPrice: null, bookmaker: null, score: 0, confidence: dataConfidence, sourceCount: bookmakers.size,
        priceAdvantagePercent: null, reasons: [] as string[], risks: ["1-X-2 piyasa olasılığı hesaplanamadı"] },
    };
  }

  const side = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0] as "home" | "draw" | "away";
  const probability = probabilities[side];
  const sideQuotes = quotes.filter((quote) => quote.marketKey === "match_winner_3way" && quote.selectionKey === side);
  const best = sideQuotes.reduce<RecentQuoteView | null>((current, quote) => !current || quote.price > current.price ? quote : current, null);
  const avg = average(sideQuotes.map((quote) => quote.price));
  const advantage = best && avg ? (best.price / avg - 1) * 100 : null;
  const dispersion = avg && sideQuotes.length > 1
    ? (Math.max(...sideQuotes.map((q) => q.price)) - Math.min(...sideQuotes.map((q) => q.price))) / avg * 100 : 0;
  const agreement = clamp(100 - dispersion * 7);
  const marketScore = clamp((probability - 33.3) / 36.7 * 100);
  const priceScore = advantage === null ? null : clamp(advantage / 6 * 100);
  const independent = intelligenceSupport(side, intel);
  const score = weighted([{ value: marketScore, weight: 35 }, { value: agreement, weight: 20 },
    { value: sourceScore, weight: 15 }, { value: priceScore, weight: 10 }, { value: independent.score, weight: 20 }]);

  const reasons = ["Piyasa olasılığı %" + probability.toFixed(1)];
  const risks: string[] = [];
  if (bookmakers.size >= 2) reasons.push(bookmakers.size + " bookmaker karşılaştırıldı"); else risks.push("Tek bookmaker verisi");
  if (dispersion <= 6 && sideQuotes.length >= 2) reasons.push("Kaynak fiyatları birbirine yakın");
  if (dispersion > 12) risks.push("Kaynaklar arasında yüksek fiyat uyuşmazlığı");
  reasons.push(...independent.reasons); risks.push(...independent.risks);
  if (advantage !== null && advantage >= 2) reasons.push("En iyi fiyat piyasa ortalamasından %" + advantage.toFixed(1) + " yüksek");
  if (providers.size >= 2) reasons.push(providers.size + " bağımsız veri akışı mevcut");

  const parts = quotes[0]?.event.split(" - ") ?? [];
  const team = side === "home" ? parts[0]?.trim() ?? "Ev Sahibi"
    : side === "away" ? parts.slice(1).join(" - ").trim() || "Deplasman" : "Beraberlik";
  const favoriteScore = weighted([{ value: marketScore, weight: 55 }, { value: agreement, weight: 20 },
    { value: independent.score, weight: 25 }]);

  let decision: V2Decision = score >= 80 ? "strong_candidate" : score >= 70 ? "candidate" : score >= 58 ? "watch" : "pass";
  if (!best) { decision = "insufficient_data"; risks.push("Favori seçim için kullanılabilir oran yok"); }
  if (bookmakers.size < 2 || dataConfidence < 50 || independent.score === null) {
    if (decision === "strong_candidate" || decision === "candidate") decision = "watch";
  }
  if (ageMinutes > 10) { if (decision === "strong_candidate") decision = "candidate"; risks.push("Oran verisi güncelliğini kaybediyor"); }

  return {
    dataConfidence,
    favorite: { side, team, score: favoriteScore, marketProbability: probability, reasons: [...reasons], risks: [...risks] },
    recommendation: { decision, market: best ? "Maç Sonucu" : null,
      selection: side === "home" ? "MS 1" : side === "away" ? "MS 2" : "MS X",
      bestPrice: best?.price ?? null, bookmaker: best?.bookmaker ?? null, score, confidence: dataConfidence,
      sourceCount: bookmakers.size, priceAdvantagePercent: advantage, reasons, risks },
  };
}
function buildOdds(quotes: RecentQuoteView[]) {
  const bestOdds: Record<string, V2OddsCell> = {};
  const byProvider = new Map<string, V2SourceOddsRow>();
  for (const quote of quotes) {
    const label = selectionLabel(quote);
    if (!label) continue;
    const source = sourceLabel(quote.provider);
    const current = bestOdds[label];
    if (!current || quote.price > current.price) bestOdds[label] = { label, price: quote.price, bookmaker: quote.bookmaker, provider: source };
    const row = byProvider.get(quote.provider) ?? { provider: quote.provider, source, prices: {} };
    if (!row.prices[label] || quote.price > row.prices[label]!) row.prices[label] = quote.price;
    byProvider.set(quote.provider, row);
  }
  const priority = ["mackolik_iddaa", "betexplorer_scraper", "the_odds_api"];
  return { bestOdds, oddsTable: [...byProvider.values()].sort((a, b) => {
    const ai = priority.indexOf(a.provider), bi = priority.indexOf(b.provider);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.source.localeCompare(b.source, "tr");
  }) };
}
function fixtureFor(status: MonitorStatus, id: string, event: string) {
  return (status.dailySheet?.fixtures ?? []).find((fixture) => fixture.canonicalEventId === id)
    ?? (status.dailySheet?.fixtures ?? []).find((fixture) =>
      normalize(fixture.homeTeam + " - " + fixture.awayTeam) === normalize(event));
}
function movementsFor(status: MonitorStatus, event: string): V2Match["movements"] {
  const target = normalize(event);
  return (status.dailySheet?.recentSignals ?? []).filter((signal) => normalize(signal.event) === target).slice(0, 10)
    .map((signal) => ({ type: signal.type, market: signal.market, selection: signal.selection,
      detail: signal.detail, detectedAt: signal.detectedAt }));
}

export function buildV2Matches(status: MonitorStatus): V2MatchesPayload {
  const groups = new Map<string, RecentQuoteView[]>();
  for (const quote of latestQuotes(status)) {
    const id = eventIdentity(quote), group = groups.get(id) ?? [];
    group.push(quote); groups.set(id, group);
  }
  const matches: V2Match[] = [];
  for (const [id, quotes] of groups) {
    const first = quotes[0]; if (!first) continue;
    const fixture = fixtureFor(status, id, first.event);
    const intel = intelligenceFor(status, id, first.event);
    const odds = buildOdds(quotes), analysis = buildAnalysis(quotes, intel);
    const eventParts = first.event.split(" - ");
    const homeTeam = fixture?.homeTeam ?? eventParts[0]?.trim() ?? "Ev Sahibi";
    const awayTeam = fixture?.awayTeam ?? (eventParts.slice(1).join(" - ").trim() || "Deplasman");
    matches.push({
      canonicalEventId: id, event: homeTeam + " - " + awayTeam, leagueName: fixture?.leagueName ?? first.leagueName,
      homeTeam, awayTeam, commenceTime: fixture?.commenceTime ?? first.commenceTime, phase: fixture?.phase ?? first.phase,
      sources: [...new Set(quotes.map((quote) => sourceLabel(quote.provider)))].sort((a, b) => a.localeCompare(b, "tr")),
      sourceCount: new Set(quotes.map((quote) => quote.bookmakerKey)).size, bestOdds: odds.bestOdds, oddsTable: odds.oddsTable,
      favorite: analysis.favorite, recommendation: analysis.recommendation, dataConfidence: analysis.dataConfidence,
      form: formSummary(intel), intelligence: intel, movements: movementsFor(status, first.event),
    });
  }
  const rank: Record<V2Decision, number> = { strong_candidate: 5, candidate: 4, watch: 3, pass: 2, insufficient_data: 1 };
  matches.sort((a, b) => rank[b.recommendation.decision] - rank[a.recommendation.decision]
    || b.recommendation.score - a.recommendation.score || Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      matches: matches.length,
      strongCandidates: matches.filter((match) => match.recommendation.decision === "strong_candidate").length,
      candidates: matches.filter((match) => match.recommendation.decision === "candidate").length,
      withMultipleSources: matches.filter((match) => match.sourceCount >= 2).length,
      iddaaMatches: matches.filter((match) => match.oddsTable.some((row) => row.provider === "mackolik_iddaa")).length,
    },
    matches,
  };
}
export function buildV2Recommendations(status: MonitorStatus) {
  const payload = buildV2Matches(status);
  const strong = payload.matches.filter((match) => match.recommendation.decision === "strong_candidate"
    && match.recommendation.score >= 80 && match.recommendation.confidence >= 70 && match.recommendation.sourceCount >= 2);
  const ids = new Set(strong.map((match) => match.canonicalEventId));
  return {
    generatedAt: payload.generatedAt,
    strong,
    excluded: payload.matches.filter((match) => !ids.has(match.canonicalEventId)).map((match) => ({
      canonicalEventId: match.canonicalEventId, event: match.event, decision: match.recommendation.decision,
      score: match.recommendation.score, confidence: match.recommendation.confidence,
      sourceCount: match.recommendation.sourceCount, reasons: match.recommendation.risks,
    })),
  };
}
