import type { DailySheetDataset } from "./daily-match-sheet.js";
import type { MatchFixture } from "./domain.js";
import type { GoogleSheetsMirror } from "./google-sheets-mirror.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const LIVE_STALE_MINUTES = 45;
const MAX_LIVE_DURATION_MINUTES = 240;

interface LayoutTable {
  title: string;
  rows: Array<Array<string | number | boolean>>;
  columnWidths: number[];
  hidden?: boolean;
}

interface SheetMetadata {
  sheets?: Array<{
    properties?: { sheetId?: number; title?: string };
    conditionalFormats?: unknown[];
  }>;
}

interface PatchableGoogleSheetsMirror {
  readonly url: string;
  sync(dataset: DailySheetDataset): Promise<void>;
  prepareSheets(token: string, tables: LayoutTable[], sheetIds: Map<string, number>): Promise<void>;
  request<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T>;
}

function spreadsheetIdFromUrl(url: string): string {
  const id = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) throw new Error("Google Sheet URL'sinden tablo kimligi okunamadi.");
  return id;
}

function visibleFixture(fixture: MatchFixture, now = new Date()): boolean {
  const commence = Date.parse(fixture.commenceTime);
  if (!Number.isFinite(commence)) return false;
  if (fixture.phase === "prematch") return commence > now.getTime();

  const elapsedMinutes = (now.getTime() - commence) / 60_000;
  if (elapsedMinutes > MAX_LIVE_DURATION_MINUTES) return false;

  const lastCheck = fixture.lastOddsCheckAt ? Date.parse(fixture.lastOddsCheckAt) : Number.NaN;
  if (Number.isFinite(lastCheck) && (now.getTime() - lastCheck) / 60_000 > LIVE_STALE_MINUTES) return false;
  return true;
}

function placeholderRows(dataset: DailySheetDataset): Array<{ range: string; values: unknown[][] }> {
  const activeFixtures = dataset.fixtures.filter((fixture) => visibleFixture(fixture));
  const noActiveMatches = activeFixtures.length === 0;
  const noAnalysis = noActiveMatches || dataset.oddsHistory.length === 0;
  const data: Array<{ range: string; values: unknown[][] }> = [];

  if (noActiveMatches) {
    data.push({
      range: "'Maclar'!A2:H2",
      values: [[
        dataset.date,
        "",
        "Bugün takip edilen 6 ligde aktif maç yok",
        "Premier League + Championship + La Liga + Bundesliga + Serie A + Ligue 1",
        "",
        "BEKLE",
        "",
        "Sistem yeni fikstür geldikçe otomatik günceller",
      ]],
    });
  }

  if (noAnalysis) {
    data.push(
      {
        range: "'Kupon_Adaylari'!A2:Q2",
        values: [["BEKLE", "", "Henüz yeterli oran verisi yok", "", "", "", "", "", "", "", "", "", "", "", "", "Maç/oran verisi geldikçe adaylar burada oluşacak", ""]],
      },
      {
        range: "'Pazar_Ozeti'!A2:L2",
        values: [["Henüz aktif oran karşılaştırması yok", "BEKLE", "", "", "", "", "", "", "", "", "", ""]],
      },
      {
        range: "'Gol_Alt_Ust'!A2:I2",
        values: [["Henüz gol pazarı oranı yok", "BEKLE", "", "", "", "", "", "", ""]],
      },
      {
        range: "'Kornerler'!A2:I2",
        values: [["Henüz korner pazarı oranı yok", "BEKLE", "", "", "", "", "", "", ""]],
      },
      {
        range: "'Kartlar'!A2:I2",
        values: [["Henüz kart pazarı oranı yok", "BEKLE", "", "", "", "", "", "", ""]],
      },
    );
  }

  return data;
}

/**
 * Google Sheet görünümünü idempotent ve okunabilir tutar.
 *
 * - BUGUN_NE_OYNANIR / Kupon_Adaylari conditional-format kuralları her sync'te
 *   üst üste binmesin diye uygulamanın yönettiği kuralları önce temizler.
 * - Başlık ve gövde satırlarına sabit yükseklik + wrap uygular.
 * - Veri yokken sekmeleri tamamen boş bırakmak yerine açıklayıcı durum satırı yazar.
 */
export function enableGoogleSheetLayoutFix(mirror: GoogleSheetsMirror): GoogleSheetsMirror {
  const target = mirror as unknown as PatchableGoogleSheetsMirror;
  const originalPrepare = target.prepareSheets.bind(mirror);
  const originalSync = target.sync.bind(mirror);
  const spreadsheetId = spreadsheetIdFromUrl(target.url);

  target.prepareSheets = async (token: string, tables: LayoutTable[], sheetIds: Map<string, number>): Promise<void> => {
    const managedConditionalTitles = new Set(["BUGUN_NE_OYNANIR", "Kupon_Adaylari"]);

    // Eski sürüm her sync'te 4 yeni rule ekliyordu. Sayıyı okuyup index=0'i
    // tekrarlı silmek, kuralları güvenli biçimde sıfırlar; originalPrepare sonra
    // güncel 4 kuralı yalnızca bir kez kurar.
    try {
      const metadata = await target.request<SheetMetadata>(
        `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title),conditionalFormats)`,
        token,
      );
      const deleteRequests: unknown[] = [];
      for (const sheet of metadata.sheets ?? []) {
        const title = sheet.properties?.title;
        const sheetId = sheet.properties?.sheetId;
        if (!title || typeof sheetId !== "number" || !managedConditionalTitles.has(title)) continue;
        const count = sheet.conditionalFormats?.length ?? 0;
        for (let index = 0; index < count; index += 1) {
          deleteRequests.push({ deleteConditionalFormatRule: { sheetId, index: 0 } });
        }
      }
      if (deleteRequests.length > 0) {
        await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, token, {
          method: "POST",
          body: JSON.stringify({ requests: deleteRequests }),
        });
      }
    } catch {
      // Biçim metadata'sı okunamazsa veri senkronunu durdurma; ana hazırlık yine çalışsın.
    }

    await originalPrepare(token, tables, sheetIds);

    const layoutRequests: unknown[] = [];
    for (const table of tables) {
      const sheetId = sheetIds.get(table.title);
      if (sheetId === undefined) continue;
      const columnCount = Math.max(table.columnWidths.length, 1);
      const bodyEndRow = Math.max(table.rows.length, 2);

      layoutRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 36 },
          fields: "pixelSize",
        },
      });
      layoutRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: bodyEndRow },
          properties: { pixelSize: 30 },
          fields: "pixelSize",
        },
      });
      layoutRequests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: bodyEndRow,
            startColumnIndex: 0,
            endColumnIndex: columnCount,
          },
          cell: {
            userEnteredFormat: {
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
            },
          },
          fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
        },
      });
    }

    if (layoutRequests.length > 0) {
      await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({ requests: layoutRequests }),
      });
    }
  };

  target.sync = async (dataset: DailySheetDataset): Promise<void> => {
    await originalSync(dataset);
    const data = placeholderRows(dataset);
    if (data.length === 0) return;

    // Base sync başarılı olduktan sonra durum satırlarını yazıyoruz. Böylece
    // Google API hatası gerçek veriyi silip boş tablo bırakmıyor.
    const tokenTarget = mirror as unknown as { accessToken(): Promise<string> };
    const token = await tokenTarget.accessToken();
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
  };

  return mirror;
}
