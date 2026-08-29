export const DEFAULT_LEAGUE_SCOPE = "turkey_europe_top10_big5_tier3" as const;

export type LeagueScope = typeof DEFAULT_LEAGUE_SCOPE | "all";

const TOP_FLIGHT_LEAGUES: Readonly<Record<string, readonly string[]>> = {
  // Türkiye + Avrupa'da bahis hacmi yüksek 10 ülkenin en üst ligleri.
  turkey: ["super-lig"],
  england: ["premier-league"],
  spain: ["la-liga"],
  germany: ["bundesliga"],
  italy: ["serie-a"],
  france: ["ligue-1"],
  netherlands: ["eredivisie"],
  portugal: ["liga-portugal", "primeira-liga"],
  belgium: ["jupiler-pro-league", "pro-league"],
  scotland: ["premiership"],
  austria: ["bundesliga"],
};

const BIG_FIVE_SECOND_AND_THIRD_TIERS: Readonly<Record<string, readonly string[]>> = {
  england: ["championship", "league-one"],
  spain: [
    "la-liga-2",
    "laliga2",
    "segunda-division",
    "primera-rfef",
    "primera-rfef-group-1",
    "primera-rfef-group-2",
    "primera-division-rfef-group-1",
    "primera-division-rfef-group-2",
  ],
  germany: ["2-bundesliga", "3-liga"],
  italy: ["serie-b", "serie-c", "serie-c-group-a", "serie-c-group-b", "serie-c-group-c"],
  france: ["ligue-2", "national"],
};

function leaguePath(url: string): { country: string; competition: string } | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts[0] !== "football" || !parts[1] || !parts[2]) return null;
    return { country: parts[1].toLowerCase(), competition: parts[2].toLowerCase() };
  } catch {
    return null;
  }
}

export function isLeagueInScope(url: string, scope: LeagueScope): boolean {
  if (scope === "all") return true;
  const path = leaguePath(url);
  if (!path) return false;
  const topFlight = TOP_FLIGHT_LEAGUES[path.country] ?? [];
  const lowerBigFive = BIG_FIVE_SECOND_AND_THIRD_TIERS[path.country] ?? [];
  return topFlight.includes(path.competition) || lowerBigFive.includes(path.competition);
}

export function leagueScopeLabel(scope: LeagueScope): string {
  if (scope === "all") return "Tum ligler";
  return "Turkiye + Avrupa 10 + ilk 5 ulkenin 2. ve 3. ligleri";
}
