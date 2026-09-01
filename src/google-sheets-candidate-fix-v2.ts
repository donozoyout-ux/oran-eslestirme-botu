import type { DailySheetDataset, OddsHistoryEntry } from "./daily-match-sheet.js";
import type { MatchFixture } from "./domain.js";
import type { GoogleSheetsMirror } from "./google-sheets-mirror.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const LIVE_STALE_MINUTES = 45;
const MAX_LIVE_DURATION_MINUTES = 240;

type Cell = string | number | boolean;
type Verdict = "GÜÇLÜ ADAY" | "İZLE" | "BEKLE";

interface PatchableMirror {
  readonly url: string;
  sync(dataset: DailySheetDataset): Promise<void>;
  accessToken(): Promise<string>;
  request<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T>;
}

interface Candidate {
  matchKey: string;
  fixture: MatchFixture;
  marketKey: string;
  market: string;
  period: string;
  selection: string;
  line: number | null;
  bookmaker: string;
  price: number;
  fairOdds: number;
  valuePercent: number;
  sourceCount: number;
  dispersionPercent: number;
  score: number;
  verdict: Verdict;
  reason: string;
  capturedAt: string;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|cf|afc|sc|club|fk|sk)\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function fixtureKey(fixture: Pick<MatchFixture, "homeTeam" | "awayTeam">): string {
  return JSON.stringify([normalize(fixture.homeTeam), normalize(fixture.awayTeam)]);
}

function eventKey(event: string): string | null {
  const separator = event.indexOf(" - ");
  if (separator < 1) return null;
  const home = event.slice(0, separator).trim();
  const away = event.slice(separator + 3).trim();
  return home && away ? JSON.stringify([normalize(home), normalize(away)]) : null;
}

function active(fixture: MatchFixture, now: Date): boolean {
  const kickoff = Date.parse(fixture.commenceTime);
  if (!Number.isFinite(kickoff)) return false;
  if (fixture.phase === "prematch") return kickoff > now.getTime();
  if ((now.getTime() - kickoff) / 60_000 > MAX_LIVE_DURATION_MINUTES) return false;
  const last = Date.parse(fixture.lastOddsCheckAt ?? "");
  return !Number.isFinite(last) || (now.getTime() - last) / 60_000 <= LIVE_STALE_MINUTES;
}

function prefer(a: MatchFixture | undefined, b: MatchFixture): MatchFixture {
  if (!a) return b;
  if (a.phase !== b.phase) return b.phase === "live" ? b : a;
  return Date.parse(b.lastOddsCheckAt ?? "") > Date.parse(a.lastOddsCheckAt ?? "") ? b : a;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safe(value: unknown): Cell {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function reconcile(dataset: DailySheetDataset, now = new Date()): {
  fixtures: Map<string, MatchFixture>;
  history: Array<{ matchKey: string; entry: OddsHistoryEntry }>;
} {
  const fixtures = new Map<string, MatchFixture>();
  const bySource = new Map<string, string>();
  for (const fixture of dataset.fixtures) {
    if (!active(fixture, now)) continue;
    const key = fixtureKey(fixture);
    fixtures.set(key, prefer(fixtures.get(key), fixture));
    bySource.set(fixture.sourceEventId, key);
  }

  const latest = new Map<string, { matchKey: string; entry: OddsHistoryEntry }>();
  for (const entry of dataset.oddsHistory) {
    const matchKey = bySource.get(entry.sourceEventId) ?? eventKey(entry.event);
    if (!matchKey || !fixtures.has(matchKey)) continue;
    bySource.set(entry.sourceEventId, matchKey);
    const quoteKey = JSON.stringify([
      matchKey, entry.marketKey, entry.period, entry.selectionKey, entry.line ?? null,
      entry.provider, entry.bookmakerKey,
    ]);
    const old = latest.get(quoteKey);
    if (!old || Date.parse(entry.capturedAt) >= Date.parse(old.entry.capturedAt)) {
      latest.set(quoteKey, { matchKey, entry });
    }
  }
  return { fixtures, history: [...latest.values()] };
}

function buildCandidates(dataset: DailySheetDataset, now = new Date()): { fixtures: Map<string, MatchFixture>; rows: Candidate[] } {
  const data = reconcile(dataset, now);
  const groups = new Map<string, { matchKey: string; entries: OddsHistoryEntry[] }>();
  for (const item of data.history) {
    const key = JSON.stringify([item.matchKey, item.entry.marketKey, item.entry.period, item.entry.selectionKey, item.entry.line ?? null]);
    const group = groups.get(key) ?? { matchKey: item.matchKey, entries: [] };
    group.entries.push(item.entry);
    groups.set(key, group);
  }

  const candidates: Candidate[] = [];
  for (const group of groups.values()) {
    const first = group.entries[0];
    const fixture = data.fixtures.get(group.matchKey);
    if (!first || !fixture) continue;
    const prices = group.entries.map((entry) => entry.price).filter((price) => Number.isFinite(price) && price > 1);
    if (!prices.length) continue;
    const best = [...group.entries].sort((a, b) => b.price - a.price)[0]!;
    const fairOdds = median(prices);
    const valuePercent = fairOdds > 1 ? (best.price / fairOdds - 1) * 100 : 0;
    const dispersionPercent = fairOdds > 0 ? (Math.max(...prices) - Math.min(...prices)) / fairOdds * 100 : 100;
    const sourceCount = new Set(group.entries.map((entry) => `${entry.provider}:${entry.bookmakerKey}`)).size;
    const score = Math.round(
      clamp(sourceCount / 3) * 30 +
      clamp(1 - dispersionPercent / 12) * 30 +
      clamp(Math.max(valuePercent, 0) / 6) * 25 +
      15,
    );

    const liveWinner = fixture.phase === "live" && ["match_winner_3way", "match_winner_2way"].includes(first.marketKey);
    let verdict: Verdict = "BEKLE";
    if (!liveWinner && sourceCount >= 3 && score >= 75 && valuePercent >= 2.5 && dispersionPercent <= 12) verdict = "GÜÇLÜ ADAY";
    else if (!liveWinner && sourceCount >= 2 && score >= 58 && valuePercent >= 0.5 && dispersionPercent <= 12) verdict = "İZLE";

    const reason = liveWinner
      ? "Canlı 1X2 için skor/dakika bağlamı yok; düşük takım oranı öneri sayılmaz."
      : sourceCount < 2
        ? `Sadece ${sourceCount} bağımsız kaynak var; doğrulama bekleniyor.`
        : valuePercent < 0.5
          ? `Yeterli value yok (%${valuePercent.toFixed(1)}); BEKLE.`
          : dispersionPercent > 12
            ? `Kaynaklar fazla ayrışıyor (%${dispersionPercent.toFixed(1)}); BEKLE.`
            : `${sourceCount} kaynak doğruladı; value %${valuePercent.toFixed(1)}, güven ${score}/100.`;

    candidates.push({
      matchKey: group.matchKey,
      fixture,
      marketKey: first.marketKey,
      market: first.market,
      period: first.period,
      selection: first.selection,
      line: first.line,
      bookmaker: best.bookmaker,
      price: best.price,
      fairOdds,
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
  const bestByMatch = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const old = bestByMatch.get(candidate.matchKey);
    if (!old || rank(candidate.verdict) > rank(old.verdict) ||
      (rank(candidate.verdict) === rank(old.verdict) && candidate.score > old.score) ||
      (rank(candidate.verdict) === rank(old.verdict) && candidate.score === old.score && candidate.valuePercent > old.valuePercent)) {
      bestByMatch.set(candidate.matchKey, candidate);
    }
  }
  return {
    fixtures: data.fixtures,
    rows: [...bestByMatch.values()].sort((a, b) => rank(b.verdict) - rank(a.verdict) || b.score - a.score || b.valuePercent - a.valuePercent),
  };
}

function todayRows(dataset: DailySheetDataset, now = new Date()): Cell[][] {
  const data = buildCandidates(dataset, now);
  const byMatch = new Map(data.rows.map((candidate) => [candidate.matchKey, candidate]));
  const fixtures = [...data.fixtures.entries()].sort((a, b) => Date.parse(a[1].commenceTime) - Date.parse(b[1].commenceTime));
  const rows: Cell[][] = [["SIRA", "DURUM", "KARAR", "MAÇ", "NE OYNANIR?", "ORAN", "BOOKMAKER", "GÜVEN", "VALUE %", "KAYNAK", "KISA NEDEN"]];
  fixtures.forEach(([key, fixture], index) => {
    const candidate = byMatch.get(key);
    const choice = !candidate || candidate.verdict === "BEKLE"
      ? "BEKLE – veri doğrulanıyor"
      : candidate.line === null
        ? `${candidate.market} → ${candidate.selection}`
        : `${candidate.market} ${candidate.line} → ${candidate.selection}`;
    rows.push([
      index + 1, fixture.phase === "live" ? "CANLI" : "YAKLAŞAN", candidate?.verdict ?? "BEKLE",
      `${fixture.homeTeam} - ${fixture.awayTeam}`, choice,
      candidate ? Number(candidate.price.toFixed(3)) : "", candidate?.bookmaker ?? "",
      candidate ? `${candidate.score}/100` : "", candidate ? Number(candidate.valuePercent.toFixed(1)) : "",
      candidate?.sourceCount ?? "", candidate?.reason ?? "Henüz oran verisi yok; veri bekleniyor.",
    ].map(safe));
  });
  if (fixtures.length === 0) rows.push(["", "", "BEKLE", "Şu anda aktif maç yok", "Yeni fikstür/oran geldikçe otomatik güncellenecek", "", "", "", "", "", ""].map(safe));
  return rows;
}

function couponRows(dataset: DailySheetDataset, now = new Date()): Cell[][] {
  const data = buildCandidates(dataset, now);
  const byMatch = new Map(data.rows.map((candidate) => [candidate.matchKey, candidate]));
  const fixtures = [...data.fixtures.entries()].sort((a, b) => Date.parse(a[1].commenceTime) - Date.parse(b[1].commenceTime));
  const rows: Cell[][] = [[
    "Karar", "Puan", "Maç", "Durum", "Pazar", "Periyot", "Seçim", "Çizgi", "En İyi Oran", "Bookmaker",
    "Piyasa Adil Oran", "Adil Olasılık %", "Piyasa Value %", "Kaynak", "Dağılım %", "Neden", "Güncelleme",
  ]];
  for (const [key, fixture] of fixtures) {
    const candidate = byMatch.get(key);
    rows.push([
      candidate?.verdict ?? "BEKLE", candidate?.score ?? "", `${fixture.homeTeam} - ${fixture.awayTeam}`,
      fixture.phase === "live" ? "CANLI" : "YAKLAŞAN", candidate?.market ?? "", candidate?.period ?? "",
      candidate?.selection ?? "", candidate?.line ?? "", candidate ? Number(candidate.price.toFixed(3)) : "",
      candidate?.bookmaker ?? "", candidate ? Number(candidate.fairOdds.toFixed(3)) : "",
      candidate && candidate.fairOdds > 0 ? Number((100 / candidate.fairOdds).toFixed(1)) : "",
      candidate ? Number(candidate.valuePercent.toFixed(1)) : "", candidate?.sourceCount ?? "",
      candidate ? Number(candidate.dispersionPercent.toFixed(1)) : "",
      candidate?.reason ?? "Henüz yeterli oran verisi yok; kupona eklenmemeli.", candidate?.capturedAt ?? "",
    ].map(safe));
  }
  if (fixtures.length === 0) rows.push(["BEKLE", "", "Şu anda aktif maç yok", "", "", "", "", "", "", "", "", "", "", "", "", "Yeni maç geldikçe adaylar oluşacak", ""].map(safe));
  return rows;
}

export function enableGoogleSheetCandidateFixV2(mirror: GoogleSheetsMirror): GoogleSheetsMirror {
  const target = mirror as unknown as PatchableMirror;
  const original = target.sync.bind(mirror);
  const spreadsheetId = target.url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!spreadsheetId) throw new Error("Google Sheet kimliği okunamadı.");

  target.sync = async (dataset: DailySheetDataset): Promise<void> => {
    await original(dataset);
    const token = await target.accessToken();
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchClear`, token, {
      method: "POST", body: JSON.stringify({ ranges: ["'BUGUN_NE_OYNANIR'!A:Z", "'Kupon_Adaylari'!A:Z"] }),
    });
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: [
        { range: "'BUGUN_NE_OYNANIR'!A1", majorDimension: "ROWS", values: todayRows(dataset) },
        { range: "'Kupon_Adaylari'!A1", majorDimension: "ROWS", values: couponRows(dataset) },
      ] }),
    });
  };
  return mirror;
}

export const googleSheetCandidateFixV2Internals = { eventKey, reconcile, buildCandidates, todayRows, couponRows };
