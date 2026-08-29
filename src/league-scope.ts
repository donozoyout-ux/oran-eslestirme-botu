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

const CONTINENTAL_LEAGUES = new Set([
  "uefa-champions-league",
  "uefa-europa-league",
  "uefa-conference-league",
]);

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function countryKey(value: string): string {
  const normalized = slug(value);
  if (normalized === "turkiye" || normalized === "turkey") return "turkey";
  return normalized;
}

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

/** API tabanlı kaynaklarda URL yerine ülke + lig adı gelir. */
export function isLeagueLabelInScope(country: string | undefined, competition: string | undefined, scope: LeagueScope): boolean {
  if (scope === "all") return true;
  if (!competition) return false;
  const competitionSlug = slug(competition);
  if (CONTINENTAL_LEAGUES.has(competitionSlug)) return true;
  const countrySlug = countryKey(country ?? "");
  const topFlight = TOP_FLIGHT_LEAGUES[countrySlug] ?? [];
  const lowerBigFive = BIG_FIVE_SECOND_AND_THIRD_TIERS[countrySlug] ?? [];
  return topFlight.includes(competitionSlug) || lowerBigFive.includes(competitionSlug);
}

export function leagueScopeLabel(scope: LeagueScope): string {
  if (scope === "all") return "Tum ligler";
  return "Turkiye + Avrupa 10 + ilk 5 ulkenin 2. ve 3. ligleri";
}
