import type { MarketKey, OddsProvider, OddsQuote, PeriodKey } from "../domain.js";

interface MockQuoteInput {
  eventId: string;
  bookmakerKey: string;
  bookmakerName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  phase: "prematch" | "live";
  marketKey: MarketKey;
  marketName: string;
  selectionKey: string;
  selectionName: string;
  price: number;
  line?: number;
  period?: PeriodKey;
}

export class MockOddsProvider implements OddsProvider {
  readonly name = "mock";

  async fetchQuotes(): Promise<OddsQuote[]> {
    const now = new Date();
    const updatedAt = now.toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const liveStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

    const inputs: MockQuoteInput[] = [
      {
        eventId: "demo-1",
        bookmakerKey: "pinnacle",
        bookmakerName: "Pinnacle (DEMO)",
        homeTeam: "Galatasaray",
        awayTeam: "Fenerbahce",
        commenceTime: tomorrow,
        phase: "prematch",
        marketKey: "match_winner_3way",
        marketName: "Mac Sonucu",
        selectionKey: "home",
        selectionName: "Galatasaray",
        price: 2.1,
      },
      {
        eventId: "demo-1",
        bookmakerKey: "nesine",
        bookmakerName: "Nesine (DEMO)",
        homeTeam: "Galatasaray",
        awayTeam: "Fenerbahce",
        commenceTime: tomorrow,
        phase: "prematch",
        marketKey: "match_winner_3way",
        marketName: "Mac Sonucu",
        selectionKey: "home",
        selectionName: "Galatasaray",
        price: 2.13,
      },
      {
        eventId: "demo-1",
        bookmakerKey: "bilyoner",
        bookmakerName: "Bilyoner (DEMO)",
        homeTeam: "Galatasaray",
        awayTeam: "Fenerbahce",
        commenceTime: tomorrow,
        phase: "prematch",
        marketKey: "match_winner_3way",
        marketName: "Mac Sonucu",
        selectionKey: "home",
        selectionName: "Galatasaray",
        price: 2.26,
      },
      {
        eventId: "demo-1",
        bookmakerKey: "betfair",
        bookmakerName: "Betfair (DEMO)",
        homeTeam: "Galatasaray",
        awayTeam: "Fenerbahce",
        commenceTime: tomorrow,
        phase: "prematch",
        marketKey: "total_goals",
        marketName: "Toplam Gol",
        selectionKey: "over",
        selectionName: "2.5 Ust",
        line: 2.5,
        price: 1.92,
      },
      {
        eventId: "demo-1",
        bookmakerKey: "misli",
        bookmakerName: "Misli (DEMO)",
        homeTeam: "Galatasaray",
        awayTeam: "Fenerbahce",
        commenceTime: tomorrow,
        phase: "prematch",
        marketKey: "total_goals",
        marketName: "Toplam Gol",
        selectionKey: "over",
        selectionName: "2.5 Ust",
        line: 2.5,
        price: 1.95,
      },
      {
        eventId: "demo-2",
        bookmakerKey: "bet365",
        bookmakerName: "bet365 (DEMO)",
        homeTeam: "Liverpool",
        awayTeam: "Arsenal",
        commenceTime: liveStart,
        phase: "live",
        marketKey: "both_teams_to_score",
        marketName: "Karsilikli Gol",
        selectionKey: "yes",
        selectionName: "Evet",
        price: 1.8,
      },
      {
        eventId: "demo-2",
        bookmakerKey: "pinnacle",
        bookmakerName: "Pinnacle (DEMO)",
        homeTeam: "Liverpool",
        awayTeam: "Arsenal",
        commenceTime: liveStart,
        phase: "live",
        marketKey: "both_teams_to_score",
        marketName: "Karsilikli Gol",
        selectionKey: "yes",
        selectionName: "Evet",
        price: 1.83,
      },
    ];

    return inputs.map((input) => ({
      provider: this.name,
      bookmakerKey: input.bookmakerKey,
      bookmakerName: input.bookmakerName,
      sourceEventId: input.eventId,
      sportKey: "soccer_demo",
      leagueName: "Demo Ligi",
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      commenceTime: input.commenceTime,
      phase: input.phase,
      marketKey: input.marketKey,
      marketName: input.marketName,
      period: input.period ?? "full_time",
      selectionKey: input.selectionKey,
      selectionName: input.selectionName,
      line: input.line ?? null,
      price: input.price,
      updatedAt,
      sourceUrl: "https://example.invalid/demo",
    }));
  }
}
