import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { setProviderDiagnostic } from "../provider-diagnostics.js";

const SOURCE_URL = "https://www.mackolik.com/iddaa";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36";
const MAX_HTML_BYTES = 2_000_000;

export interface MackolikIddaaProviderOptions {
  maxMatches?: number;
  requestTimeoutMs?: number;
}

interface ParsedRow {
  eventId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  prices: number[];
}

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

function stableEventId(dateText: string, timeText: string, homeTeam: string, awayTeam: string): string {
  return createHash("sha256")
    .update([dateText, timeText, homeTeam, awayTeam].join("|"))
    .digest("hex")
    .slice(0, 20);
}

function priceValues(text: string): number[] {
  const matches = text.match(/\b\d+[.,]\d{2}\b/g) ?? [];
  return matches
    .map((value) => Number(value.replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 1 && value < 100);
}

function teamLinks($: ReturnType<typeof load>, element: Parameters<ReturnType<typeof load>>[0]): string[] {
  const values: string[] = [];
  $(element).find("a").each((_index, anchor) => {
    const value = normalizeSpace($(anchor).text());
    if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value)) return;
    if (value.length < 2 || value.length > 80) return;
    if (/^(detay|istatistik|tahmin|canlı|canli|oran|kupon)$/i.test(value)) return;
    if (!values.includes(value)) values.push(value);
  });
  return values;
}

export function parseMackolikIddaaHtml(html: string, now = new Date()): OddsQuote[] {
  const $ = load(html);
  const headingText = normalizeSpace($("h1,h2,h3,time").map((_index, element) => $(element).text()).get().join(" "));
  const dateText = headingText.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/)?.[0]
    ?? new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(now);

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();

  $("tr,[role='row']").each((_index, element) => {
    const cells = $(element).find("th,td").map((_cellIndex, cell) => normalizeSpace($(cell).text())).get();
    const rawText = normalizeSpace(cells.length ? cells.join(" ") : $(element).text());
    const prices = priceValues(rawText);
    if (prices.length < 3) return;

    const teams = teamLinks($, element);
    if (teams.length < 2) return;
    const homeTeam = teams[0]!;
    const awayTeam = teams[1]!;

    let timeText = rawText.match(/\b\d{1,2}:\d{2}\b/)?.[0] ?? "";
    if (!timeText) {
      const current = $(element);
      current.prevAll().slice(0, 8).each((_i, previous) => {
        if (timeText) return;
        const previousCells = $(previous).find("th,td").map((_cellIndex, cell) => normalizeSpace($(cell).text())).get();
        const previousText = normalizeSpace(previousCells.length ? previousCells.join(" ") : $(previous).text());
        timeText = previousText.match(/\b\d{1,2}:\d{2}\b/)?.[0] ?? "";
      });
    }
    if (!timeText) return;

    const commenceTime = turkeyIso(dateText, timeText);
    if (!commenceTime) return;

    const eventId = stableEventId(dateText, timeText, homeTeam, awayTeam);
    if (seen.has(eventId)) return;
    seen.add(eventId);

    const homeIndex = rawText.indexOf(homeTeam);
    let prefix = homeIndex > 0 ? rawText.slice(0, homeIndex) : "";
    prefix = normalizeSpace(prefix.replace(timeText, "").replace(/^[-–—|\s]+/, ""));
    const leagueName = prefix || "İddaa Bülteni";

    rows.push({
      eventId,
      leagueName,
      homeTeam,
      awayTeam,
      commenceTime,
      prices: prices.slice(0, 8),
    });
  });

  const updatedAt = now.toISOString();
  const quotes: OddsQuote[] = [];
  for (const row of rows) {
    const common = {
      provider: "mackolik_iddaa",
      bookmakerKey: "iddaa",
      bookmakerName: "İddaa (Mackolik)",
      sourceEventId: row.eventId,
      sportKey: "soccer",
      leagueName: row.leagueName,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      commenceTime: row.commenceTime,
      phase: "prematch" as const,
      period: "full_time" as const,
      updatedAt,
      sourceUrl: SOURCE_URL,
    };

    const winnerSelections = [
      { key: "home", name: "1", price: row.prices[0] },
      { key: "draw", name: "X", price: row.prices[1] },
      { key: "away", name: "2", price: row.prices[2] },
    ];
    for (const selection of winnerSelections) {
      if (!selection.price) continue;
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
      { key: "home_or_draw", name: "1-X", price: row.prices[3] },
      { key: "home_or_away", name: "1-2", price: row.prices[4] },
      { key: "draw_or_away", name: "X-2", price: row.prices[5] },
    ];
    for (const selection of doubleChance) {
      if (!selection.price) continue;
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
      { key: "under", name: "Alt", price: row.prices[6] },
      { key: "over", name: "Üst", price: row.prices[7] },
    ];
    for (const selection of totals) {
      if (!selection.price) continue;
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
    const mode = "http";
    let html = "";

    try {
      const timeout = AbortSignal.timeout(this.options.requestTimeoutMs ?? 20_000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(SOURCE_URL, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "tr-TR,tr;q=0.9,en;q=0.7",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: requestSignal,
      });
      if (response.ok) {
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_HTML_BYTES) {
          throw new Error("Mackolik İddaa sayfasi beklenenden buyuk.");
        }
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let total = 0;
          const chunks: string[] = [];
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > MAX_HTML_BYTES) {
                await reader.cancel();
                throw new Error("Mackolik İddaa sayfasi beklenenden buyuk.");
              }
              chunks.push(decoder.decode(value, { stream: true }));
            }
            chunks.push(decoder.decode());
            html = chunks.join("");
          } finally {
            reader.releaseLock();
          }
        } else {
          html = await response.text();
          if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
            throw new Error("Mackolik İddaa sayfasi beklenenden buyuk.");
          }
        }
      }
    } catch {
      html = "";
    }

    let quotes = html ? parseMackolikIddaaHtml(html, new Date()) : [];

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
      mode,
      fixtureCount: this.lastFixtures.length,
      quoteCount: quotes.length,
      lastProviderRunAt: startedAt.toISOString(),
      lastSuccessAt: quotes.length > 0 ? new Date().toISOString() : null,
      lastError: quotes.length > 0 ? null : "Mackolik İddaa bülteninde HTTP üzerinden parse edilebilir oran bulunamadı.",
      source: "https://www.mackolik.com/iddaa",
    });

    return quotes;
  }

  getLastFixtures(): MatchFixture[] {
    return [...this.lastFixtures];
  }

}
