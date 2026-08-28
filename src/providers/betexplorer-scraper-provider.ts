import { load } from "cheerio";
import { chromium, type Browser, type Page } from "playwright-core";
import type { MarketKey, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage, logger } from "../logger.js";

const BASE_URL = "https://www.betexplorer.com";
const INDEX_URL = `${BASE_URL}/football/next/`;
const USER_AGENT = "OranEslesmeBot/0.2 (+public odds comparison monitor; low frequency)";
const MAX_INDEX_BYTES = 2_000_000;

export interface BetExplorerScraperOptions {
  bookmakerKeys: string[];
  maxMatches: number;
  maxLiveEventAgeMinutes: number;
  pageTimeoutMs: number;
  waitMs: number;
  executablePath?: string;
}

export interface BetExplorerCandidate {
  eventId: string;
  url: string;
  commenceTime: string;
  phaseHint: "prematch" | "live";
  deltaMinutes: number;
}

interface RawPrematchOdd {
  price: string | null;
  position: string | null;
}

interface RawPrematchRow {
  bookmaker: string;
  odds: RawPrematchOdd[];
}

interface RawLiveRow {
  bookmaker: string;
  market: string;
  line: string | null;
  prices: string[];
}

export interface BetExplorerPageSnapshot {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  live: boolean;
  prematchRows: RawPrematchRow[];
  liveRows: RawLiveRow[];
}

function siteTime(raw: string | undefined): number | null {
  if (!raw) return null;
  const values = raw.split(",").map(Number);
  if (values.length !== 5 || values.some((value) => !Number.isInteger(value))) return null;
  const [day, month, year, hour, minute] = values;
  if (!day || !month || !year || hour === undefined || minute === undefined) return null;
  const value = Date.UTC(year, month - 1, day, hour, minute);
  return Number.isFinite(value) ? value : null;
}

export function parseCandidateIndexHtml(
  html: string,
  now: Date,
  options: Pick<BetExplorerScraperOptions, "maxMatches" | "maxLiveEventAgeMinutes">,
): BetExplorerCandidate[] {
  const $ = load(html);
  const firstRow = $(".table-main__matchInfo[data-dt-now]").first();
  const siteNow = siteTime(firstRow.attr("data-dt-now"));
  if (siteNow === null) throw new Error("BetExplorer sayfa saati okunamadi.");

  const candidates: BetExplorerCandidate[] = [];
  const seen = new Set<string>();
  const alignedNowMs = Math.floor(now.getTime() / 60_000) * 60_000;
  $(".table-main__matchInfo[data-live][data-dt]").each((_index, element) => {
    const row = $(element);
    const eventId = row.attr("data-live")?.trim();
    const rawHref = row.find('a[data-live-cell="matchlink"]').first().attr("href")?.trim();
    const eventTime = siteTime(row.attr("data-dt"));
    if (!eventId || !/^[A-Za-z0-9]{8}$/.test(eventId) || !rawHref || eventTime === null) return;
    if (!/^\/football\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9]{8}\/$/.test(rawHref)) return;
    if (seen.has(eventId)) return;
    seen.add(eventId);

    const deltaMinutes = (eventTime - siteNow) / 60_000;
    if (deltaMinutes < -options.maxLiveEventAgeMinutes) return;
    candidates.push({
      eventId,
      url: new URL(rawHref, BASE_URL).toString(),
      commenceTime: new Date(alignedNowMs + deltaMinutes * 60_000).toISOString(),
      phaseHint: deltaMinutes <= 0 ? "live" : "prematch",
      deltaMinutes,
    });
  });

  const live = candidates
    .filter((candidate) => candidate.phaseHint === "live")
    .sort((a, b) => b.deltaMinutes - a.deltaMinutes);
  const upcoming = candidates
    .filter((candidate) => candidate.phaseHint === "prematch")
    .sort((a, b) => a.deltaMinutes - b.deltaMinutes);
  const liveTarget = Math.ceil(options.maxMatches / 2);
  const selected = [...live.slice(0, liveTarget), ...upcoming.slice(0, options.maxMatches - liveTarget)];
  const selectedIds = new Set(selected.map((candidate) => candidate.eventId));
  const remainder = [...live.slice(liveTarget), ...upcoming.slice(options.maxMatches - liveTarget)];
  for (const candidate of remainder) {
    if (selected.length >= options.maxMatches) break;
    if (!selectedIds.has(candidate.eventId)) {
      selected.push(candidate);
      selectedIds.add(candidate.eventId);
    }
  }
  return selected;
}

export function canonicalBookmaker(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (normalized === "betfair_exchange") return "betfair_exchange";
  return normalized;
}

function allowedBookmakers(keys: string[]): Set<string> {
  const result = new Set(keys.map(canonicalBookmaker));
  if (result.has("betfair_ex_eu") || result.has("betfair_ex_uk")) result.add("betfair_exchange");
  return result;
}

function numberFromText(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

interface OutcomeDefinition {
  marketKey: MarketKey;
  marketName: string;
  selections: Array<{ key: string; name: string }>;
  lineRequired?: boolean;
}

const liveMarketDefinitions: Record<string, OutcomeDefinition> = {
  "1x2": {
    marketKey: "match_winner_3way",
    marketName: "Mac Sonucu",
    selections: [
      { key: "home", name: "Ev Sahibi" },
      { key: "draw", name: "Beraberlik" },
      { key: "away", name: "Deplasman" },
    ],
  },
  ou: {
    marketKey: "total_goals",
    marketName: "Toplam Gol",
    selections: [
      { key: "over", name: "Ust" },
      { key: "under", name: "Alt" },
    ],
    lineRequired: true,
  },
  ah: {
    marketKey: "handicap",
    marketName: "Asya Handikap",
    selections: [
      { key: "home", name: "Ev Sahibi" },
      { key: "away", name: "Deplasman" },
    ],
    lineRequired: true,
  },
  dnb: {
    marketKey: "custom:draw_no_bet",
    marketName: "Beraberlikte Iade",
    selections: [
      { key: "home", name: "Ev Sahibi" },
      { key: "away", name: "Deplasman" },
    ],
  },
  dc: {
    marketKey: "double_chance",
    marketName: "Cifte Sans",
    selections: [
      { key: "home_or_draw", name: "1X" },
      { key: "home_or_away", name: "12" },
      { key: "draw_or_away", name: "X2" },
    ],
  },
  btts: {
    marketKey: "both_teams_to_score",
    marketName: "Karsilikli Gol",
    selections: [
      { key: "yes", name: "Evet" },
      { key: "no", name: "Hayir" },
    ],
  },
};

export function parseDetailSnapshot(
  snapshot: BetExplorerPageSnapshot,
  candidate: BetExplorerCandidate,
  bookmakerKeys: string[],
  now: Date,
): OddsQuote[] {
  if (!snapshot.homeTeam || !snapshot.awayTeam) return [];
  const allowed = allowedBookmakers(bookmakerKeys);
  const quotes: OddsQuote[] = [];
  const common = {
    provider: "betexplorer_scraper",
    sourceEventId: candidate.eventId,
    sportKey: "soccer",
    leagueName: snapshot.leagueName || "Futbol",
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    commenceTime: candidate.commenceTime,
    period: "full_time" as const,
    updatedAt: now.toISOString(),
    sourceUrl: candidate.url,
  };

  if (!snapshot.live) {
    const selectionByPosition: Record<string, { key: string; name: string }> = {
      "1": { key: "home", name: "Ev Sahibi" },
      "0": { key: "draw", name: "Beraberlik" },
      "2": { key: "away", name: "Deplasman" },
    };
    for (const row of snapshot.prematchRows) {
      const bookmakerKey = canonicalBookmaker(row.bookmaker);
      if (!allowed.has(bookmakerKey)) continue;
      for (const odd of row.odds) {
        const selection = odd.position ? selectionByPosition[odd.position] : undefined;
        const price = numberFromText(odd.price);
        if (!selection || price === null || price <= 1) continue;
        quotes.push({
          ...common,
          bookmakerKey,
          bookmakerName: row.bookmaker,
          phase: "prematch",
          marketKey: "match_winner_3way",
          marketName: "Mac Sonucu",
          selectionKey: selection.key,
          selectionName: selection.name,
          line: null,
          price,
        });
      }
    }
  } else {
    for (const row of snapshot.liveRows) {
      const bookmakerKey = canonicalBookmaker(row.bookmaker);
      if (!allowed.has(bookmakerKey)) continue;
      const definition = liveMarketDefinitions[row.market];
      if (!definition || row.prices.length !== definition.selections.length) continue;
      const parsedLine = numberFromText(row.line);
      if (definition.lineRequired && parsedLine === null) continue;
      for (let index = 0; index < definition.selections.length; index += 1) {
        const selection = definition.selections[index];
        const price = numberFromText(row.prices[index]);
        if (!selection || price === null || price <= 1) continue;
        let line = definition.lineRequired ? parsedLine : null;
        if (row.market === "ah" && index === 1 && line !== null) line = -line;
        quotes.push({
          ...common,
          bookmakerKey,
          bookmakerName: row.bookmaker,
          phase: "live",
          marketKey: definition.marketKey,
          marketName: definition.marketName,
          selectionKey: selection.key,
          selectionName: selection.name,
          line,
          price,
        });
      }
    }
  }

  const deduplicated = new Map<string, OddsQuote>();
  for (const quote of quotes) {
    const key = [quote.bookmakerKey, quote.marketKey, quote.selectionKey, quote.line ?? "none"].join("|");
    deduplicated.set(key, quote);
  }
  return [...deduplicated.values()];
}

async function snapshotPage(page: Page): Promise<BetExplorerPageSnapshot> {
  return page.evaluate(() => {
    const text = (element: Element | null): string => (element?.textContent ?? "").trim();
    const teams = Array.from(document.querySelectorAll(".list-details__item__title.teamsLink")).map((element) =>
      text(element),
    );
    const breadcrumbs = Array.from(document.querySelectorAll(".breadcrumb__li a")).map((element) => text(element));
    const liveRows = Array.from(document.querySelectorAll("#live-odds-content .oddsComparison__liveOdds_row")).map(
      (row) => ({
        bookmaker: text(row.querySelector(".oddsComparison__liveOdds_bookie .desktopOnly")),
        market: row.getAttribute("data-bettype") ?? "",
        line: text(row.querySelector(".handicapForTabs")) || null,
        prices: Array.from(row.querySelectorAll(".oddsComparison__liveOdds_odd:not(.handicapForTabs) a")).map(
          (element) => text(element),
        ),
      }),
    );
    const prematchRows = Array.from(
      document.querySelectorAll(".oddsComparisonAll__content .oddsComparisonAll__rowBookie"),
    ).map((row) => ({
      bookmaker: text(row.querySelector(".over-s-only a")),
      odds: Array.from(row.querySelectorAll(".oddsComparisonAll__odds_heads [data-odd]")).map((odd) => ({
        price: odd.getAttribute("data-odd"),
        position: odd.getAttribute("data-pos"),
      })),
    }));
    return {
      homeTeam: teams[0] ?? "",
      awayTeam: teams[1] ?? "",
      leagueName: breadcrumbs.slice(-2).join(" · "),
      live: (document.querySelector("#isLive") as HTMLInputElement | null)?.value === "1",
      liveRows,
      prematchRows,
    };
  });
}

export class BetExplorerScraperProvider implements OddsProvider {
  readonly name = "betexplorer_scraper";
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly options: BetExplorerScraperOptions) {}

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = new Date();
    const candidates = await this.fetchCandidates(now, signal);
    if (candidates.length === 0) {
      logger.warn("BetExplorer taranacak mac dondurmedi.");
      return [];
    }

    const browser = await this.browser();
    const page = await browser.newPage();

    const quotes: OddsQuote[] = [];
    const errors: string[] = [];
    const availableBookmakers = new Set<string>();
    const pageDiagnostics: string[] = [];
    page.on("pageerror", (error) => pageDiagnostics.push(`js: ${error.message.slice(0, 180)}`));
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText;
      if (failure) pageDiagnostics.push(`${request.resourceType()}: ${failure.slice(0, 120)}`);
    });
    try {
      for (const candidate of candidates) {
        if (signal?.aborted) throw signal.reason;
        pageDiagnostics.length = 0;
        try {
          await page.goto(candidate.url, { waitUntil: "commit", timeout: this.options.pageTimeoutMs });
          const currentUrl = new URL(page.url());
          if (currentUrl.origin !== BASE_URL || !currentUrl.pathname.startsWith("/football/")) {
            throw new Error("Beklenmeyen sayfa yonlendirmesi.");
          }
          await page.waitForSelector("#bestOddsComponent", {
            state: "attached",
            timeout: this.options.pageTimeoutMs,
          });
          await page
            .waitForSelector(".oddsComparison__liveOdds_row, .oddsComparisonAll__rowBookie", {
              state: "attached",
              timeout: Math.min(this.options.pageTimeoutMs, 15_000),
            });
          await page.waitForTimeout(this.options.waitMs);
          const snapshot = await snapshotPage(page);
          for (const row of [...snapshot.liveRows, ...snapshot.prematchRows]) {
            if (row.bookmaker) availableBookmakers.add(row.bookmaker);
          }
          quotes.push(...parseDetailSnapshot(snapshot, candidate, this.options.bookmakerKeys, new Date()));
        } catch (error) {
          const diagnostic = pageDiagnostics.slice(-3).join(" | ");
          const message = `${candidate.eventId}: ${errorMessage(error)}${diagnostic ? ` [${diagnostic}]` : ""}`;
          errors.push(message);
          logger.warn("BetExplorer mac sayfasi okunamadi.", { eventId: candidate.eventId, error: errorMessage(error) });
        }
      }
    } finally {
      await page.close();
    }
    if (quotes.length === 0 && errors.length > 0) {
      throw new Error(`BetExplorer oran tablolari okunamadi: ${errors.slice(0, 2).join("; ")}`);
    }
    if (quotes.length === 0) {
      const available = [...availableBookmakers].slice(0, 12).join(", ");
      throw new Error(
        available
          ? `BetExplorer sayfasinda secilen bookmaker bulunamadi. Gorunenler: ${available}`
          : "BetExplorer dinamik oran satiri dondurmedi.",
      );
    }
    return quotes;
  }

  async close(): Promise<void> {
    const active = this.browserPromise;
    this.browserPromise = null;
    if (active) await (await active).close();
  }

  private async fetchCandidates(now: Date, externalSignal?: AbortSignal): Promise<BetExplorerCandidate[]> {
    const timeoutSignal = AbortSignal.timeout(this.options.pageTimeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(INDEX_URL, {
      headers: { accept: "text/html", "user-agent": USER_AGENT },
      redirect: "follow",
      signal,
    });
    if (!response.ok || new URL(response.url).origin !== BASE_URL) {
      throw new Error(`BetExplorer liste sayfasi ${response.status} dondurdu.`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_INDEX_BYTES) throw new Error("BetExplorer liste sayfasi beklenenden buyuk.");
    const html = await response.text();
    if (html.length > MAX_INDEX_BYTES) throw new Error("BetExplorer liste sayfasi beklenenden buyuk.");
    return parseCandidateIndexHtml(html, now, this.options);
  }

  private browser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium
        .launch({
          headless: true,
          executablePath: this.options.executablePath,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        })
        .catch((error) => {
          this.browserPromise = null;
          throw error;
        });
    }
    return this.browserPromise;
  }
}
