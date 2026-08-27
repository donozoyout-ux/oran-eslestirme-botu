import type { EventPhase, MarketKey, OddsProvider, OddsQuote } from "../domain.js";

interface ApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface ApiMarket {
  key: "h2h" | "spreads" | "totals" | string;
  last_update?: string;
  outcomes: ApiOutcome[];
}

interface ApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: ApiMarket[];
}

interface ApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: ApiBookmaker[];
}

export interface TheOddsApiProviderOptions {
  apiKey: string;
  sportKeys: string[];
  bookmakerKeys: string[];
  regions: string[];
  maxLiveEventAgeMinutes: number;
  baseUrl?: string;
  requestTimeoutMs?: number;
}

const marketMetadata: Record<string, { key: MarketKey; name: string }> = {
  h2h: { key: "match_winner_3way", name: "Mac Sonucu" },
  spreads: { key: "handicap", name: "Handikap" },
  totals: { key: "total_goals", name: "Toplam Gol" },
};

function selectionKey(marketKey: string, outcomeName: string, event: ApiEvent): string {
  const normalized = outcomeName.trim().toLocaleLowerCase("en-US");
  if (marketKey === "totals") {
    if (normalized === "over") return "over";
    if (normalized === "under") return "under";
  }
  if (normalized === "draw") return "draw";
  if (normalized === event.home_team.trim().toLocaleLowerCase("en-US")) return "home";
  if (normalized === event.away_team.trim().toLocaleLowerCase("en-US")) return "away";
  return `name:${normalized}`;
}

function phaseFor(commenceTime: string, now: Date, maxLiveEventAgeMinutes: number): EventPhase | null {
  const startMs = Date.parse(commenceTime);
  if (!Number.isFinite(startMs)) return null;
  if (startMs > now.getTime()) return "prematch";
  const ageMinutes = (now.getTime() - startMs) / 60_000;
  return ageMinutes <= maxLiveEventAgeMinutes ? "live" : null;
}

export class TheOddsApiProvider implements OddsProvider {
  readonly name = "the_odds_api";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: TheOddsApiProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.the-odds-api.com/v4";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<OddsQuote[]> {
    const results = await Promise.all(this.options.sportKeys.map((key) => this.fetchSport(key, signal)));
    return results.flat();
  }

  private async fetchSport(sportKey: string, externalSignal?: AbortSignal): Promise<OddsQuote[]> {
    const url = new URL(`${this.baseUrl}/sports/${encodeURIComponent(sportKey)}/odds`);
    url.searchParams.set("apiKey", this.options.apiKey);
    url.searchParams.set("regions", this.options.regions.join(","));
    url.searchParams.set("markets", "h2h,spreads,totals");
    url.searchParams.set("oddsFormat", "decimal");
    url.searchParams.set("dateFormat", "iso");
    if (this.options.bookmakerKeys.length > 0) {
      url.searchParams.set("bookmakers", this.options.bookmakerKeys.join(","));
    }

    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const requestSignal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "oran-eslestirme-botu/0.1" },
      signal: requestSignal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`The Odds API ${response.status}: ${body}`);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("The Odds API beklenmeyen yanit dondurdu.");
    return this.mapEvents(payload as ApiEvent[]);
  }

  private mapEvents(events: ApiEvent[]): OddsQuote[] {
    const now = new Date();
    const quotes: OddsQuote[] = [];
    for (const event of events) {
      if (!event || !Array.isArray(event.bookmakers)) continue;
      const phase = phaseFor(event.commence_time, now, this.options.maxLiveEventAgeMinutes);
      if (!phase) continue;

      for (const bookmaker of event.bookmakers) {
        if (!Array.isArray(bookmaker.markets)) continue;
        for (const market of bookmaker.markets) {
          const metadata = marketMetadata[market.key];
          if (!metadata || !Array.isArray(market.outcomes)) continue;
          for (const outcome of market.outcomes) {
            if (!Number.isFinite(outcome.price) || outcome.price <= 1) continue;
            quotes.push({
              provider: this.name,
              bookmakerKey: bookmaker.key,
              bookmakerName: bookmaker.title,
              sourceEventId: event.id,
              sportKey: event.sport_key,
              leagueName: event.sport_title,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              commenceTime: event.commence_time,
              phase,
              marketKey: metadata.key,
              marketName: metadata.name,
              period: "full_time",
              selectionKey: selectionKey(market.key, outcome.name, event),
              selectionName: outcome.name,
              line: Number.isFinite(outcome.point) ? Number(outcome.point) : null,
              price: Number(outcome.price),
              updatedAt: market.last_update ?? bookmaker.last_update,
            });
          }
        }
      }
    }
    return quotes;
  }
}
