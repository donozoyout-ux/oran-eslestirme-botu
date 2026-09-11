import { createHash } from "node:crypto";
import type { MatchFixture, OddsQuote } from "./domain.js";

export interface CanonicalMatchResolverOptions {
  kickoffToleranceMinutes?: number;
  teamAliases?: Record<string, string>;
  leagueAliases?: Record<string, string>;
}

interface MatchDescriptor {
  provider: string;
  sourceEventId: string;
  canonicalEventId?: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}

interface CanonicalRecord {
  id: string;
  league: string;
  home: string;
  away: string;
  kickoffMs: number;
}

const DEFAULT_TEAM_ALIASES: Record<string, string> = {
  "man utd": "manchester united",
  "man united": "manchester united",
  "manchester utd": "manchester united",
  "man city": "manchester city",
  "inter milan": "inter",
  "internazionale": "inter",
  "psg": "paris saint germain",
  "bayern munich": "bayern munchen",
  "besiktas jk": "besiktas",
  "blackburn rovers": "blackburn",
  "sheffield utd": "sheffield united",
  "cardiff city": "cardiff",
  "stoke city": "stoke",
  "swansea city": "swansea",
  "preston north end": "preston",
  "bolton wanderers": "bolton",
  "west ham united": "west ham",
};

const DEFAULT_LEAGUE_ALIASES: Record<string, string> = {
  epl: "premier league",
  "england premier league": "premier league",
  "english premier league": "premier league",
  ucl: "uefa champions league",
  "champions league": "uefa champions league",
  "uefa europa conference league": "uefa conference league",
  "europa conference league": "uefa conference league",
  "conference league": "uefa conference league",
  "turkey super lig": "super lig",
  "turkiye super lig": "super lig",
  laliga: "la liga",
};

const LEAGUE_COUNTRY_PREFIX = /^(?:england|english|spain|spanish|germany|german|italy|italian|france|french|netherlands|dutch|portugal|portuguese|turkey|turkiye|turkish|belgium|belgian|scotland|scottish)\s+/;

function normalizedText(value: string): string {
  return value
    .replaceAll("ı", "i")
    .replaceAll("İ", "I")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function aliasMap(defaults: Record<string, string>, overrides: Record<string, string>): Map<string, string> {
  return new Map(
    Object.entries({ ...defaults, ...overrides }).map(([from, to]) => [normalizedText(from), normalizedText(to)]),
  );
}

export class CanonicalMatchResolver {
  private readonly toleranceMs: number;
  private readonly teamAliases: Map<string, string>;
  private readonly leagueAliases: Map<string, string>;
  private readonly records = new Map<string, CanonicalRecord>();
  private readonly providerEventBindings = new Map<string, string>();

  constructor(options: CanonicalMatchResolverOptions = {}) {
    this.toleranceMs = Math.max(0, options.kickoffToleranceMinutes ?? 10) * 60_000;
    this.teamAliases = aliasMap(DEFAULT_TEAM_ALIASES, options.teamAliases ?? {});
    this.leagueAliases = aliasMap(DEFAULT_LEAGUE_ALIASES, options.leagueAliases ?? {});
  }

  normalizeTeam(value: string): string {
    const normalized = normalizedText(value).replace(/\s+(football club|fc|cf|fk|sk|afc)$/g, "");
    return this.teamAliases.get(normalized) ?? normalized;
  }

  normalizeLeague(value: string): string {
    const normalized = normalizedText(value);
    const withoutCountry = normalized.replace(LEAGUE_COUNTRY_PREFIX, "");
    return this.leagueAliases.get(normalized)
      ?? this.leagueAliases.get(withoutCountry)
      ?? withoutCountry;
  }

  resolveQuotes(quotes: OddsQuote[]): OddsQuote[] {
    return this.resolveAll(quotes).map(({ value, canonicalEventId }) => ({ ...value, canonicalEventId }));
  }

  resolveFixtures(fixtures: MatchFixture[]): MatchFixture[] {
    return this.resolveAll(fixtures).map(({ value, canonicalEventId }) => ({ ...value, canonicalEventId }));
  }

  private resolveAll<T extends MatchDescriptor>(values: T[]): Array<{ value: T; canonicalEventId: string }> {
    const ordered = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => this.sortKey(a.value).localeCompare(this.sortKey(b.value)) || a.index - b.index);
    const resolved = new Map<number, string>();
    for (const item of ordered) resolved.set(item.index, this.resolveOne(item.value));
    return values.map((value, index) => ({ value, canonicalEventId: resolved.get(index)! }));
  }

  private resolveOne(value: MatchDescriptor): string {
    if (value.canonicalEventId) {
      this.bind(value, value.canonicalEventId);
      return value.canonicalEventId;
    }

    const providerRef = this.providerRef(value);
    const bound = providerRef ? this.providerEventBindings.get(providerRef) : undefined;
    if (bound) return bound;

    const home = this.normalizeTeam(value.homeTeam);
    const away = this.normalizeTeam(value.awayTeam);
    const league = this.normalizeLeague(value.leagueName);
    const kickoffMs = Date.parse(value.commenceTime);
    const candidates = [...this.records.values()]
      .filter((record) =>
        record.home === home &&
        record.away === away &&
        record.league === league &&
        Number.isFinite(kickoffMs) &&
        Math.abs(record.kickoffMs - kickoffMs) <= this.toleranceMs)
      .sort((a, b) => Math.abs(a.kickoffMs - kickoffMs) - Math.abs(b.kickoffMs - kickoffMs));

    const existing = candidates[0];
    if (existing) {
      this.bind(value, existing.id);
      return existing.id;
    }

    const date = Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString().slice(0, 10) : "invalid-date";
    const base = [home, away, league, date].join("|");
    let id = `match:${createHash("sha256").update(base).digest("hex").slice(0, 24)}`;
    const collision = this.records.get(id);
    if (collision && Math.abs(collision.kickoffMs - kickoffMs) > this.toleranceMs) {
      id = `match:${createHash("sha256").update(`${base}|${Math.round(kickoffMs / Math.max(this.toleranceMs, 60_000))}`).digest("hex").slice(0, 24)}`;
    }
    this.records.set(id, { id, home, away, league, kickoffMs });
    this.bind(value, id);
    return id;
  }

  private bind(value: MatchDescriptor, canonicalEventId: string): void {
    const providerRef = this.providerRef(value);
    if (providerRef) this.providerEventBindings.set(providerRef, canonicalEventId);
    if (this.records.has(canonicalEventId)) return;
    this.records.set(canonicalEventId, {
      id: canonicalEventId,
      home: this.normalizeTeam(value.homeTeam),
      away: this.normalizeTeam(value.awayTeam),
      league: this.normalizeLeague(value.leagueName),
      kickoffMs: Date.parse(value.commenceTime),
    });
  }

  private providerRef(value: MatchDescriptor): string | null {
    const id = value.sourceEventId.trim();
    return id ? `${normalizedText(value.provider)}:${id}` : null;
  }

  private sortKey(value: MatchDescriptor): string {
    return [
      this.normalizeTeam(value.homeTeam),
      this.normalizeTeam(value.awayTeam),
      this.normalizeLeague(value.leagueName),
      String(Date.parse(value.commenceTime)),
      this.providerRef(value) ?? "",
    ].join("|");
  }
}
