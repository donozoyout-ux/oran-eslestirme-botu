import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_SCOPE, isLeagueInScope, isLeagueLabelInScope, leagueScopeLabel } from "../src/league-scope.js";

describe("tracked league scope", () => {
  it("Big Five ust ligleri ile English Championship'i kabul eder", () => {
    const accepted = [
      ["England", "Premier League"],
      ["England", "Championship"],
      ["Spain", "La Liga"],
      ["Germany", "Bundesliga"],
      ["Italy", "Serie A"],
      ["France", "Ligue 1"],
    ] as const;

    for (const [country, league] of accepted) {
      expect(isLeagueLabelInScope(country, league, DEFAULT_LEAGUE_SCOPE)).toBe(true);
    }

    expect(isLeagueLabelInScope("Turkey", "Super Lig", DEFAULT_LEAGUE_SCOPE)).toBe(false);
    expect(isLeagueLabelInScope("England", "League One", DEFAULT_LEAGUE_SCOPE)).toBe(false);
    expect(isLeagueLabelInScope("Netherlands", "Eredivisie", DEFAULT_LEAGUE_SCOPE)).toBe(false);
    expect(isLeagueLabelInScope("World", "UEFA Champions League", DEFAULT_LEAGUE_SCOPE)).toBe(false);
  });

  it("BetExplorer URL'lerinde de ayni 6 ligi uygular", () => {
    expect(isLeagueInScope("https://www.betexplorer.com/football/england/premier-league/", DEFAULT_LEAGUE_SCOPE)).toBe(true);
    expect(isLeagueInScope("https://www.betexplorer.com/football/england/championship/", DEFAULT_LEAGUE_SCOPE)).toBe(true);
    expect(isLeagueInScope("https://www.betexplorer.com/football/spain/la-liga/", DEFAULT_LEAGUE_SCOPE)).toBe(true);
    expect(isLeagueInScope("https://www.betexplorer.com/football/germany/bundesliga/", DEFAULT_LEAGUE_SCOPE)).toBe(true);
    expect(isLeagueInScope("https://www.betexplorer.com/football/italy/serie-a/", DEFAULT_LEAGUE_SCOPE)).toBe(true);
    expect(isLeagueInScope("https://www.betexplorer.com/football/france/ligue-1/", DEFAULT_LEAGUE_SCOPE)).toBe(true);
    expect(isLeagueInScope("https://www.betexplorer.com/football/england/league-one/", DEFAULT_LEAGUE_SCOPE)).toBe(false);
  });

  it("arayuz etiketinde 6 ligi acikca gosterir", () => {
    expect(leagueScopeLabel(DEFAULT_LEAGUE_SCOPE)).toBe("Premier League + Championship + La Liga + Bundesliga + Serie A + Ligue 1");
  });
});
