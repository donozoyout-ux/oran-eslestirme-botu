import { createSign } from "node:crypto";
import type { MatchFixture } from "./domain.js";
import type { DailySheetDataset, DailySheetMirror, OddsHistoryEntry } from "./daily-match-sheet.js";

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

interface RankedSelection {
  sourceEventId: string;
  event: string;
  phase: string;
  market: string;
  period: string;
  selection: string;
  line: number | null;
  bookmaker: string;
  bestPrice: number;
  fairOdds: number;
  fairProbability: number;
  valuePercent: number;
  sourceCount: number;
  dispersionPercent: number;
  score: number;
  verdict: "GÜÇLÜ ADAY" | "İZLE" | "UZAK DUR";
  reason: string;
  capturedAt: string;
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
      // Validation below explains invalid values.
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

function isActiveFixture(fixture: MatchFixture, now = new Date()): boolean {
  if (fixture.phase === "live") return true;
  const commence = Date.parse(fixture.commenceTime);
  return Number.isFinite(commence) && commence > now.getTime();
}

function activeFixtures(fixtures: MatchFixture[], now = new Date()): MatchFixture[] {
  const unique = new Map<string, MatchFixture>();
  for (const fixture of fixtures) {
    if (!isActiveFixture(fixture, now)) continue;
    const existing = unique.get(fixture.sourceEventId);
    if (!existing || fixture.phase === "live") unique.set(fixture.sourceEventId, fixture);
  }
  return [...unique.values()].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === "live" ? -1 : 1;
    return Date.parse(a.commenceTime) - Date.parse(b.commenceTime);
  });
}

function activeHistory(entries: OddsHistoryEntry[], fixtures: MatchFixture[]): OddsHistoryEntry[] {
  const activeIds = new Set(fixtures.map((fixture) => fixture.sourceEventId));
  return entries.filter((entry) => activeIds.has(entry.sourceEventId));
}

function latestHistory(entries: OddsHistoryEntry[]): OddsHistoryEntry[] {
  const latest = new Map<string, OddsHistoryEntry>();
  for (const entry of entries) {
    const key = [
      entry.sourceEventId,
      entry.marketKey,
      entry.period,
      entry.selectionKey,
      entry.line ?? "",
      entry.bookmakerKey,
    ].join("|");
    const existing = latest.get(key);
    if (!existing || Date.parse(entry.capturedAt) >= Date.parse(existing.capturedAt)) latest.set(key, entry);
  }
  return [...latest.values()].sort((a, b) => a.event.localeCompare(b.event) || a.market.localeCompare(b.market));
}

function groupedSelections(entries: OddsHistoryEntry[]): OddsHistoryEntry[][] {
  const groups = new Map<string, OddsHistoryEntry[]>();
  for (const entry of latestHistory(entries)) {
    const key = [entry.sourceEventId, entry.marketKey, entry.period, entry.selectionKey, entry.line ?? ""].join("|");
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.values()];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function rankedSelections(entries: OddsHistoryEntry[]): RankedSelection[] {
  return groupedSelections(entries)
    .map((list): RankedSelection | null => {
      const first = list[0]!;
      const prices = list.map((item) => item.price).filter((price) => Number.isFinite(price) && price > 1);
      if (prices.length === 0) return null;
      const best = [...list].sort((a, b) => b.price - a.price)[0]!;
      const fairOdds = median(prices);
      const valuePercent = ((best.price / fairOdds) - 1) * 100;
      const dispersionPercent = fairOdds > 0 ? ((Math.max(...prices) - Math.min(...prices)) / fairOdds) * 100 : 100;
      const coverageScore = Math.min(list.length / 5, 1) * 35;
      const agreementScore = Math.max(0, 1 - dispersionPercent / 12) * 35;
      const valueScore = Math.min(Math.max(valuePercent, 0) / 8, 1) * 30;
      const score = Math.round(coverageScore + agreementScore + valueScore);
      const verdict: RankedSelection["verdict"] = score >= 75 && valuePercent >= 2 && list.length >= 3
        ? "GÜÇLÜ ADAY"
        : score >= 58 && valuePercent > 0
          ? "İZLE"
          : "UZAK DUR";
      const reason = list.length < 3
        ? `Sadece ${list.length} kaynak var; karar için veri zayıf.`
        : valuePercent >= 2
          ? `${list.length} kaynakta en iyi oran piyasa ortasına göre %${valuePercent.toFixed(1)} avantajlı.`
          : "Kaynaklar karşılaştırıldı; belirgin fiyat avantajı oluşmadı.";
      return {
        sourceEventId: first.sourceEventId,
        event: first.event,
        phase: first.phase,
        market: first.market,
        period: first.period,
        selection: first.selection,
        line: first.line,
        bookmaker: best.bookmaker,
        bestPrice: best.price,
        fairOdds,
        fairProbability: 100 / fairOdds,
        valuePercent,
        sourceCount: list.length,
        dispersionPercent,
        score,
        verdict,
        reason,
        capturedAt: best.capturedAt,
      };
    })
    .filter((item): item is RankedSelection => item !== null)
    .sort((a, b) => b.score - a.score || b.valuePercent - a.valuePercent);
}

function oneBestSelectionPerMatch(entries: OddsHistoryEntry[], fixtures: MatchFixture[]): RankedSelection[] {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.sourceEventId, fixture]));
  const bestByMatch = new Map<string, RankedSelection>();
  for (const item of rankedSelections(entries)) {
    if (item.verdict === "UZAK DUR") continue;
    if (!fixtureById.has(item.sourceEventId)) continue;
    const existing = bestByMatch.get(item.sourceEventId);
    if (!existing || item.score > existing.score || (item.score === existing.score && item.valuePercent > existing.valuePercent)) {
      bestByMatch.set(item.sourceEventId, item);
    }
  }
  return [...bestByMatch.values()].sort((a, b) => {
    const fixtureA = fixtureById.get(a.sourceEventId)!;
    const fixtureB = fixtureById.get(b.sourceEventId)!;
    if (fixtureA.phase !== fixtureB.phase) return fixtureA.phase === "live" ? -1 : 1;
    const timeDifference = Date.parse(fixtureA.commenceTime) - Date.parse(fixtureB.commenceTime);
    if (timeDifference !== 0) return timeDifference;
    return b.score - a.score;
  });
}

function simpleDecisionRows(entries: OddsHistoryEntry[], fixtures: MatchFixture[]): SheetValue[][] {
  const useful = oneBestSelectionPerMatch(entries, fixtures).slice(0, 20);
  const rows: SheetValue[][] = [[
    "SIRA",
    "DURUM",
    "KARAR",
    "MAÇ",
    "NE OYNANIR?",
    "ORAN",
    "BOOKMAKER",
    "GÜVEN",
    "KISA NEDEN",
  ]];

  useful.forEach((item, index) => {
    const fixture = fixtures.find((candidate) => candidate.sourceEventId === item.sourceEventId);
    const choice = item.line === null
      ? `${item.market} → ${item.selection}`
      : `${item.market} ${item.line} → ${item.selection}`;
    rows.push([
      index + 1,
      fixture?.phase === "live" ? "CANLI" : "YAKLAŞAN",
      item.verdict,
      item.event,
      choice,
      Number(item.bestPrice.toFixed(2)),
      item.bookmaker,
      `${item.score}/100`,
      item.reason,
    ].map(safeValue));
  });

  if (useful.length === 0) {
    rows.push([
      "",
      "",
      "BEKLE",
      "Şu anda aktif ve yeterince güçlü aday yok",
      "Yeni maç/veri geldikçe burada tek satır halinde görünecek",
      "",
      "",
      "",
      "Biten maçlar otomatik olarak bu görünümden kaldırılır.",
    ].map(safeValue));
  }
  return rows;
}

function marketRows(entries: OddsHistoryEntry[], marketKeys: string[]): SheetValue[][] {
  const rows: SheetValue[][] = [[
    "Maç", "Durum", "Pazar", "Periyot", "Seçim", "Çizgi", "Bookmaker", "Oran", "Kayıt Saati",
  ]];
  for (const entry of latestHistory(entries).filter((item) => marketKeys.includes(item.marketKey))) {
    rows.push([
      entry.event, entry.phase === "live" ? "CANLI" : "YAKLAŞAN", entry.market, entry.period, entry.selection, entry.line ?? "",
      entry.bookmaker, entry.price, entry.capturedAt,
    ].map(safeValue));
  }
  return rows;
}

function marketSummaryRows(entries: OddsHistoryEntry[]): SheetValue[][] {
  const rows: SheetValue[][] = [[
    "Maç", "Durum", "Pazar", "Periyot", "Seçim", "Çizgi", "En İyi Oran", "En İyi Bookmaker",
    "Ortalama Oran", "Kaynak Sayısı", "Min Oran", "Max Oran",
  ]];
  for (const list of groupedSelections(entries)) {
    const first = list[0]!;
    const prices = list.map((item) => item.price).filter(Number.isFinite);
    if (prices.length === 0) continue;
    const best = [...list].sort((a, b) => b.price - a.price)[0]!;
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    rows.push([
      first.event, first.phase === "live" ? "CANLI" : "YAKLAŞAN", first.market, first.period, first.selection, first.line ?? "",
      Number(best.price.toFixed(3)), best.bookmaker, Number(avg.toFixed(3)), list.length,
      Number(Math.min(...prices).toFixed(3)), Number(Math.max(...prices).toFixed(3)),
    ].map(safeValue));
  }
  return rows;
}

function couponCandidateRows(entries: OddsHistoryEntry[], fixtures: MatchFixture[]): SheetValue[][] {
  const rows: SheetValue[][] = [[
    "Karar", "Puan", "Maç", "Durum", "Pazar", "Periyot", "Seçim", "Çizgi",
    "En İyi Oran", "Bookmaker", "Piyasa Adil Oran", "Adil Olasılık %", "Piyasa Value %",
    "Kaynak", "Dağılım %", "Neden", "Güncelleme",
  ]];
  for (const item of oneBestSelectionPerMatch(entries, fixtures).slice(0, 30)) {
    rows.push([
      item.verdict,
      item.score,
      item.event,
      item.phase === "live" ? "CANLI" : "YAKLAŞAN",
      item.market,
      item.period,
      item.selection,
      item.line ?? "",
      Number(item.bestPrice.toFixed(3)),
      item.bookmaker,
      Number(item.fairOdds.toFixed(3)),
      Number(item.fairProbability.toFixed(1)),
      Number(item.valuePercent.toFixed(1)),
      item.sourceCount,
      Number(item.dispersionPercent.toFixed(1)),
      item.reason,
      item.capturedAt,
    ].map(safeValue));
  }
  return rows;
}

function tableRows(dataset: DailySheetDataset): SheetTable[] {
  const fixturesForSheet = activeFixtures(dataset.fixtures);
  const historyForSheet = activeHistory(dataset.oddsHistory, fixturesForSheet);
  const activeEventNames = new Set(fixturesForSheet.map((fixture) => `${fixture.homeTeam} - ${fixture.awayTeam}`));

  const fixtures: SheetValue[][] = [[
    "Tarih", "Maç Kimliği", "Lig", "Ev Sahibi", "Deplasman", "Başlangıç", "Durum",
    "Son Oran Kontrolü", "Sonraki Oran Kontrolü", "Kaynak URL",
  ]];
  for (const fixture of fixturesForSheet) {
    fixtures.push([
      dataset.date, fixture.sourceEventId, fixture.leagueName, fixture.homeTeam, fixture.awayTeam,
      fixture.commenceTime, fixture.phase === "live" ? "CANLI" : "YAKLAŞAN", fixture.lastOddsCheckAt ?? "", fixture.nextOddsCheckAt ?? "", fixture.sourceUrl ?? "",
    ].map(safeValue));
  }

  const history: SheetValue[][] = [[
    "Kayıt Saati", "Maç Kimliği", "Maç", "Durum", "Pazar", "Periyot", "Seçim", "Çizgi",
    "Bookmaker", "Oran", "Kaynak Güncelleme Saati",
  ]];
  for (const entry of historyForSheet) {
    history.push([
      entry.capturedAt, entry.sourceEventId, entry.event, entry.phase === "live" ? "CANLI" : "YAKLAŞAN", entry.market, entry.period,
      entry.selection, entry.line ?? "", entry.bookmaker, entry.price, entry.sourceUpdatedAt,
    ].map(safeValue));
  }

  const signals: SheetValue[][] = [[
    "Tespit Saati", "Tür", "Maç", "Pazar", "Seçim", "Çizgi", "Açıklama", "Telegram Saati", "Sinyal Kimliği",
  ]];
  for (const signal of dataset.signals.filter((signal) => activeEventNames.has(signal.event))) {
    signals.push([
      signal.detectedAt, signal.type, signal.event, signal.market, signal.selection, signal.line ?? "",
      signal.detail, signal.notifiedAt ?? "", signal.id,
    ].map(safeValue));
  }

  return [
    { title: "BUGUN_NE_OYNANIR", rows: simpleDecisionRows(historyForSheet, fixturesForSheet), columnWidths: [60, 95, 120, 240, 260, 85, 150, 90, 360] },
    { title: "Kupon_Adaylari", rows: couponCandidateRows(historyForSheet, fixturesForSheet), columnWidths: [120, 70, 230, 90, 155, 105, 145, 80, 100, 155, 115, 105, 105, 80, 90, 330, 165] },
    { title: "Pazar_Ozeti", rows: marketSummaryRows(historyForSheet), columnWidths: [230, 90, 155, 105, 145, 80, 100, 155, 105, 100, 90, 90] },
    { title: "Gol_Alt_Ust", rows: marketRows(historyForSheet, ["total_goals", "both_teams_to_score"]), columnWidths: [230, 90, 155, 105, 145, 80, 155, 90, 165] },
    { title: "Kornerler", rows: marketRows(historyForSheet, ["corners"]), columnWidths: [230, 90, 155, 105, 145, 80, 155, 90, 165] },
    { title: "Kartlar", rows: marketRows(historyForSheet, ["cards"]), columnWidths: [230, 90, 155, 105, 145, 80, 155, 90, 165] },
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
        data: tables.map((table) => ({ range: `'${table.title}'!A1`, majorDimension: "ROWS", values: table.rows })),
      }),
    });
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

  private async ensureSheets(token: string, titles: string[]): Promise<Map<string, number>> {
    const metadata = await this.request<SpreadsheetMetadata>(
      `${SHEETS_API}/${encodeURIComponent(this.id)}?fields=sheets.properties(sheetId,title)`, token,
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
        `${SHEETS_API}/${encodeURIComponent(this.id)}?fields=sheets.properties(sheetId,title)`, token,
      );
      for (const sheet of refreshed.sheets ?? []) {
        const title = sheet.properties?.title;
        const id = sheet.properties?.sheetId;
        if (title && typeof id === "number") result.set(title, id);
      }
    }
    for (const title of titles) if (!result.has(title)) throw new Error(`Google Sheet sekmesi olusturulamadi: ${title}`);
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
              backgroundColor: table.title === "BUGUN_NE_OYNANIR"
                ? { red: 0.08, green: 0.35, blue: 0.20 }
                : { red: 0.04, green: 0.14, blue: 0.24 },
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

      if ((table.title === "Kupon_Adaylari" || table.title === "BUGUN_NE_OYNANIR") && table.rows.length > 1) {
        const verdictColumn = table.title === "BUGUN_NE_OYNANIR" ? 2 : 0;
        const rowEnd = table.rows.length;
        const rules = [
          { text: "GÜÇLÜ ADAY", backgroundColor: { red: 0.82, green: 0.94, blue: 0.84 } },
          { text: "İZLE", backgroundColor: { red: 1, green: 0.95, blue: 0.76 } },
          { text: "UZAK DUR", backgroundColor: { red: 0.97, green: 0.82, blue: 0.82 } },
          { text: "BEKLE", backgroundColor: { red: 0.90, green: 0.90, blue: 0.90 } },
        ];
        for (const rule of rules) {
          requests.push({
            addConditionalFormatRule: {
              rule: {
                ranges: [{
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowEnd,
                  startColumnIndex: verdictColumn,
                  endColumnIndex: verdictColumn + 1,
                }],
                booleanRule: {
                  condition: { type: "TEXT_EQ", values: [{ userEnteredValue: rule.text }] },
                  format: { backgroundColor: rule.backgroundColor, textFormat: { bold: true } },
                },
              },
              index: 0,
            },
          });
        }
      }
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
