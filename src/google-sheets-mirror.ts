import { createSign } from "node:crypto";
import type { DailySheetDataset, DailySheetMirror } from "./daily-match-sheet.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

type SheetValue = string | number | boolean;

interface SheetTable {
  title: string;
  rows: SheetValue[][];
  columnWidths: number[];
}

interface GoogleSheetsMirrorOptions {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
  requestTimeoutMs?: number;
}

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SpreadsheetMetadata {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function spreadsheetId(value: string): string {
  const trimmed = value.trim();
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  const result = fromUrl ?? trimmed;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(result)) throw new Error("Google Sheet kimligi gecersiz.");
  return result;
}

/**
 * Render's environment editor accepts both literal `\\n` characters and real
 * line breaks. It is also common to paste either a JSON string or the whole
 * downloaded Google service-account JSON file by mistake. Normalize those
 * safe variants here so the OAuth signer always receives a PEM value.
 */
function normalizePrivateKey(value: string): string {
  let candidate = value.trim();

  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate) as { private_key?: unknown };
      if (typeof parsed.private_key === "string") candidate = parsed.private_key;
    } catch {
      // Leave it unchanged; the validation below provides a useful error.
    }
  } else if (candidate.startsWith('"') && candidate.endsWith('"')) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") candidate = parsed;
    } catch {
      candidate = candidate.slice(1, -1);
    }
  }

  const normalized = candidate
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .trim();

  if (!normalized.startsWith("-----BEGIN PRIVATE KEY-----") || !normalized.endsWith("-----END PRIVATE KEY-----")) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY gecersiz. Render'a yalnizca private_key degerini veya indirilen servis hesabi JSON'unun tamamini ekleyin.",
    );
  }
  return `${normalized}\n`;
}

function safeValue(value: unknown): SheetValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function tableRows(dataset: DailySheetDataset): SheetTable[] {
  const fixtures: SheetValue[][] = [[
    "Tarih",
    "Mac Kimligi",
    "Lig",
    "Ev Sahibi",
    "Deplasman",
    "Baslangic",
    "Durum",
    "Son Oran Kontrolu",
    "Sonraki Oran Kontrolu",
    "Kaynak URL",
  ]];
  for (const fixture of dataset.fixtures) {
    fixtures.push([
      dataset.date,
      fixture.sourceEventId,
      fixture.leagueName,
      fixture.homeTeam,
      fixture.awayTeam,
      fixture.commenceTime,
      fixture.phase,
      fixture.lastOddsCheckAt ?? "",
      fixture.nextOddsCheckAt ?? "",
      fixture.sourceUrl ?? "",
    ].map(safeValue));
  }

  const history: SheetValue[][] = [[
    "Kayit Saati",
    "Mac Kimligi",
    "Mac",
    "Durum",
    "Pazar",
    "Periyot",
    "Secim",
    "Cizgi",
    "Bookmaker",
    "Oran",
    "Kaynak Guncelleme Saati",
  ]];
  for (const entry of dataset.oddsHistory) {
    history.push([
      entry.capturedAt,
      entry.sourceEventId,
      entry.event,
      entry.phase,
      entry.market,
      entry.period,
      entry.selection,
      entry.line ?? "",
      entry.bookmaker,
      entry.price,
      entry.sourceUpdatedAt,
    ].map(safeValue));
  }

  const signals: SheetValue[][] = [[
    "Tespit Saati",
    "Tur",
    "Mac",
    "Pazar",
    "Secim",
    "Cizgi",
    "Aciklama",
    "Telegram Saati",
    "Sinyal Kimligi",
  ]];
  for (const signal of dataset.signals) {
    signals.push([
      signal.detectedAt,
      signal.type,
      signal.event,
      signal.market,
      signal.selection,
      signal.line ?? "",
      signal.detail,
      signal.notifiedAt ?? "",
      signal.id,
    ].map(safeValue));
  }

  return [
    { title: "Maclar", rows: fixtures, columnWidths: [105, 115, 175, 165, 165, 155, 105, 165, 165, 280] },
    { title: "Oran_Gecmisi", rows: history, columnWidths: [165, 115, 230, 100, 145, 110, 135, 80, 145, 85, 175] },
    { title: "Sinyaller", rows: signals, columnWidths: [165, 115, 230, 145, 135, 80, 350, 165, 245] },
  ];
}

export class GoogleSheetsMirror implements DailySheetMirror {
  readonly name = "google_sheets";
  readonly url: string;
  private readonly id: string;
  private readonly privateKey: string;
  private readonly requestTimeoutMs: number;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: GoogleSheetsMirrorOptions) {
    this.id = spreadsheetId(options.spreadsheetId);
    this.privateKey = normalizePrivateKey(options.privateKey);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.url = `https://docs.google.com/spreadsheets/d/${this.id}/edit`;
  }

  async sync(dataset: DailySheetDataset): Promise<void> {
    const token = await this.accessToken();
    const tables = tableRows(dataset);
    const sheetIds = await this.ensureSheets(token, tables.map((table) => table.title));
    await this.prepareSheets(token, tables, sheetIds);
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: tables.map((table) => `'${table.title}'!A:Z`) }),
    });
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}/values:batchUpdate`, token, {
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
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) return this.cachedToken.value;
    const issuedAt = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({
        iss: this.options.serviceAccountEmail,
        scope: SHEETS_SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3_600,
      }),
    );
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${base64Url(signer.sign(this.privateKey))}`;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text) as AccessTokenResponse;
    if (!parsed.access_token) throw new Error("Google OAuth erisim anahtari dondurmedi.");
    const expiresIn = Math.max(Number(parsed.expires_in ?? 3_600) - 60, 60);
    this.cachedToken = { value: parsed.access_token, expiresAt: now + expiresIn * 1000 };
    return parsed.access_token;
  }

  private async ensureSheets(token: string, titles: string[]): Promise<Map<string, number>> {
    const metadata = await this.request<SpreadsheetMetadata>(
      `${SHEETS_API}/${encodeURIComponent(this.id)}?fields=sheets.properties(sheetId,title)`,
      token,
    );
    const result = new Map<string, number>();
    for (const sheet of metadata.sheets ?? []) {
      const title = sheet.properties?.title;
      const id = sheet.properties?.sheetId;
      if (title && typeof id === "number") result.set(title, id);
    }
    const missing = titles.filter((title) => !result.has(title));
    if (missing.length > 0) {
      await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
      });
      const refreshed = await this.request<SpreadsheetMetadata>(
        `${SHEETS_API}/${encodeURIComponent(this.id)}?fields=sheets.properties(sheetId,title)`,
        token,
      );
      for (const sheet of refreshed.sheets ?? []) {
        const title = sheet.properties?.title;
        const id = sheet.properties?.sheetId;
        if (title && typeof id === "number") result.set(title, id);
      }
    }
    for (const title of titles) {
      if (!result.has(title)) throw new Error(`Google Sheet sekmesi olusturulamadi: ${title}`);
    }
    return result;
  }

  private async prepareSheets(token: string, tables: SheetTable[], sheetIds: Map<string, number>): Promise<void> {
    const requests: unknown[] = [];
    for (const table of tables) {
      const sheetId = sheetIds.get(table.title)!;
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: 1,
              rowCount: Math.max(table.rows.length + 50, 1_000),
              columnCount: Math.max(table.columnWidths.length, 26),
            },
          },
          fields: "gridProperties(frozenRowCount,rowCount,columnCount)",
        },
      });
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: table.columnWidths.length },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.04, green: 0.14, blue: 0.24 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
        },
      });
      requests.push({
        setBasicFilter: {
          filter: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: Math.max(table.rows.length, 1),
              startColumnIndex: 0,
              endColumnIndex: table.columnWidths.length,
            },
          },
        },
      });
      table.columnWidths.forEach((pixelSize, index) => {
        requests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
            properties: { pixelSize },
            fields: "pixelSize",
          },
        });
      });
    }
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }

  private async request<T = unknown>(url: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Google Sheets ${response.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}
