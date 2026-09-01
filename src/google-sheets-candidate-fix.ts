import type { DailySheetDataset, OddsHistoryEntry } from "./daily-match-sheet.js";
import type { MatchFixture } from "./domain.js";
import type { GoogleSheetsMirror } from "./google-sheets-mirror.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const LIVE_STALE_MINUTES = 45;
const MAX_LIVE_DURATION_MINUTES = 240;

type SheetValue = string | number | boolean;
type Verdict = "GÜÇLÜ ADAY" | "İZLE" | "BEKLE";

interface PatchableGoogleSheetsMirror {
  readonly url: string;
  sync(dataset: DailySheetDataset): Promise<void>;
  accessToken(): Promise<string>;
  request<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T>;
}

interface CandidateRow {
  matchKey: string;
  event: string;
  phase: "prematch" | "live";
  marketKey: string;
  market: string;
  period: string;
  selection: string;
  line: number | null;
  bookmaker: string;
  price: number;
  fairOdds: number;
  fairProbabilityPercent: number;
  valuePercent: number;
  sourceCount: number;
  dispersionPercent: number;
  score: number;
  verdict: Verdict;
  reason: string;
  capturedAt: string;
}

function spreadsheetIdFromUrl(url: string): string {
  const id = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) throw new Error("Google Sheet URL'sinden tablo kimligi okunamadi.");
  return id;
}

function safeValue(value: unknown): SheetValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\b(fc|cf|afc|sc|club|fk|sk)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function fixtureMatchKey(fixture: Pick<MatchFixture, "homeTeam" | "awayTeam">): string {
  return `${normalizeName(fixture.homeTeam)}|${normalizeName(fixture.awayTeam)}`;
}

function eventMatchKey(event: string): string | null {
  const separator = event.indexOf(" - ");
  if (separator < 1) return null;
  const home = event.slice(0, separator).trim();
  const away = event.slice(separator + 3).trim();
  if (!home || !away) return null;
  return `${normalizeName(home)}|${normalizeName(away)}`;
}

function visibleFixture(fixture: MatchFixture, now: Date): boolean {
  const commence = Date.parse(fixture.commenceTime);
  if (!Number.isFinite(commence)) return false;
  if (fixture.phase === "prematch") return commence > now.getTime();
  const elapsedMinutes = (now.getTime() - commence) / 60_000;
  if (elapsedMinutes > MAX_LIVE_DURATION_MINUTES) return false;
  const lastCheck = fixture.lastOddsCheckAt ? Date.parse(fixture.lastOddsCheckAt) : Number.NaN;
  return !Number.isFinite(lastCheck) || (now.getTime() - lastCheck) / 60_000 <= LIVE_STALE_MINUTES;
}

function preferredFixture(existing: MatchFixture | undefined, candidate: MatchFixture): MatchFixture {
  if (!existing) return candidate;
  if (existing.phase !== candidate.phase) return candidate.phase === "live" ? candidate : existing;
  const a = Date.parse(existing.lastOddsCheckAt ?? "");
  const b = Date.parse(candidate.lastOddsCheckAt ?? "");
  return b > a ? candidate : existing;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function reconcileActiveHistory(dataset: DailySheetDataset, now = new Date()): {
  fixtures: Map<string, MatchFixture>;
  history: OddsHistoryEntry[];
  matchKeyBySourceId: Map<string, string>;
} {
  const fixtures = new Map<string, MatchFixture>();
  const matchKeyBySourceId = new Map<string, string>();
  for (const fixture of dataset.fixtures) {
    if (!visibleFixture(fixture, now)) continue;
    const key = fixtureMatchKey(fixture);
    fixtures.set(key, preferredFixture(fixtures.get(key), fixture));
    matchKeyBySourceId.set(fixture.sourceEventId, key);
  }

  const activeKeys = new Set(fixtures.keys());
  const latest = new Map<string, OddsHistoryEntry>();
  for (const entry of dataset.oddsHistory) {
    let matchKey = matchKeyBySourceId.get(entry.sourceEventId);
    if (!matchKey) {
      const fromEvent = eventMatchKey(entry.event);
      if (fromEvent && activeKeys.has(fromEvent)) {
        matchKey = fromEvent;
        matchKeyBySourceId.set(entry.sourceEventId, fromEvent);
      }
    }
    if (!matchKey || !activeKeys.has(matchKey)) continue;
    const key = [
      matchKey,
      entry.marketKey,
      entry.period,
      entry.selectionKey,
      entry.line ?? "",
      entry.provider,
      entry.bookmakerKey,
    ].join("|");
    const old = latest.get(key);
    if (!old || Date.parse(entry.capturedAt) >= Date.parse(old.capturedAt)) latest.set(key, entry);
  }
  return { fixtures, history: [...latest.values()], matchKeyBySourceId };
}

function candidateRows(dataset: DailySheetDataset, now = new Date()): { fixtures: Map<string, MatchFixture>; rows: CandidateRow[] } {
  const reconciled = reconcileActiveHistory(dataset, now);
  const groups = new Map<string, OddsHistoryEntry[]>();
  for (const entry of reconciled.history) {
    const matchKey = reconciled.matchKeyBySourceId.get(entry.sourceEventId) ?? eventMatchKey(entry.event);
    if (!matchKey) continue;
    const key = [matchKey, entry.marketKey, entry.period, entry.selectionKey, entry.line ?? ""].join("|");
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const all: CandidateRow[] = [];
  for (const [groupKey, list] of groups) {
    const first = list[0];
    if (!first) continue;
    const matchKey = groupKey.split("|")[0]!;
    const fixture = reconciled.fixtures.get(matchKey);
    if (!fixture) continue;
    const prices = list.map((entry) => entry.price).filter((price) => Number.isFinite(price) && price > 1);
    if (prices.length === 0) continue;
    const best = [...list].sort((a, b) => b.price - a.price)[0]!;
    const fairOdds = median(prices);
    const valuePercent = fairOdds > 1 ? ((best.price / fairOdds) - 1) * 100 : 0;
    const dispersionPercent = fairOdds > 0 ? ((Math.max(...prices) - Math.min(...prices)) / fairOdds) * 100 : 100;
    const sourceCount = new Set(list.map((entry) => `${entry.provider}:${entry.bookmakerKey}`)).size;
    const coverageScore = clamp(sourceCount / 3, 0, 1) * 30;
    const agreementScore = clamp(1 - dispersionPercent / 12, 0, 1) * 30;
    const valueScore = clamp(Math.max(valuePercent, 0) / 6, 0, 1) * 25;
    const freshnessScore = 15;
    const score = Math.round(coverageScore + agreementScore + valueScore + freshnessScore);

    const liveWinnerBlocked = fixture.phase === "live" && ["match_winner_3way", "match_winner_2way"].includes(first.marketKey);
    let verdict: Verdict = "BEKLE";
    if (!liveWinnerBlocked && sourceCount >= 3 && score >= 75 && valuePercent >= 2.5 && dispersionPercent <= 12) {
      verdict = "GÜÇLÜ ADAY";
    } else if (!liveWinnerBlocked && sourceCount >= 2 && score >= 58 && valuePercent >= 0.5 && dispersionPercent <= 12) {
      verdict = "İZLE";
    }

    const reason = liveWinnerBlocked
      ? "Canlı 1X2 için skor/dakika bağlamı yok; takım oranı düşük diye öneri yapılmaz."
      : sourceCount < 2
        ? `Sadece ${sourceCount} bağımsız kaynak var; doğrulama bekleniyor.`
        : valuePercent < 0.5
          ? `En iyi oran piyasa merkezine göre yeterli value taşımıyor (%${valuePercent.toFixed(1)}).`
          : dispersionPercent > 12
            ? `Kaynaklar fazla ayrışıyor (%${dispersionPercent.toFixed(1)}); veri kararsız.`
            : `${sourceCount} kaynak doğruladı; value %${valuePercent.toFixed(1)}, güven ${score}/100.`;

    all.push({
      matchKey,
      event: `${fixture.homeTeam} - ${fixture.awayTeam}`,
      phase: fixture.phase,
      marketKey: first.marketKey,
      market: first.market,
      period: first.period,
      selection: first.selection,
      line: first.line,
      bookmaker: best.bookmaker,
      price: best.price,
      fairOdds,
      fairProbabilityPercent: fairOdds > 0 ? 100 / fairOdds : 0,
      valuePercent,
      sourceCount,
      dispersionPercent,
      score,
      verdict,
      reason,
      capturedAt: best.capturedAt,
    });
  }

  const rank = (verdict: Verdict): number => verdict === "GÜÇLÜ ADAY" ? 3 : verdict === "İZLE" ? 2 : 1;
  const bestByMatch = new Map<string, CandidateRow>();
  for (const row of all) {
    const existing = bestByMatch.get(row.matchKey);
    if (!existing || rank(row.verdict) > rank(existing.verdict) ||
      (rank(row.verdict) === rank(existing.verdict) && row.score > existing.score) ||
      (rank(row.verdict) === rank(existing.verdict) && row.score === existing.score && row.valuePercent > existing.valuePercent)) {
      bestByMatch.set(row.matchKey, row);
    }
  }

  const rows = [...bestByMatch.values()].sort((a, b) =>
    rank(b.verdict) - rank(a.verdict) || b.score - a.score || b.valuePercent - a.valuePercent,
  );
  return { fixtures: reconciled.fixtures, rows };
}

function todayRows(dataset: DailySheetDataset, now = new Date()): SheetValue[][] {
  const ranked = candidateRows(dataset, now);
  const byMatch = new Map(ranked.rows.map((row) => [row.matchKey, row]));
  const fixtures = [...ranked.fixtures.entries()].sort((a, b) => Date.parse(a[1].commenceTime) - Date.parse(b[1].commenceTime));
  const rows: SheetValue[][] = [[
    "SIRA", "DURUM", "KARAR", "MAÇ", "NE OYNANIR?", "ORAN", "BOOKMAKER", "GÜVEN", "VALUE %", "KAYNAK", "KISA NEDEN",
  ]];

  fixtures.forEach(([matchKey, fixture], index) => {
    const candidate = byMatch.get(matchKey);
    const choice = candidate
      ? candidate.verdict === "BEKLE"
        ? "BEKLE – veri doğrulanıyor"
        : candidate.line === null
          ? `${candidate.market} → ${candidate.selection}`
          : `${candidate.market} ${candidate.line} → ${candidate.selection}`
      : "BEKLE – henüz oran verisi yok";
    rows.push([
      index + 1,
      fixture.phase === "live" ? "CANLI" : "YAKLAŞAN",
      candidate?.verdict ?? "BEKLE",
      `${fixture.homeTeam} - ${fixture.awayTeam}`,
      choice,
      candidate ? Number(candidate.price.toFixed(3)) : "",
      candidate?.bookmaker ?? "",
      candidate ? `${candidate.score}/100` : "",
      candidate ? Number(candidate.valuePercent.toFixed(1)) : "",
      candidate?.sourceCount ?? "",
      candidate?.reason ?? "Oran verisi geldikçe çoklu kaynak doğrulaması yapılacak.",
    ].map(safeValue));
  });

  if (fixtures.length === 0) {
    rows.push(["", "", "BEKLE", "Şu anda aktif maç yok", "Yeni fikstür/oran geldikçe otomatik güncellenecek", "", "", "", "", "", ""].map(safeValue));
  }
  return rows;
}

function couponRows(dataset: DailySheetDataset, now = new Date()): SheetValue[][] {
  const ranked = candidateRows(dataset, now);
  const byMatch = new Map(ranked.rows.map((row) => [row.matchKey, row]));
  const fixtureEntries = [...ranked.fixtures.entries()].sort((a, b) => Date.parse(a[1].commenceTime) - Date.parse(b[1].commenceTime));
  const rows: SheetValue[][] = [[
    "Karar", "Puan", "Maç", "Durum", "Pazar", "Periyot", "Seçim", "Çizgi",
    "En İyi Oran", "Bookmaker", "Piyasa Adil Oran", "Adil Olasılık %", "Piyasa Value %",
    "Kaynak", "Dağılım %", "Neden", "Güncelleme",
  ]];

  const ordered = fixtureEntries
    .map(([matchKey, fixture]) => ({ fixture, candidate: byMatch.get(matchKey) }))
    .sort((a, b) => {
      const rank = (value?: Verdict): number => value === "GÜÇLÜ ADAY" ? 3 : value === "İZLE" ? 2 : 1;
      return rank(b.candidate?.verdict) - rank(a.candidate?.verdict) || (b.candidate?.score ?? 0) - (a.candidate?.score ?? 0);
    });

  for (const { fixture, candidate } of ordered) {
    rows.push([
      candidate?.verdict ?? "BEKLE",
      candidate?.score ?? "",
      `${fixture.homeTeam} - ${fixture.awayTeam}`,
      fixture.phase === "live" ? "CANLI" : "YAKLAŞAN",
      candidate?.market ?? "",
      candidate?.period ?? "",
      candidate?.selection ?? "",
      candidate?.line ?? "",
      candidate ? Number(candidate.price.toFixed(3)) : "",
      candidate?.bookmaker ?? "",
      candidate ? Number(candidate.fairOdds.toFixed(3)) : "",
      candidate ? Number(candidate.fairProbabilityPercent.toFixed(1)) : "",
      candidate ? Number(candidate.valuePercent.toFixed(1)) : "",
      candidate?.sourceCount ?? "",
      candidate ? Number(candidate.dispersionPercent.toFixed(1)) : "",
      candidate?.reason ?? "Henüz yeterli oran verisi yok; kupona eklenmemeli.",
      candidate?.capturedAt ?? "",
    ].map(safeValue));
  }

  if (ordered.length === 0) {
    rows.push(["BEKLE", "", "Şu anda aktif maç yok", "", "", "", "", "", "", "", "", "", "", "", "", "Yeni maç geldikçe adaylar burada oluşacak", ""].map(safeValue));
  }
  return rows;
}

/**
 * Base GoogleSheetsMirror'ın kaynak-ID tabanlı aday tablolarını, takım adıyla
 * sağlayıcılar arası uzlaştırılmış ve boş kalmayan bir görünümle değiştirir.
 */
export function enableGoogleSheetCandidateFix(mirror: GoogleSheetsMirror): GoogleSheetsMirror {
  const target = mirror as unknown as PatchableGoogleSheetsMirror;
  const originalSync = target.sync.bind(mirror);
  const spreadsheetId = spreadsheetIdFromUrl(target.url);

  target.sync = async (dataset: DailySheetDataset): Promise<void> => {
    await originalSync(dataset);
    const token = await target.accessToken();
    const today = todayRows(dataset);
    const coupons = couponRows(dataset);
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: ["'BUGUN_NE_OYNANIR'!A:Z", "'Kupon_Adaylari'!A:Z"] }),
    });
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: [
          { range: "'BUGUN_NE_OYNANIR'!A1", majorDimension: "ROWS", values: today },
          { range: "'Kupon_Adaylari'!A1", majorDimension: "ROWS", values: coupons },
        ],
      }),
    });
  };
  return mirror;
}

export const googleSheetCandidateFixInternals = {
  eventMatchKey,
  reconcileActiveHistory,
  candidateRows,
  todayRows,
  couponRows,
};
