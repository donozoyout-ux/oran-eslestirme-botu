import type { GoogleSheetsMirror } from "./google-sheets-mirror.js";

type SheetValue = string | number | boolean;

interface ThemeTable {
  title: string;
  rows: SheetValue[][];
  columnWidths: number[];
  hidden?: boolean;
}

interface PatchableGoogleSheetsMirror {
  readonly url: string;
  prepareSheets(token: string, tables: ThemeTable[], sheetIds: Map<string, number>): Promise<void>;
  request<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T>;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface ThemeColors {
  header: RgbColor;
  tab: RgbColor;
}

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

const DEFAULT_THEME: ThemeColors = {
  header: { red: 0.06, green: 0.12, blue: 0.20 },
  tab: { red: 0.20, green: 0.42, blue: 0.70 },
};

const THEMES: Record<string, ThemeColors> = {
  BUGUN_NE_OYNANIR: {
    header: { red: 0.04, green: 0.31, blue: 0.19 },
    tab: { red: 0.12, green: 0.62, blue: 0.35 },
  },
  Kupon_Adaylari: {
    header: { red: 0.05, green: 0.23, blue: 0.34 },
    tab: { red: 0.12, green: 0.56, blue: 0.66 },
  },
  Pazar_Ozeti: {
    header: { red: 0.08, green: 0.19, blue: 0.36 },
    tab: { red: 0.18, green: 0.42, blue: 0.78 },
  },
  Gol_Alt_Ust: {
    header: { red: 0.05, green: 0.27, blue: 0.32 },
    tab: { red: 0.15, green: 0.63, blue: 0.69 },
  },
  Kornerler: {
    header: { red: 0.12, green: 0.25, blue: 0.25 },
    tab: { red: 0.22, green: 0.58, blue: 0.52 },
  },
  Kartlar: {
    header: { red: 0.35, green: 0.20, blue: 0.05 },
    tab: { red: 0.92, green: 0.55, blue: 0.12 },
  },
  Maclar: {
    header: { red: 0.07, green: 0.20, blue: 0.38 },
    tab: { red: 0.20, green: 0.48, blue: 0.85 },
  },
  Oran_Tablosu: {
    header: { red: 0.22, green: 0.10, blue: 0.34 },
    tab: { red: 0.52, green: 0.31, blue: 0.72 },
  },
  Oran_Gecmisi: {
    header: { red: 0.22, green: 0.10, blue: 0.34 },
    tab: { red: 0.52, green: 0.31, blue: 0.72 },
  },
  Sinyaller: {
    header: { red: 0.35, green: 0.08, blue: 0.10 },
    tab: { red: 0.82, green: 0.22, blue: 0.26 },
  },
};

const CENTER_HEADERS = new Set([
  "SIRA",
  "DURUM",
  "Durum",
  "KARAR",
  "Karar",
  "Puan",
  "ORAN",
  "Oran",
  "GÜVEN",
  "Çizgi",
  "Kaynak",
  "Kaynak Sayısı",
  "Adil Olasılık %",
  "Piyasa Value %",
  "Dağılım %",
  "En İyi Oran",
  "Ortalama Oran",
  "Min Oran",
  "Max Oran",
]);

const LABEL_STYLES: Record<string, { background: RgbColor; foreground: RgbColor }> = {
  CANLI: {
    background: { red: 0.98, green: 0.88, blue: 0.88 },
    foreground: { red: 0.65, green: 0.08, blue: 0.10 },
  },
  "YAKLAŞAN": {
    background: { red: 0.88, green: 0.94, blue: 1.00 },
    foreground: { red: 0.08, green: 0.30, blue: 0.62 },
  },
  "MAÇ ÖNÜ": {
    background: { red: 0.88, green: 0.94, blue: 1.00 },
    foreground: { red: 0.08, green: 0.30, blue: 0.62 },
  },
  "GÜÇLÜ ADAY": {
    background: { red: 0.84, green: 0.95, blue: 0.87 },
    foreground: { red: 0.05, green: 0.42, blue: 0.18 },
  },
  "İZLE": {
    background: { red: 1.00, green: 0.95, blue: 0.78 },
    foreground: { red: 0.60, green: 0.38, blue: 0.02 },
  },
  "UZAK DUR": {
    background: { red: 0.98, green: 0.87, blue: 0.87 },
    foreground: { red: 0.66, green: 0.08, blue: 0.10 },
  },
  BEKLE: {
    background: { red: 0.92, green: 0.94, blue: 0.96 },
    foreground: { red: 0.30, green: 0.35, blue: 0.42 },
  },
};

function spreadsheetIdFromUrl(url: string): string {
  const id = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) throw new Error("Google Sheet URL'sinden tablo kimligi okunamadi.");
  return id;
}

function singleCellStyleRequest(sheetId: number, rowIndex: number, columnIndex: number, value: string): unknown | null {
  const style = LABEL_STYLES[value.trim().toLocaleUpperCase("tr-TR")];
  if (!style) return null;
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: style.background,
          textFormat: { foregroundColor: style.foreground, bold: true },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  };
}

/**
 * Sadece Google Sheet görünüşünü değiştirir; veri, filtre ve alarm mantığına dokunmaz.
 * Amaç okunaklı bir kontrol paneli görünümü: koyu başlıklar, temiz gövde, renkli
 * sekmeler ve durum/karar hücrelerinde tutarlı renk kodları.
 */
export function enableGoogleSheetVisualTheme(mirror: GoogleSheetsMirror): GoogleSheetsMirror {
  const target = mirror as unknown as PatchableGoogleSheetsMirror;
  const originalPrepare = target.prepareSheets.bind(mirror);
  const spreadsheetId = spreadsheetIdFromUrl(target.url);

  target.prepareSheets = async (token: string, tables: ThemeTable[], sheetIds: Map<string, number>): Promise<void> => {
    await originalPrepare(token, tables, sheetIds);

    const requests: unknown[] = [];
    for (const table of tables) {
      const sheetId = sheetIds.get(table.title);
      if (sheetId === undefined) continue;
      const theme = THEMES[table.title] ?? DEFAULT_THEME;
      const columnCount = Math.max(table.columnWidths.length, table.rows[0]?.length ?? 1, 1);
      const bodyEndRow = Math.max(table.rows.length, 2);
      const isDashboard = table.title === "BUGUN_NE_OYNANIR";

      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            tabColorStyle: { rgbColor: theme.tab },
            gridProperties: { hideGridlines: true },
          },
          fields: "tabColorStyle,gridProperties.hideGridlines",
        },
      });

      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
          cell: {
            userEnteredFormat: {
              backgroundColor: theme.header,
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true,
                fontSize: isDashboard ? 12 : 11,
              },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
              borders: {
                bottom: { style: "SOLID_THICK", color: theme.tab },
              },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders)",
        },
      });

      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: bodyEndRow, startColumnIndex: 0, endColumnIndex: columnCount },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.99, green: 0.995, blue: 1.00 },
              textFormat: {
                foregroundColor: { red: 0.12, green: 0.16, blue: 0.22 },
                fontSize: isDashboard ? 11 : 10,
              },
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
              borders: {
                bottom: { style: "SOLID", color: { red: 0.88, green: 0.90, blue: 0.93 } },
              },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy,borders)",
        },
      });

      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: isDashboard ? 46 : 40 },
          fields: "pixelSize",
        },
      });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: bodyEndRow },
          properties: { pixelSize: isDashboard ? 38 : 32 },
          fields: "pixelSize",
        },
      });

      const headers = table.rows[0] ?? [];
      headers.forEach((header, index) => {
        if (!CENTER_HEADERS.has(String(header))) return;
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: bodyEndRow,
              startColumnIndex: index,
              endColumnIndex: index + 1,
            },
            cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        });
      });

      table.rows.slice(1).forEach((row, rowOffset) => {
        row.forEach((cell, columnIndex) => {
          if (typeof cell !== "string") return;
          const request = singleCellStyleRequest(sheetId, rowOffset + 1, columnIndex, cell);
          if (request) requests.push(request);
        });
      });
    }

    if (requests.length === 0) return;
    await target.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  };

  return mirror;
}
