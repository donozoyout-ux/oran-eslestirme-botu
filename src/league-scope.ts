export const DEFAULT_LEAGUE_SCOPE = "europe_big5_topflight" as const;
export const LEGACY_LEAGUE_SCOPE = "turkey_europe_top10_big5_tier3" as const;

export type LeagueScope = typeof DEFAULT_LEAGUE_SCOPE | typeof LEGACY_LEAGUE_SCOPE | "all";

const BIG_FIVE_TOP_FLIGHT: Readonly<Record<string, readonly string[]>> = {
  england: ["premier-league"],
  spain: ["la-liga"],
  germany: ["bundesliga"],
  italy: ["serie-a"],
  france: ["ligue-1"],
};

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
  return slug(value);
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

/** BetExplorer/web kaynaklari icin sadece Avrupa'nin Big Five ust ligleri. */
export function isLeagueInScope(url: string, scope: LeagueScope): boolean {
  if (scope === "all") return true;
  const path = leaguePath(url);
  if (!path) return false;
  return (BIG_FIVE_TOP_FLIGHT[path.country] ?? []).includes(path.competition);
}

/** API tabanli kaynaklarda URL yerine ulke + lig adi gelir. */
export function isLeagueLabelInScope(
  country: string | undefined,
  competition: string | undefined,
  scope: LeagueScope,
): boolean {
  if (scope === "all") return true;
  if (!competition) return false;
  const countrySlug = countryKey(country ?? "");
  return (BIG_FIVE_TOP_FLIGHT[countrySlug] ?? []).includes(slug(competition));
}

export function leagueScopeLabel(scope: LeagueScope): string {
  if (scope === "all") return "Tum ligler";
  return "Premier League + La Liga + Bundesliga + Serie A + Ligue 1";
}
