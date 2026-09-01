import type { DailySheetDataset, OddsHistoryEntry } from "./daily-match-sheet.js";
import type { GoogleSheetsMirror } from "./google-sheets-mirror.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

type SheetValue = string | number | boolean;

interface RawSheetTable {
  title: string;
  rows: SheetValue[][];
  columnWidths: number[];
  hidden?: boolean;
}

interface PatchableGoogleSheetsMirror {
  readonly url: string;
  sync(dataset: DailySheetDataset): Promise<void>;
  accessToken(): Promise<string>;
  ensureSheets(token: string, titles: string[]): Promise<Map<string, number>>;
  prepareSheets(token: string, tables: RawSheetTable[], sheetIds: Map<string, number>): Promise<void>;
  request<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T>;
}

function safeValue(value: unknown): SheetValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function snapshotKey(entry: OddsHistoryEntry): string {
  return [
    entry.sourceEventId,
    entry.provider,
    entry.bookmakerKey,
    entry.marketKey,
    entry.period,
    entry.selectionKey,
    entry.line ?? "",
  ].join("|");
}

export function latestRawOdds(entries: OddsHistoryEntry[], limit = 1_000): OddsHistoryEntry[] {
  const latest = new Map<string, OddsHistoryEntry>();
  for (const entry of entries) {
    const key = snapshotKey(entry);
    const existing = latest.get(key);
    if (!existing || Date.parse(entry.capturedAt) >= Date.parse(existing.capturedAt)) latest.set(key, entry);
  }
  return [...latest.values()]
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
    .slice(0, limit);
}

export function rawOddsRows(entries: OddsHistoryEntry[]): SheetValue[][] {
  const rows: SheetValue[][] = [[
    "Kayıt Saati",
    "Maç",
    "Durum",
    "Pazar",
    "Periyot",
    "Seçim",
    "Çizgi",
    "Bookmaker",
    "Oran",
    "Sağlayıcı",
    "Kaynak Güncelleme",
  ]];

  const latest = latestRawOdds(entries);
  if (latest.length === 0) {
    rows.push([
      "",
      "Henüz gerçek oran verisi gelmedi",
      "BEKLE",
      "Maç/oran kaynağı geldikçe bu tablo otomatik yenilenir",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    return rows;
  }

  for (const entry of latest) {
    rows.push([
      entry.capturedAt,
      entry.event,
      entry.phase === "live" ? "CANLI" : "MAÇ ÖNÜ",
      entry.market,
      entry.period,
      entry.selection,
      entry.line ?? "",
      entry.bookmaker,
      Number(entry.price.toFixed(3)),
      entry.provider,
      entry.sourceUpdatedAt,
    ].map(safeValue));
  }

  return rows;
}

function spreadsheetIdFromUrl(url: string): string {
  const id = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) throw new Error("Google Sheet URL'sinden tablo kimligi okunamadi.");
  return id;
}

/**
 * Eski Sheet görünümü yalnızca aktif fixture ID'lerine bağlı satırları yazıyordu.
 * Telegram ise doğrudan gerçek quote akışından çalıştığı için iki görünüm ayrışabiliyordu.
 * Bu katman, günlük oddsHistory içindeki son gerçek fiyatları ayrıca görünür bir Oran_Tablosu
 * sekmesine ve Oran_Gecmisi sekmesine yazar. Böylece fixture filtresi hiçbir gerçek oranı
 * kullanıcıdan saklamaz; yazma hatası da mirror.sync'i fail ederek /status içindeki
 * dailySheet.googleSheets.lastError alanına düşer.
 *
 * Oran gelmeyen yeni bir günde de sekmeler mutlaka güncellenir. Böylece önceki günün
 * oranları yanlışlıkla ekranda kalmaz; kullanıcı açık bir "veri bekleniyor" satırı görür.
 */
export function enableRawOddsGoogleSheet(mirror: GoogleSheetsMirror): GoogleSheetsMirror {
  const target = mirror as unknown as PatchableGoogleSheetsMirror;
  const originalSync = target.sync.bind(mirror);

  target.sync = async (dataset: DailySheetDataset): Promise<void> => {
    await originalSync(dataset);

    const rows = rawOddsRows(dataset.oddsHistory);
    const token = await target.accessToken();
    const spreadsheetId = spreadsheetIdFromUrl(target.url);
    const tables: RawSheetTable[] = [
      {
        title: "Oran_Tablosu",
        rows,
        columnWidths: [165, 245, 95, 155, 110, 145, 80, 150, 85, 155, 175],
      },
      {
        title: "Oran_Gecmisi",
        rows,
        columnWidths: [165, 245, 95, 155, 110, 145, 80, 150, 85, 155, 175],
        hidden: false,
      },
    ];

    const sheetIds = await target.ensureSheets(token, tables.map((table) => table.title));
    await target.prepareSheets(token, tables, sheetIds);
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: tables.map((table) => ({
          range: `'${table.title}'!A1`,
          majorDimension: "ROWS",
          values: table.rows,
        })),
      }),
    });

    for (const table of tables) {
      const nextRow = Math.max(table.rows.length + 1, 2);
      const range = `'${table.title}'!A${nextRow}:Z10000`;
      await target.request(
        `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
        token,
        { method: "POST", body: "{}" },
      );
    }
  };

  return mirror;
}
