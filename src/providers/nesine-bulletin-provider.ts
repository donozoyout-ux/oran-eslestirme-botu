import type { LeagueScope } from "../league-scope.js";
import type { MatchFixture, OddsProvider, OddsQuote } from "../domain.js";
import { errorMessage } from "../logger.js";
import { setProviderDiagnostic } from "../provider-diagnostics.js";

const BULLETIN_URLS = [
  "https://cdnbulten.nesine.com/api/bulten/getprebultenfull",
  "https://bulten.nesine.com/api/bulten/getprebultenfull",
] as const;
const SOURCE_URL = "https://www.nesine.com/iddaa";
const BOOKMAKER_KEY = "nesine_iddaa";
const BOOKMAKER_NAME = "Nesine (İddaa)";
const MIN_VALID_ODDS = 1.01;

interface NesineOutcome {
  N?: number;
  O?: number;
}

interface NesineMarket {
  MTID?: number;
  SOV?: number;
  OCA?: NesineOutcome[];
}

interface NesineEvent {
  C?: number | string;
  EV?: number | string;
  GT?: number;
  LC?: number;
  HN?: string;
  AN?: string;
  ESD?: number;
  MA?: NesineMarket[];
}

interface NesineLeague {
  LID?: number;
  N?: string;
}

interface NesinePayload {
  sg?: {
    EA?: NesineEvent[];
    LA?: NesineLeague[];
  };
}

export interface NesineBulletinProviderOptions {
  leagueScope: LeagueScope;
  cacheMinutes?: number;
  requestTimeoutMs?: number;
}

export interface ParsedNesineBulletin {
  quotes: OddsQuote[];
  fixtures: MatchFixture[];
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function leagueAllowed(leagueName: string, scope: LeagueScope): boolean {
  if (scope === "all") return true;
  const value = normalize(leagueName);
  const exactOrDecorated = (name: string): boolean =>
    value === name || value.startsWith(`${name} `) || value.endsWith(` ${name}`);
  return [
    "premier league",
    "championship",
    "la liga",
    "bundesliga",
    "serie a",
    "ligue 1",
  ].some(exactOrDecorated);
}

function validOdd(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > MIN_VALID_ODDS ? price : null;
}

function outcomePrice(market: NesineMarket, outcomeNumber: number): number | null {
  const outcome = market.OCA?.find((item) => item.N === outcomeNumber);
  return validOdd(outcome?.O);
}

function eventId(event: NesineEvent): string | null {
  const value = event.C ?? event.EV;
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value);
}

function pushQuote(
  quotes: OddsQuote[],
  common: Omit<OddsQuote, "marketKey" | "marketName" | "selectionKey" | "selectionName" | "line" | "price">,
  market: Pick<OddsQuote, "marketKey" | "marketName" | "line">,
  selectionKey: string,
  selectionName: string,
  price: number | null,
): void {
  if (price === null) return;
  quotes.push({ ...common, ...market, selectionKey, selectionName, price });
}

export function parseNesineBulletin(
  payload: NesinePayload,
  now = new Date(),
  scope: LeagueScope = "all",
): ParsedNesineBulletin {
  const sg = payload.sg ?? {};
  const leagueNames = new Map<number, string>();
  for (const league of sg.LA ?? []) {
    if (typeof league.LID === "number" && league.N) leagueNames.set(league.LID, league.N.trim());
  }

  const quotes: OddsQuote[] = [];
  const fixtures: MatchFixture[] = [];
  const capturedAt = now.toISOString();

  for (const event of sg.EA ?? []) {
    if (event.GT !== 1 || !event.HN || !event.AN) continue;
    const sourceEventId = eventId(event);
    if (!sourceEventId) continue;
    const kickoffMs = Number(event.ESD);
    if (!Number.isFinite(kickoffMs) || kickoffMs <= now.getTime()) continue;

    const leagueName = leagueNames.get(event.LC ?? -1) ?? "Nesine Futbol";
    if (!leagueAllowed(leagueName, scope)) continue;

    const commenceTime = new Date(kickoffMs).toISOString();
    const common = {
      provider: "nesine_bulletin",
      bookmakerKey: BOOKMAKER_KEY,
      bookmakerName: BOOKMAKER_NAME,
      sourceEventId,
      sportKey: "soccer",
      leagueName,
      homeTeam: event.HN.trim(),
      awayTeam: event.AN.trim(),
      commenceTime,
      phase: "prematch" as const,
      period: "full_time" as const,
      updatedAt: capturedAt,
      sourceUrl: SOURCE_URL,
    };

    const before = quotes.length;
    for (const market of event.MA ?? []) {
      if (market.MTID === 1) {
        const definition = { marketKey: "match_winner_3way" as const, marketName: "Maç Sonucu", line: null };
        pushQuote(quotes, common, definition, "home", event.HN.trim(), outcomePrice(market, 1));
        pushQuote(quotes, common, definition, "draw", "Beraberlik", outcomePrice(market, 2));
        pushQuote(quotes, common, definition, "away", event.AN.trim(), outcomePrice(market, 3));
        continue;
      }

      if (market.MTID === 3) {
        const definition = { marketKey: "double_chance" as const, marketName: "Çifte Şans", line: null };
        pushQuote(quotes, common, definition, "home_or_draw", "1X", outcomePrice(market, 1));
        pushQuote(quotes, common, definition, "home_or_away", "12", outcomePrice(market, 2));
        pushQuote(quotes, common, definition, "draw_or_away", "X2", outcomePrice(market, 3));
        continue;
      }

      if ([11, 12, 13].includes(market.MTID ?? -1)) {
        const line = Number(market.SOV);
        if (!Number.isFinite(line) || line <= 0) continue;
        const definition = { marketKey: "total_goals" as const, marketName: "Toplam Gol Alt/Üst", line };
        pushQuote(quotes, common, definition, "under", "Alt", outcomePrice(market, 1));
        pushQuote(quotes, common, definition, "over", "Üst", outcomePrice(market, 2));
        continue;
      }

      if (market.MTID === 38) {
        const definition = { marketKey: "both_teams_to_score" as const, marketName: "Karşılıklı Gol", line: null };
        pushQuote(quotes, common, definition, "yes", "Var", outcomePrice(market, 1));
        pushQuote(quotes, common, definition, "no", "Yok", outcomePrice(market, 2));
      }
    }

    if (quotes.length > before) {
      fixtures.push({
        provider: "nesine_bulletin",
        sourceEventId,
        leagueName,
        homeTeam: event.HN.trim(),
        awayTeam: event.AN.trim(),
        commenceTime,
        phase: "prematch",
        sourceUrl: SOURCE_URL,
        lastOddsCheckAt: capturedAt,
        resultStatus: "scheduled",
      });
    }
  }

  return { quotes, fixtures };
}

export class NesineBulletinProvider implements OddsProvider {
  readonly name = "nesine_bulletin";
  private readonly cacheMs: number;
  private readonly requestTimeoutMs: number;
  private cached: { at: number; quotes: OddsQuote[]; fixtures: MatchFixture[] } | null = null;
  private lastFixtures: MatchFixture[] = [];

  constructor(private readonly options: NesineBulletinProviderOptions) {
    this.cacheMs = Math.max(1, options.cacheMinutes ?? 5) * 60_000;
    this.requestTimeoutMs = Math.max(5_000, options.requestTimeoutMs ?? 20_000);
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const now = new Date();
    if (this.cached && now.getTime() - this.cached.at < this.cacheMs) {
      this.lastFixtures = this.cached.fixtures;
      return this.cached.quotes;
    }

    const errors: string[] = [];
    for (const url of BULLETIN_URLS) {
      try {
        const timeout = AbortSignal.timeout(this.requestTimeoutMs);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
            referer: SOURCE_URL,
            "user-agent": "Mozilla/5.0 (compatible; OranEslesmeBot/0.2; public bulletin monitor)",
          },
          signal: requestSignal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as NesinePayload;
        const parsed = parseNesineBulletin(payload, now, this.options.leagueScope);
        this.lastFixtures = parsed.fixtures;
        this.cached = { at: now.getTime(), quotes: parsed.quotes, fixtures: parsed.fixtures };
        setProviderDiagnostic(this.name, {
          enabled: true,
          status: "ok",
          endpoint: url,
          fixtureCount: parsed.fixtures.length,
          quoteCount: parsed.quotes.length,
          cacheMinutes: Math.round(this.cacheMs / 60_000),
          lastSuccessAt: now.toISOString(),
          lastError: null,
        });
        return parsed.quotes;
      } catch (error) {
        errors.push(`${url}: ${errorMessage(error)}`);
      }
    }

    const message = errors.join("; ");
    setProviderDiagnostic(this.name, {
      enabled: true,
      status: "error",
      fixtureCount: this.lastFixtures.length,
      quoteCount: this.cached?.quotes.length ?? 0,
      cacheMinutes: Math.round(this.cacheMs / 60_000),
      lastSuccessAt: this.cached ? new Date(this.cached.at).toISOString() : null,
      lastError: message,
    });
    throw new Error(`Nesine bülteni okunamadı: ${message}`);
  }

  getLastFixtures(): MatchFixture[] {
    return [...this.lastFixtures];
  }
}
