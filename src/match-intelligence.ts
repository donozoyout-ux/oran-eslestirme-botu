import type { MatchFixture } from "./domain.js";

export type DataAvailability = "available" | "partial" | "unavailable" | "conflict";
export type DataFreshness = "fresh" | "stale" | "unknown";
export type MatchIntelligenceCapability = "available" | "unavailable";

export interface IntelligenceFeature<T> {
  value: T | null;
  sampleSize: number;
  source: string;
  freshness: DataFreshness;
  availability: DataAvailability;
}

export interface TeamMatchObservation {
  sourceEventId: string;
  canonicalEventId?: string;
  leagueId?: string;
  leagueName: string;
  seasonId?: string;
  kickoff: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  reportedHomeScore?: number;
  reportedAwayScore?: number;
  events?: Array<{ teamId: string; minute: number; type: "goal"; observedAt: string }>;
  statistics?: Array<{
    teamId: string;
    observedAt: string;
    xg?: number;
    shots?: number;
    shotsOnTarget?: number;
    bigChances?: number;
    possession?: number;
    corners?: number;
    cards?: number;
    attacks?: number;
    dangerousAttacks?: number;
  }>;
}

export interface TeamFormSnapshot {
  window: 5 | 10;
  matches: IntelligenceFeature<number>;
  wins: IntelligenceFeature<number>;
  draws: IntelligenceFeature<number>;
  losses: IntelligenceFeature<number>;
  pointsPerGame: IntelligenceFeature<number>;
  goalsScoredPerGame: IntelligenceFeature<number>;
  goalsConcededPerGame: IntelligenceFeature<number>;
  goalDifferencePerGame: IntelligenceFeature<number>;
  cleanSheetRate: IntelligenceFeature<number>;
  failedToScoreRate: IntelligenceFeature<number>;
  bttsRate: IntelligenceFeature<number>;
  over15Rate: IntelligenceFeature<number>;
  over25Rate: IntelligenceFeature<number>;
  over35Rate: IntelligenceFeature<number>;
}

export interface TeamGoalProfile {
  last5: TeamFormSnapshot;
  last10: TeamFormSnapshot;
}

export interface TeamVenueProfile {
  venue: "home" | "away";
  pointsPerGame: IntelligenceFeature<number>;
  goalsForPerGame: IntelligenceFeature<number>;
  goalsAgainstPerGame: IntelligenceFeature<number>;
  bttsRate: IntelligenceFeature<number>;
  over25Rate: IntelligenceFeature<number>;
}

export type GoalTimingBucket = "0-15" | "16-30" | "31-45+" | "46-60" | "61-75" | "76-90+";
export interface TeamTimingProfile {
  goalsScoredByBucket: IntelligenceFeature<Record<GoalTimingBucket, number>>;
  goalsConcededByBucket: IntelligenceFeature<Record<GoalTimingBucket, number>>;
  firstHalfGoalRate: IntelligenceFeature<number>;
  secondHalfGoalRate: IntelligenceFeature<number>;
  lateGoalTendency: IntelligenceFeature<number>;
}

export interface TeamStatWindow {
  xg: IntelligenceFeature<number>;
  xga: IntelligenceFeature<number>;
  shots: IntelligenceFeature<number>;
  shotsOnTarget: IntelligenceFeature<number>;
  bigChances: IntelligenceFeature<number>;
  possession: IntelligenceFeature<number>;
  corners: IntelligenceFeature<number>;
  cards: IntelligenceFeature<number>;
  attacks: IntelligenceFeature<number>;
  dangerousAttacks: IntelligenceFeature<number>;
}
export interface TeamStatProfile { last5: TeamStatWindow; last10: TeamStatWindow }

export interface TeamIntelligenceProfile {
  teamId: string;
  team: string;
  form: TeamGoalProfile;
  venue: TeamVenueProfile;
  timing: TeamTimingProfile;
  stats: TeamStatProfile;
}

export interface MatchIntelligenceConfidence {
  score: number;
  availability: DataAvailability;
  factors: {
    recentSample: number;
    venueSample: number;
    statsCompleteness: number;
    freshness: number;
    capabilities: number;
    xg: number;
    lineup: number;
    conflicts: number;
  };
  note: "Data confidence; outcome probability degildir.";
}

export interface MatchIntelligenceResult {
  canonicalEventId: string;
  sourceEventId: string;
  provider: "sportmonks";
  sources: string[];
  dataVersion: 1;
  generatedAt: string;
  targetKickoff: string;
  home: TeamIntelligenceProfile;
  away: TeamIntelligenceProfile;
  strengths: {
    leagueGoalsPerTeamGame: IntelligenceFeature<number>;
    homeAttackStrength: IntelligenceFeature<number>;
    homeDefenseStrength: IntelligenceFeature<number>;
    awayAttackStrength: IntelligenceFeature<number>;
    awayDefenseStrength: IntelligenceFeature<number>;
  };
  goalEnvironment: { value: "very_low" | "low" | "neutral" | "high" | "very_high"; reasons: string[] };
  teamStrengthEnvironment: "home_edge" | "away_edge" | "balanced";
  confidence: MatchIntelligenceConfidence;
  capabilityMap: Record<"fixtures" | "teamStats" | "fixtureStats" | "events" | "lineups" | "injuries" | "xg", MatchIntelligenceCapability>;
  dataAvailability: DataAvailability;
  conflicts: string[];
}

export interface MatchIntelligenceInput {
  target: MatchFixture & { canonicalEventId: string };
  homeTeamId: string;
  awayTeamId: string;
  targetLeagueId?: string;
  targetSeasonId?: string;
  observations: TeamMatchObservation[];
  capabilityMap: MatchIntelligenceResult["capabilityMap"];
  sources?: string[];
  generatedAt?: Date;
}

const BUCKETS: GoalTimingBucket[] = ["0-15", "16-30", "31-45+", "46-60", "61-75", "76-90+"];
const round = (value: number): number => Math.round(value * 100) / 100;

function freshness(samples: TeamMatchObservation[], cutoff: number): DataFreshness {
  const latest = Math.max(...samples.map((sample) => Date.parse(sample.kickoff)).filter(Number.isFinite));
  if (!Number.isFinite(latest)) return "unknown";
  return cutoff - latest <= 45 * 86_400_000 ? "fresh" : "stale";
}

function feature<T>(value: T | null, samples: number, source: string, fresh: DataFreshness,
  availability: DataAvailability = samples > 0 ? "available" : "unavailable"): IntelligenceFeature<T> {
  return { value, sampleSize: samples, source, freshness: samples > 0 ? fresh : "unknown", availability };
}

function teamScore(match: TeamMatchObservation, teamId: string): { gf: number; ga: number; points: number; venue: "home" | "away" } {
  const home = match.homeTeamId === teamId;
  const gf = home ? match.homeScore : match.awayScore;
  const ga = home ? match.awayScore : match.homeScore;
  return { gf, ga, points: gf > ga ? 3 : gf === ga ? 1 : 0, venue: home ? "home" : "away" };
}

function form(matches: TeamMatchObservation[], teamId: string, window: 5 | 10, cutoff: number): TeamFormSnapshot {
  const selected = matches.slice(0, window);
  const fresh = freshness(selected, cutoff);
  const scores = selected.map((match) => teamScore(match, teamId));
  const n = scores.length;
  const rate = (predicate: (row: typeof scores[number]) => boolean): number | null => n ? round(100 * scores.filter(predicate).length / n) : null;
  const avg = (selector: (row: typeof scores[number]) => number): number | null => n ? round(scores.reduce((sum, row) => sum + selector(row), 0) / n) : null;
  return {
    window,
    matches: feature(n || null, n, "sportmonks:fixtures", fresh),
    wins: feature(n ? scores.filter((r) => r.points === 3).length : null, n, "sportmonks:fixtures", fresh),
    draws: feature(n ? scores.filter((r) => r.points === 1).length : null, n, "sportmonks:fixtures", fresh),
    losses: feature(n ? scores.filter((r) => r.points === 0).length : null, n, "sportmonks:fixtures", fresh),
    pointsPerGame: feature(avg((r) => r.points), n, "sportmonks:fixtures", fresh),
    goalsScoredPerGame: feature(avg((r) => r.gf), n, "sportmonks:fixtures", fresh),
    goalsConcededPerGame: feature(avg((r) => r.ga), n, "sportmonks:fixtures", fresh),
    goalDifferencePerGame: feature(avg((r) => r.gf - r.ga), n, "sportmonks:fixtures", fresh),
    cleanSheetRate: feature(rate((r) => r.ga === 0), n, "sportmonks:fixtures", fresh),
    failedToScoreRate: feature(rate((r) => r.gf === 0), n, "sportmonks:fixtures", fresh),
    bttsRate: feature(rate((r) => r.gf > 0 && r.ga > 0), n, "sportmonks:fixtures", fresh),
    over15Rate: feature(rate((r) => r.gf + r.ga > 1.5), n, "sportmonks:fixtures", fresh),
    over25Rate: feature(rate((r) => r.gf + r.ga > 2.5), n, "sportmonks:fixtures", fresh),
    over35Rate: feature(rate((r) => r.gf + r.ga > 3.5), n, "sportmonks:fixtures", fresh),
  };
}

function venue(matches: TeamMatchObservation[], teamId: string, side: "home" | "away", cutoff: number): TeamVenueProfile {
  const selected = matches.filter((match) => teamScore(match, teamId).venue === side).slice(0, 10);
  const scores = selected.map((match) => teamScore(match, teamId));
  const n = scores.length;
  const fresh = freshness(selected, cutoff);
  const avg = (selector: (row: typeof scores[number]) => number) => n ? round(scores.reduce((sum, row) => sum + selector(row), 0) / n) : null;
  const rate = (predicate: (row: typeof scores[number]) => boolean) => n ? round(100 * scores.filter(predicate).length / n) : null;
  return { venue: side,
    pointsPerGame: feature(avg((r) => r.points), n, "sportmonks:fixtures", fresh),
    goalsForPerGame: feature(avg((r) => r.gf), n, "sportmonks:fixtures", fresh),
    goalsAgainstPerGame: feature(avg((r) => r.ga), n, "sportmonks:fixtures", fresh),
    bttsRate: feature(rate((r) => r.gf > 0 && r.ga > 0), n, "sportmonks:fixtures", fresh),
    over25Rate: feature(rate((r) => r.gf + r.ga > 2.5), n, "sportmonks:fixtures", fresh) };
}

function bucket(minute: number): GoalTimingBucket {
  if (minute <= 15) return "0-15";
  if (minute <= 30) return "16-30";
  if (minute <= 45) return "31-45+";
  if (minute <= 60) return "46-60";
  if (minute <= 75) return "61-75";
  return "76-90+";
}

function timing(matches: TeamMatchObservation[], teamId: string, cutoff: number): TeamTimingProfile {
  const relevant = matches.slice(0, 10);
  const events = relevant.flatMap((match) => (match.events ?? [])
    .filter((event) => event.type === "goal" && event.minute >= 0 && event.minute <= 130 && Date.parse(event.observedAt) < cutoff)
    .map((event) => ({ ...event, match })));
  const scored = Object.fromEntries(BUCKETS.map((key) => [key, 0])) as Record<GoalTimingBucket, number>;
  const conceded = Object.fromEntries(BUCKETS.map((key) => [key, 0])) as Record<GoalTimingBucket, number>;
  for (const event of events) {
    if (event.teamId === teamId) scored[bucket(event.minute)] += 1;
    else if (event.match.homeTeamId === teamId || event.match.awayTeamId === teamId) conceded[bucket(event.minute)] += 1;
  }
  const matchesWithEvents = new Set(events.map((event) => event.match.sourceEventId)).size;
  const teamGoals = events.filter((event) => event.teamId === teamId);
  const rate = (predicate: (minute: number) => boolean) => matchesWithEvents
    ? round(100 * new Set(teamGoals.filter((event) => predicate(event.minute)).map((event) => event.match.sourceEventId)).size / matchesWithEvents)
    : null;
  const fresh = freshness(relevant.filter((match) => match.events?.length), cutoff);
  return {
    goalsScoredByBucket: feature(matchesWithEvents ? scored : null, matchesWithEvents, "sportmonks:events", fresh),
    goalsConcededByBucket: feature(matchesWithEvents ? conceded : null, matchesWithEvents, "sportmonks:events", fresh),
    firstHalfGoalRate: feature(rate((minute) => minute <= 45), matchesWithEvents, "sportmonks:events", fresh),
    secondHalfGoalRate: feature(rate((minute) => minute > 45), matchesWithEvents, "sportmonks:events", fresh),
    lateGoalTendency: feature(rate((minute) => minute > 75), matchesWithEvents, "sportmonks:events", fresh),
  };
}

type StatKey = "xg" | "shots" | "shotsOnTarget" | "bigChances" | "possession" | "corners" | "cards" | "attacks" | "dangerousAttacks";
function statWindow(matches: TeamMatchObservation[], teamId: string, window: 5 | 10, cutoff: number): TeamStatWindow {
  const selected = matches.slice(0, window);
  const own = selected.flatMap((match) => (match.statistics ?? []).filter((row) => row.teamId === teamId && Date.parse(row.observedAt) < cutoff));
  const opponent = selected.flatMap((match) => (match.statistics ?? []).filter((row) => row.teamId !== teamId && Date.parse(row.observedAt) < cutoff));
  const valid = (key: StatKey, value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value)
    && value >= 0 && (key !== "possession" || value <= 100);
  const metric = (key: StatKey, rows = own): IntelligenceFeature<number> => {
    const values = rows.map((row) => row[key]).filter((value): value is number => valid(key, value));
    return feature(values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      values.length, "sportmonks:fixture-statistics", freshness(selected, cutoff));
  };
  return { xg: metric("xg"), xga: metric("xg", opponent), shots: metric("shots"), shotsOnTarget: metric("shotsOnTarget"),
    bigChances: metric("bigChances"), possession: metric("possession"), corners: metric("corners"), cards: metric("cards"),
    attacks: metric("attacks"), dangerousAttacks: metric("dangerousAttacks") };
}

function unavailableStrength(source: string): IntelligenceFeature<number> { return feature<number>(null, 0, source, "unknown"); }

export class MatchIntelligenceEngine {
  constructor(private readonly minSample = 5) {}

  analyze(input: MatchIntelligenceInput): MatchIntelligenceResult {
    const cutoff = Date.parse(input.target.commenceTime);
    const conflicts: string[] = [];
    const valid = input.observations.filter((row) => {
      if (row.sourceEventId === input.target.sourceEventId || row.canonicalEventId === input.target.canonicalEventId) return false;
      if (!Number.isFinite(Date.parse(row.kickoff)) || Date.parse(row.kickoff) >= cutoff) return false;
      if (![row.homeScore, row.awayScore].every((score) => Number.isInteger(score) && score >= 0 && score <= 30)) {
        conflicts.push(`invalid_score:${row.sourceEventId}`); return false;
      }
      if (row.reportedHomeScore !== undefined && (row.reportedHomeScore !== row.homeScore || row.reportedAwayScore !== row.awayScore)) {
        conflicts.push(`score_conflict:${row.sourceEventId}`); return false;
      }
      return true;
    }).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
    const teamMatches = (teamId: string) => valid.filter((row) => row.homeTeamId === teamId || row.awayTeamId === teamId);
    const homeMatches = teamMatches(input.homeTeamId);
    const awayMatches = teamMatches(input.awayTeamId);
    const profile = (teamId: string, name: string, side: "home" | "away", matches: TeamMatchObservation[]): TeamIntelligenceProfile => ({
      teamId, team: name,
      form: { last5: form(matches, teamId, 5, cutoff), last10: form(matches, teamId, 10, cutoff) },
      venue: venue(matches, teamId, side, cutoff), timing: timing(matches, teamId, cutoff),
      stats: { last5: statWindow(matches, teamId, 5, cutoff), last10: statWindow(matches, teamId, 10, cutoff) },
    });
    const home = profile(input.homeTeamId, input.target.homeTeam, "home", homeMatches);
    const away = profile(input.awayTeamId, input.target.awayTeam, "away", awayMatches);

    const targetSeasonId = input.targetSeasonId ?? homeMatches.find((row) => row.seasonId)?.seasonId;
    const league = valid.filter((row) => row.leagueName === input.target.leagueName
      && (!input.targetLeagueId || row.leagueId === input.targetLeagueId)
      && (!targetSeasonId || row.seasonId === targetSeasonId));
    const baselineValue = league.length >= this.minSample
      ? round(league.reduce((sum, row) => sum + row.homeScore + row.awayScore, 0) / (league.length * 2)) : null;
    const baseline = baselineValue === null ? unavailableStrength("sportmonks:league-fixtures")
      : feature(baselineValue, league.length, "sportmonks:league-fixtures", freshness(league, cutoff));
    const strength = (value: number | null, defensive = false): IntelligenceFeature<number> => baselineValue && value !== null
      ? feature(round(value / baselineValue), Math.min(league.length, 10), "sportmonks:league-baseline", baseline.freshness)
      : unavailableStrength("sportmonks:league-baseline");
    const strengths = {
      leagueGoalsPerTeamGame: baseline,
      homeAttackStrength: strength(home.venue.goalsForPerGame.value),
      homeDefenseStrength: strength(home.venue.goalsAgainstPerGame.value, true),
      awayAttackStrength: strength(away.venue.goalsForPerGame.value),
      awayDefenseStrength: strength(away.venue.goalsAgainstPerGame.value, true),
    };

    const goalSignals = [home.form.last10.over25Rate.value, away.form.last10.over25Rate.value,
      home.venue.goalsForPerGame.value === null ? null : home.venue.goalsForPerGame.value * 25,
      away.venue.goalsAgainstPerGame.value === null ? null : away.venue.goalsAgainstPerGame.value * 25,
      home.stats.last10.xg.value === null ? null : home.stats.last10.xg.value * 25,
      away.stats.last10.xga.value === null ? null : away.stats.last10.xga.value * 25].filter((v): v is number => v !== null);
    const goalScore = goalSignals.length ? goalSignals.reduce((a, b) => a + b, 0) / goalSignals.length : 50;
    const goalValue = goalScore < 30 ? "very_low" : goalScore < 43 ? "low" : goalScore < 58 ? "neutral" : goalScore < 72 ? "high" : "very_high";
    const reasons = [
      home.form.last10.over25Rate.value === null ? null : `${home.team} last10 over2.5 = ${home.form.last10.over25Rate.value}%`,
      away.form.last10.bttsRate.value === null ? null : `${away.team} last10 BTTS = ${away.form.last10.bttsRate.value}%`,
      home.venue.goalsForPerGame.value === null ? null : `${home.team} home GF = ${home.venue.goalsForPerGame.value}`,
      away.venue.goalsAgainstPerGame.value === null ? null : `${away.team} away GA = ${away.venue.goalsAgainstPerGame.value}`,
    ].filter((v): v is string => v !== null);
    const homeEdge = (home.venue.pointsPerGame.value ?? home.form.last10.pointsPerGame.value ?? 0)
      + (strengths.homeAttackStrength.value ?? 1);
    const awayEdge = (away.venue.pointsPerGame.value ?? away.form.last10.pointsPerGame.value ?? 0)
      + (strengths.awayAttackStrength.value ?? 1);
    const teamStrengthEnvironment = Math.abs(homeEdge - awayEdge) < 0.35 ? "balanced" : homeEdge > awayEdge ? "home_edge" : "away_edge";

    const recentSample = Math.min(100, Math.min(homeMatches.length, awayMatches.length) / Math.max(1, this.minSample) * 100);
    const venueSample = Math.min(100, Math.min(home.venue.pointsPerGame.sampleSize, away.venue.pointsPerGame.sampleSize) / Math.max(1, this.minSample) * 100);
    const statFeatures = [home.stats.last10.shots, home.stats.last10.xg, away.stats.last10.shots, away.stats.last10.xg];
    const statsCompleteness = 100 * statFeatures.filter((item) => item.availability === "available").length / statFeatures.length;
    const capabilityValues = Object.values(input.capabilityMap);
    const capabilities = 100 * capabilityValues.filter((value) => value === "available").length / capabilityValues.length;
    const fresh = [home.form.last10.matches.freshness, away.form.last10.matches.freshness].filter((v) => v === "fresh").length * 50;
    const factors = { recentSample: round(recentSample), venueSample: round(venueSample), statsCompleteness: round(statsCompleteness),
      freshness: fresh, capabilities: round(capabilities), xg: input.capabilityMap.xg === "available" ? 100 : 0,
      lineup: input.capabilityMap.lineups === "available" ? 100 : 0, conflicts: conflicts.length ? 0 : 100 };
    const confidenceScore = Math.round(factors.recentSample * .25 + factors.venueSample * .15 + factors.statsCompleteness * .15
      + factors.freshness * .15 + factors.capabilities * .1 + factors.xg * .08 + factors.lineup * .02 + factors.conflicts * .1);
    const dataAvailability: DataAvailability = conflicts.length ? "conflict" : Math.min(homeMatches.length, awayMatches.length) >= this.minSample
      ? "available" : valid.length ? "partial" : "unavailable";
    return {
      canonicalEventId: input.target.canonicalEventId, sourceEventId: input.target.sourceEventId, provider: "sportmonks",
      sources: input.sources?.length ? [...new Set(input.sources)] : ["sportmonks"],
      dataVersion: 1, generatedAt: (input.generatedAt ?? new Date()).toISOString(), targetKickoff: input.target.commenceTime,
      home, away, strengths, goalEnvironment: { value: goalValue, reasons }, teamStrengthEnvironment,
      confidence: { score: confidenceScore, availability: dataAvailability, factors, note: "Data confidence; outcome probability degildir." },
      capabilityMap: input.capabilityMap, dataAvailability, conflicts,
    };
  }
}
