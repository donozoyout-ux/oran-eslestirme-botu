import type { GoogleResultsMirror } from "./google-results-mirror.js";
import { googleResultsMirrorInternals } from "./google-results-mirror.js";
import type { ResultsSnapshot } from "./results-tracker.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_TITLE = "Sonuclar";

type SheetValue = string | number | boolean;

interface ValueRange {
  values?: unknown[][];
}

interface PatchableGoogleResultsMirror {
  id: string;
  sync(snapshot: ResultsSnapshot): Promise<void>;
  accessToken(): Promise<string>;
  request<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T>;
}

const RESULT_LABELS = new Set(["DOĞRU", "YANLIŞ", "İADE", "VERİ YOK", "BEKLEMEDE"]);

function isDetailRow(row: unknown[]): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(row[0] ?? "")) && RESULT_LABELS.has(String(row[2] ?? ""));
}

function detailKey(row: unknown[]): string {
  return [row[0] ?? "", row[3] ?? "", row[4] ?? "", row[5] ?? "", row[6] ?? ""].join("|");
}

function extractDetailRows(rows: unknown[][]): SheetValue[][] {
  return rows
    .filter(isDetailRow)
    .map((row) => row.slice(0, 16).map((value) =>
      typeof value === "number" || typeof value === "boolean" ? value : String(value ?? ""),
    ));
}

function summaryFromDetails(details: SheetValue[][]): {
  total: number;
  settled: number;
  won: number;
  lost: number;
  voidCount: number;
  pending: number;
  unsupported: number;
  hitRate: number | null;
} {
  const status = (label: string): number => details.filter((row) => String(row[2]) === label).length;
  const won = status("DOĞRU");
  const lost = status("YANLIŞ");
  const voidCount = status("İADE");
  const pending = status("BEKLEMEDE");
  const unsupported = status("VERİ YOK");
  const graded = won + lost;
  return {
    total: details.length,
    settled: won + lost + voidCount,
    won,
    lost,
    voidCount,
    pending,
    unsupported,
    hitRate: graded > 0 ? (won / graded) * 100 : null,
  };
}

function buildRows(details: SheetValue[][]): SheetValue[][] {
  const sorted = [...details].sort((a, b) => {
    const dateCompare = String(b[0]).localeCompare(String(a[0]));
    if (dateCompare !== 0) return dateCompare;
    return Date.parse(String(b[13] ?? "")) - Date.parse(String(a[13] ?? ""));
  });
  const overall = summaryFromDetails(sorted);
  const rows: SheetValue[][] = [["GÜN SONU SONUÇLAR"]];
  rows.push([
    "GENEL",
    "Toplam", overall.total,
    "Sonuçlanan", overall.settled,
    "Doğru", overall.won,
    "Yanlış", overall.lost,
    "İsabet %", overall.hitRate === null ? "-" : Number(overall.hitRate.toFixed(1)),
  ]);
  rows.push([]);
  rows.push(["TARİH", "TOPLAM", "SONUÇLANAN", "DOĞRU", "YANLIŞ", "İADE", "BEKLEYEN", "VERİ YOK", "İSABET %"]);

  const byDate = new Map<string, SheetValue[][]>();
  for (const detail of sorted) {
    const date = String(detail[0]);
    const list = byDate.get(date) ?? [];
    list.push(detail);
    byDate.set(date, list);
  }
  for (const date of [...byDate.keys()].sort().reverse()) {
    const summary = summaryFromDetails(byDate.get(date) ?? []);
    rows.push([
      date,
      summary.total,
      summary.settled,
      summary.won,
      summary.lost,
      summary.voidCount,
      summary.pending,
      summary.unsupported,
      summary.hitRate === null ? "-" : Number(summary.hitRate.toFixed(1)),
    ]);
  }

  rows.push([]);
  rows.push([
    "Tarih", "Karar", "Sonuç", "Maç", "Pazar", "Seçim", "Çizgi", "Oran", "Bookmaker",
    "Güven", "Value %", "Kaynak", "Final Skor", "Tespit", "Sonuçlanma", "Sonuç Kaynağı",
  ]);
  rows.push(...sorted);
  if (sorted.length === 0) {
    rows.push(["", "", "BEKLEMEDE", "Henüz sonuç takip edilecek doğrulanmış aday oluşmadı."]);
  }
  return rows;
}

function mergeDetails(existing: SheetValue[][], current: SheetValue[][]): SheetValue[][] {
  const merged = new Map<string, SheetValue[]>();
  for (const row of existing) merged.set(detailKey(row), row);
  for (const row of current) merged.set(detailKey(row), row);
  return [...merged.values()];
}

/**
 * Railway'in yerel dosyası deploy/restart sırasında kaybolsa bile Google Sheet'teki
 * geçmiş sonuçları korur. Mevcut Sheet ayrıntı satırlarını önce okur, güncel tracker
 * satırlarıyla birleştirir ve özetleri birleşik arşivden yeniden hesaplar.
 */
export function enableGoogleResultsArchive(mirror: GoogleResultsMirror): GoogleResultsMirror {
  const target = mirror as unknown as PatchableGoogleResultsMirror;
  const originalSync = target.sync.bind(mirror);

  target.sync = async (snapshot: ResultsSnapshot): Promise<void> => {
    const token = await target.accessToken();
    let archived: SheetValue[][] = [];
    try {
      const range = encodeURIComponent(`'${SHEET_TITLE}'!A:Q`);
      const existing = await target.request<ValueRange>(
        `${SHEETS_API}/${encodeURIComponent(target.id)}/values/${range}`,
        token,
      );
      archived = extractDetailRows(existing.values ?? []);
    } catch {
      // Sekme ilk kez oluşuyorsa veya henüz veri yoksa normal sync devam eder.
    }

    await originalSync(snapshot);

    const currentRendered = googleResultsMirrorInternals.rowsFor(snapshot) as SheetValue[][];
    const current = extractDetailRows(currentRendered);
    const merged = mergeDetails(archived, current);
    const rows = buildRows(merged);

    await target.request(`${SHEETS_API}/${encodeURIComponent(target.id)}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: [{ range: `'${SHEET_TITLE}'!A1`, majorDimension: "ROWS", values: rows }],
      }),
    });
    await target.request(`${SHEETS_API}/${encodeURIComponent(target.id)}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: [`'${SHEET_TITLE}'!A${Math.max(rows.length + 1, 2)}:T`] }),
    });
  };

  return mirror;
}

export const googleResultsArchiveInternals = {
  extractDetailRows,
  summaryFromDetails,
  mergeDetails,
  buildRows,
};
