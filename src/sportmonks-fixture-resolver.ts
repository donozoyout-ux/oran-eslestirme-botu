import type { MatchFixture } from "./domain.js";
import { CanonicalMatchResolver } from "./canonical-match-resolver.js";

interface Envelope { data?: unknown[]; pagination?: { has_more?: boolean; current_page?: number; next_page?: string | null } }
interface CandidateFixture {
  id?: number;
  starting_at?: string;
  starting_at_timestamp?: number;
  participants?: Array<{ id?: number; name?: string; meta?: { location?: string } }>;
  league?: { id?: number; name?: string };
}

export type SportmonksFixtureResolutionStatus = "resolved" | "not_found" | "ambiguous";
export interface SportmonksFixtureResolution {
  status: SportmonksFixtureResolutionStatus;
  sportmonksFixtureId?: string;
  confidence: number;
  kickoffDifferenceMinutes?: number;
  matchedBy?: string;
  error?: string;
}

function kickoffIso(row: CandidateFixture): string | null {
  if (typeof row.starting_at_timestamp === "number" && Number.isFinite(row.starting_at_timestamp)) {
    return new Date(row.starting_at_timestamp * 1000).toISOString();
  }
  const raw = row.starting_at?.trim();
  if (!raw) return null;
  const parsed = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : raw.replace(" ", "T") + "+03:00");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function teamNames(row: CandidateFixture): { home?: string; away?: string } {
  const participants = row.participants ?? [];
  const home = participants.find((item) => String(item.meta?.location ?? "").toLowerCase() === "home") ?? participants[0];
  const away = participants.find((item) => String(item.meta?.location ?? "").toLowerCase() === "away")
    ?? participants.find((item) => item.id !== home?.id);
  return { home: home?.name, away: away?.name };
}

export class SportmonksFixtureResolver {
  private readonly normalizer = new CanonicalMatchResolver({ kickoffToleranceMinutes: 60 });
  private readonly dateCache = new Map<string, { expiresAt: number; fixtures: CandidateFixture[] }>();

  constructor(private readonly options: {
    apiToken: string;
    toleranceMinutes: number;
    baseUrl?: string;
    requestTimeoutMs?: number;
  }) {}

  async resolve(target: MatchFixture & { canonicalEventId: string }, signal?: AbortSignal): Promise<SportmonksFixtureResolution> {
    if (target.provider === "sportmonks" && target.sourceEventId.trim()) {
      return { status: "resolved", sportmonksFixtureId: target.sourceEventId, confidence: 100, kickoffDifferenceMinutes: 0, matchedBy: "native_sportmonks_id" };
    }

    const targetKickoff = Date.parse(target.commenceTime);
    if (!Number.isFinite(targetKickoff)) return { status: "not_found", confidence: 0, error: "invalid_target_kickoff" };

    const dates = [0, -1, 1].map((offset) => new Date(targetKickoff + offset * 86_400_000).toISOString().slice(0, 10));
    const home = this.normalizer.normalizeTeam(target.homeTeam);
    const away = this.normalizer.normalizeTeam(target.awayTeam);
    const league = this.normalizer.normalizeLeague(target.leagueName);
    const toleranceMs = Math.max(1, this.options.toleranceMinutes) * 60_000;
    const candidates: CandidateFixture[] = [];
    let matches: Array<{ id: string; differenceMinutes: number; confidence: number; leagueMatched: boolean }> = [];

    try {
      for (const date of dates) {
        candidates.push(...await this.fetchDate(date, signal));
        matches = candidates.flatMap((row) => {
      const id = row.id;
      const kickoff = kickoffIso(row);
      const teams = teamNames(row);
      if (!id || !kickoff || !teams.home || !teams.away) return [];
      if (this.normalizer.normalizeTeam(teams.home) !== home || this.normalizer.normalizeTeam(teams.away) !== away) return [];
      const kickoffMs = Date.parse(kickoff);
      const difference = Math.abs(kickoffMs - targetKickoff);
      if (!Number.isFinite(kickoffMs) || difference > toleranceMs) return [];
      const candidateLeague = this.normalizer.normalizeLeague(row.league?.name ?? "");
      const leagueMatched = Boolean(league && candidateLeague && league === candidateLeague);
      const differenceMinutes = difference / 60_000;
      const confidence = Math.max(50, Math.round(100 - (differenceMinutes / Math.max(1, this.options.toleranceMinutes)) * 35 - (leagueMatched ? 0 : 10)));
      return [{ id: String(id), differenceMinutes, confidence, leagueMatched }];
        }).sort((a, b) => Number(b.leagueMatched) - Number(a.leagueMatched) || a.differenceMinutes - b.differenceMinutes || b.confidence - a.confidence || a.id.localeCompare(b.id));
        if (matches.length > 0) break;
      }
    } catch (error) {
      return { status: "not_found", confidence: 0, error: error instanceof Error ? error.message : String(error) };
    }

    if (!matches.length) return { status: "not_found", confidence: 0 };
    const best = matches[0]!;
    const second = matches[1];
    if (second && second.leagueMatched === best.leagueMatched && Math.abs(second.differenceMinutes - best.differenceMinutes) < 2) {
      return { status: "ambiguous", confidence: best.confidence };
    }
    return { status: "resolved", sportmonksFixtureId: best.id, confidence: best.confidence, kickoffDifferenceMinutes: best.differenceMinutes, matchedBy: best.leagueMatched ? "teams_league_kickoff" : "teams_kickoff" };
  }

  private async fetchDate(date: string, parentSignal?: AbortSignal): Promise<CandidateFixture[]> {
    const cached = this.dateCache.get(date);
    if (cached && cached.expiresAt > Date.now()) return [...cached.fixtures];

    const fixtures: CandidateFixture[] = [];
    for (let page = 1; page <= 8; page += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 12_000);
      const abort = () => controller.abort();
      parentSignal?.addEventListener("abort", abort, { once: true });
      try {
        const url = new URL(`${this.options.baseUrl ?? "https://api.sportmonks.com/v3/football"}/fixtures/date/${encodeURIComponent(date)}`);
        url.searchParams.set("include", "participants;league");
        url.searchParams.set("per_page", "50");
        url.searchParams.set("page", String(page));
        const response = await fetch(url, {
          headers: { Authorization: this.options.apiToken, Accept: "application/json" },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`SportMonks fixture resolver ${response.status}: ${text.slice(0, 240)}`);
        const parsed = JSON.parse(text) as Envelope;
        if (Array.isArray(parsed.data)) fixtures.push(...parsed.data as CandidateFixture[]);
        if (!parsed.pagination?.has_more) break;
      } finally {
        clearTimeout(timeout);
        parentSignal?.removeEventListener("abort", abort);
      }
    }

    this.dateCache.set(date, { expiresAt: Date.now() + 15 * 60_000, fixtures: [...fixtures] });
    return fixtures;
  }
}
