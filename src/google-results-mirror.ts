import { createSign } from "node:crypto";
import type { ResultPick, ResultsMirror, ResultsSnapshot, ResultsSummary } from "./results-tracker.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_TITLE = "Sonuclar";

type SheetValue = string | number | boolean;

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SpreadsheetMetadata {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
}

export interface GoogleResultsMirrorOptions {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
  requestTimeoutMs?: number;
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

function normalizePrivateKey(value: string): string {
  let candidate = value.trim();
  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate) as { private_key?: unknown };
      if (typeof parsed.private_key === "string") candidate = parsed.private_key;
    } catch {
      // Validation below handles invalid values.
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
    throw new Error("GOOGLE_PRIVATE_KEY gecersiz.");
  }
  return `${normalized}\n`;
}

function resultLabel(status: ResultPick["status"]): string {
  if (status === "won") return "DOĞRU";
  if (status === "lost") return "YANLIŞ";
  if (status === "void") return "İADE";
  if (status === "unsupported") return "VERİ YOK";
  return "BEKLEMEDE";
}

function summaryFor(picks: ResultPick[]): ResultsSummary {
  const won = picks.filter((pick) => pick.status === "won").length;
  const lost = picks.filter((pick) => pick.status === "lost").length;
  const voidCount = picks.filter((pick) => pick.status === "void").length;
  const pending = picks.filter((pick) => pick.status === "pending").length;
  const unsupported = picks.filter((pick) => pick.status === "unsupported").length;
  const settled = won + lost + voidCount;
  const graded = won + lost;
  return {
    total: picks.length,
    settled,
    won,
    lost,
    void: voidCount,
    pending,
    unsupported,
    hitRatePercent: graded > 0 ? (won / graded) * 100 : null,
  };
}

function rowsFor(snapshot: ResultsSnapshot): SheetValue[][] {
  const rows: SheetValue[][] = [["GÜN SONU SONUÇLAR"]];
  rows.push([
    "GENEL",
    "Toplam", snapshot.summary.total,
    "Sonuçlanan", snapshot.summary.settled,
    "Doğru", snapshot.summary.won,
    "Yanlış", snapshot.summary.lost,
    "İsabet %", snapshot.summary.hitRatePercent === null ? "-" : Number(snapshot.summary.hitRatePercent.toFixed(1)),
  ]);
  rows.push([]);
  rows.push(["TARİH", "TOPLAM", "SONUÇLANAN", "DOĞRU", "YANLIŞ", "İADE", "BEKLEYEN", "VERİ YOK", "İSABET %"]);

  const byDate = new Map<string, ResultPick[]>();
  for (const pick of snapshot.picks) {
    const list = byDate.get(pick.date) ?? [];
    list.push(pick);
    byDate.set(pick.date, list);
  }
  for (const date of [...byDate.keys()].sort().reverse()) {
    const summary = summaryFor(byDate.get(date) ?? []);
    rows.push([
      date,
      summary.total,
      summary.settled,
      summary.won,
      summary.lost,
      summary.void,
      summary.pending,
      summary.unsupported,
      summary.hitRatePercent === null ? "-" : Number(summary.hitRatePercent.toFixed(1)),
    ]);
  }

  rows.push([]);
  rows.push([
    "Tarih", "Karar", "Sonuç", "Maç", "Pazar", "Seçim", "Çizgi", "Oran", "Bookmaker",
    "Güven", "Value %", "Kaynak", "Final Skor", "Tespit", "Sonuçlanma", "Sonuç Kaynağı",
  ]);
  for (const pick of snapshot.picks) {
    rows.push([
      pick.date,
      pick.decision,
      resultLabel(pick.status),
      `${pick.homeTeam} - ${pick.awayTeam}`,
      pick.market,
      pick.selection,
      pick.line ?? "",
      Number(pick.price.toFixed(3)),
      pick.bookmaker,
      `${pick.confidenceScore}/100`,
      Number(pick.valuePercent.toFixed(1)),
      pick.sourceCount,
      pick.finalScore ?? "",
      pick.detectedAt,
      pick.settledAt ?? "",
      pick.settlementSource ?? "",
    ]);
  }
  if (snapshot.picks.length === 0) {
    rows.push(["", "", "BEKLEMEDE", "Henüz sonuç takip edilecek güçlü aday oluşmadı."]);
  }
  return rows;
}

export class GoogleResultsMirror implements ResultsMirror {
  private readonly id: string;
  private readonly privateKey: string;
  private readonly requestTimeoutMs: number;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: GoogleResultsMirrorOptions) {
    this.id = spreadsheetId(options.spreadsheetId);
    this.privateKey = normalizePrivateKey(options.privateKey);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  async sync(snapshot: ResultsSnapshot): Promise<void> {
    const token = await this.accessToken();
    const sheetId = await this.ensureSheet(token);
    const rows = rowsFor(snapshot);
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                hidden: false,
                gridProperties: { frozenRowCount: 7, rowCount: Math.max(rows.length + 50, 500), columnCount: 20 },
              },
              fields: "hidden,gridProperties(frozenRowCount,rowCount,columnCount)",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 16 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.04, green: 0.14, blue: 0.24 },
                  textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat)",
            },
          },
        ],
      }),
    });
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: [{ range: `'${SHEET_TITLE}'!A1`, majorDimension: "ROWS", values: rows }],
      }),
    });
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: [`'${SHEET_TITLE}'!A${Math.max(rows.length + 1, 2)}:T`] }),
    });
  }

  private async ensureSheet(token: string): Promise<number> {
    const metadata = await this.request<SpreadsheetMetadata>(
      `${SHEETS_API}/${encodeURIComponent(this.id)}?fields=sheets.properties(sheetId,title)`, token,
    );
    const existing = metadata.sheets?.find((sheet) => sheet.properties?.title === SHEET_TITLE)?.properties?.sheetId;
    if (typeof existing === "number") return existing;
    await this.request(`${SHEETS_API}/${encodeURIComponent(this.id)}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }] }),
    });
    const refreshed = await this.request<SpreadsheetMetadata>(
      `${SHEETS_API}/${encodeURIComponent(this.id)}?fields=sheets.properties(sheetId,title)`, token,
    );
    const created = refreshed.sheets?.find((sheet) => sheet.properties?.title === SHEET_TITLE)?.properties?.sheetId;
    if (typeof created !== "number") throw new Error("Sonuclar Google Sheet sekmesi olusturulamadi.");
    return created;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) return this.cachedToken.value;
    const issuedAt = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({
      iss: this.options.serviceAccountEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    }));
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${base64Url(signer.sign(this.privateKey))}`;
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth2:grant-type:jwt-bearer", assertion });
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

export const googleResultsMirrorInternals = { rowsFor, resultLabel };
