import { createHash } from "node:crypto";
import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { setProviderDiagnostic } from "../provider-diagnostics.js";

const SOURCE_PAGE = "https://arsiv.mackolik.com/Genis-Iddaa-Programi";
const DATA_ENDPOINT = "https://arsiv.mackolik.com/AjaxHandlers/ProgramDataHandler.ashx";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36";
const MAX_DATA_BYTES = 4_000_000;

export interface MackolikIddaaProviderOptions {
  maxMatches?: number;
  requestTimeoutMs?: number;
}

type LegacyValue = null | boolean | number | string | LegacyValue[] | { [key: string]: LegacyValue };

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function turkeyIso(dateText: string, timeText: string): string | null {
  const match = dateText.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  const time = timeText.match(/(\d{1,2}):(\d{2})/);
  if (!match || !time) return null;
  const [, day, month, year] = match;
  const [, hour, minute] = time;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00+03:00`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function istanbulDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("day")}.${pick("month")}.${pick("year")}`;
}

function stableEventId(dateText: string, timeText: string, homeTeam: string, awayTeam: string): string {
  return createHash("sha256")
    .update([dateText, timeText, homeTeam, awayTeam].join("|"))
    .digest("hex")
    .slice(0, 20);
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1 ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function toJsonCompatible(input: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index]!;
    if (quote) {
      if (escaped) {
        if (quote === "'" && ch === "'") out += "'";
        else if (ch === '"') out += '\\"';
        else out += `\\${ch}`;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        out += '"';
        quote = null;
        continue;
      }
      if (quote === "'" && ch === '"') out += '\\"';
      else out += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += '"';
      continue;
    }
    out += ch;
  }
  if (quote) throw new Error("Mackolik payload icinde kapanmayan string var.");

  return out.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');
}

export function parseMackolikLegacyPayload(text: string): LegacyValue {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Mackolik bos payload dondurdu.");
  try {
    return JSON.parse(trimmed) as LegacyValue;
  } catch {
    return JSON.parse(toJsonCompatible(trimmed)) as LegacyValue;
  }
}

function collectMatchRows(value: LegacyValue, result: LegacyValue[][] = []): LegacyValue[][] {
  if (Array.isArray(value)) {
    if (
      value.length >= 27
      && typeof value[1] === "string"
      && typeof value[3] === "string"
      && typeof value[6] === "string"
      && typeof value[7] === "string"
    ) {
      result.push(value);
      return result;
    }
    for (const item of value) collectMatchRows(item, result);
    return result;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectMatchRows(item, result);
  }
  return result;
}

export function parseMackolikProgramPayload(text: string, now = new Date()): OddsQuote[] {
  const payload = parseMackolikLegacyPayload(text);
  const rows = collectMatchRows(payload);
  const updatedAt = now.toISOString();
  const quotes: OddsQuote[] = [];

  for (const row of rows) {
    const homeTeam = normalizeSpace(String(row[1] ?? ""));
    const awayTeam = normalizeSpace(String(row[3] ?? ""));
    const timeText = normalizeSpace(String(row[6] ?? ""));
    const dateText = normalizeSpace(String(row[7] ?? ""));
    const leagueName = normalizeSpace(String(row[26] ?? "İddaa Bülteni")) || "İddaa Bülteni";
    if (!homeTeam || !awayTeam || !timeText || !dateText) continue;

    const commenceTime = turkeyIso(dateText, timeText);
    if (!commenceTime) continue;

    const rawId = String(row[0] ?? row[10] ?? "").trim();
    const eventId = rawId || stableEventId(dateText, timeText, homeTeam, awayTeam);
    const common = {
      provider: "mackolik_iddaa",
      bookmakerKey: "iddaa",
      bookmakerName: "İddaa (Mackolik)",
      sourceEventId: eventId,
      sportKey: "soccer",
      leagueName,
      homeTeam,
      awayTeam,
      commenceTime,
      phase: "prematch" as const,
      period: "full_time" as const,
      updatedAt,
      sourceUrl: SOURCE_PAGE,
    };

    const winnerSelections = [
      { key: "home", name: "1", price: numeric(row[16]) },
      { key: "draw", name: "X", price: numeric(row[17]) },
      { key: "away", name: "2", price: numeric(row[18]) },
    ];
    for (const selection of winnerSelections) {
      if (selection.price === null) continue;
      quotes.push({
        ...common,
        marketKey: "match_winner_3way",
        marketName: "Maç Sonucu",
        selectionKey: selection.key,
        selectionName: selection.name,
        line: null,
        price: selection.price,
      });
    }

    const doubleChance = [
      { key: "home_or_draw", name: "1-X", price: numeric(row[19]) },
      { key: "home_or_away", name: "1-2", price: numeric(row[20]) },
      { key: "draw_or_away", name: "X-2", price: numeric(row[21]) },
    ];
    for (const selection of doubleChance) {
      if (selection.price === null) continue;
      quotes.push({
        ...common,
        marketKey: "double_chance",
        marketName: "Çifte Şans",
        selectionKey: selection.key,
        selectionName: selection.name,
        line: null,
        price: selection.price,
      });
    }

    const totals = [
      { key: "under", name: "Alt", price: numeric(row[22]) },
      { key: "over", name: "Üst", price: numeric(row[23]) },
    ];
    for (const selection of totals) {
      if (selection.price === null) continue;
      quotes.push({
        ...common,
        marketKey: "total_goals",
        marketName: "Toplam Gol",
        selectionKey: selection.key,
        selectionName: selection.name,
        line: 2.5,
        price: selection.price,
      });
    }
  }

  return quotes;
}

export class MackolikIddaaProvider implements OddsProvider {
  readonly name = "mackolik_iddaa";
  private lastFixtures: MatchFixture[] = [];

  constructor(private readonly options: MackolikIddaaProviderOptions = {}) {}

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const startedAt = new Date();
    const day = istanbulDate(startedAt);
    let quotes: OddsQuote[] = [];
    let fetchError: string | null = null;

    try {
      const url = new URL(DATA_ENDPOINT);
      url.searchParams.set("type", "6");
      url.searchParams.set("sortValue", "DATE");
      url.searchParams.set("day", day);
      url.searchParams.set("sort", "-1");
      url.searchParams.set("sortDir", "-1");
      url.searchParams.set("groupId", "-1");
      url.searchParams.set("np", "1");
      url.searchParams.set("sport", "1");

      const timeout = AbortSignal.timeout(this.options.requestTimeoutMs ?? 20_000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(url, {
        headers: {
          accept: "*/*",
          "accept-language": "tr-TR,tr;q=0.9,en;q=0.7",
          "user-agent": USER_AGENT,
          "x-requested-with": "XMLHttpRequest",
          referer: SOURCE_PAGE,
        },
        redirect: "follow",
        signal: requestSignal,
      });
      if (!response.ok) throw new Error(`Mackolik arsiv endpointi ${response.status} dondurdu.`);

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_DATA_BYTES) throw new Error("Mackolik arsiv payload'u beklenenden buyuk.");
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_DATA_BYTES) throw new Error("Mackolik arsiv payload'u beklenenden buyuk.");
      quotes = parseMackolikProgramPayload(body, startedAt);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
      quotes = [];
    }

    const eventOrder = [...new Set(quotes.map((quote) => quote.sourceEventId))]
      .map((eventId) => ({
        eventId,
        kickoff: Date.parse(quotes.find((quote) => quote.sourceEventId === eventId)?.commenceTime ?? ""),
      }))
      .filter((row) => Number.isFinite(row.kickoff))
      .sort((a, b) => a.kickoff - b.kickoff)
      .slice(0, Math.max(1, this.options.maxMatches ?? 12))
      .map((row) => row.eventId);
    const allowed = new Set(eventOrder);
    quotes = quotes.filter((quote) => allowed.has(quote.sourceEventId));

    const fixtures = new Map<string, MatchFixture>();
    for (const quote of quotes) {
      fixtures.set(quote.sourceEventId, {
        provider: this.name,
        sourceEventId: quote.sourceEventId,
        leagueName: quote.leagueName,
        homeTeam: quote.homeTeam,
        awayTeam: quote.awayTeam,
        commenceTime: quote.commenceTime,
        phase: quote.phase,
        sourceUrl: quote.sourceUrl,
        lastOddsCheckAt: quote.updatedAt,
      });
    }
    this.lastFixtures = [...fixtures.values()];

    setProviderDiagnostic("mackolik_iddaa", {
      enabled: true,
      status: quotes.length > 0 ? "ok" : "empty",
      mode: "archive_ajax",
      fixtureCount: this.lastFixtures.length,
      quoteCount: quotes.length,
      lastProviderRunAt: startedAt.toISOString(),
      lastSuccessAt: quotes.length > 0 ? new Date().toISOString() : null,
      lastError: quotes.length > 0 ? null : (fetchError ?? "Mackolik arsiv İddaa akışında parse edilebilir oran bulunamadı."),
      source: SOURCE_PAGE,
    });

    return quotes;
  }

  getLastFixtures(): MatchFixture[] {
    return [...this.lastFixtures];
  }
}
