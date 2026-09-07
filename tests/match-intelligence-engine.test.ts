import { describe, expect, it } from "vitest";
import type { MatchFixture } from "../src/domain.js";
import { MatchIntelligenceEngine, type MatchIntelligenceInput, type TeamMatchObservation } from "../src/match-intelligence.js";

const target: MatchFixture & { canonicalEventId: string } = {
  provider: "sportmonks", sourceEventId: "target", canonicalEventId: "canonical-target", leagueName: "Premier League",
  homeTeam: "Arsenal", awayTeam: "Brighton", commenceTime: "2026-09-20T18:00:00.000Z", phase: "prematch",
};
const capabilities: MatchIntelligenceInput["capabilityMap"] = {
  fixtures: "available", teamStats: "available", fixtureStats: "available", events: "available",
  lineups: "unavailable", injuries: "unavailable", xg: "available",
};

function match(id: string, daysAgo: number, homeId: string, awayId: string, homeScore: number, awayScore: number,
  withStats = true): TeamMatchObservation {
  const kickoff = new Date(Date.parse(target.commenceTime) - daysAgo * 86_400_000).toISOString();
  return {
    sourceEventId: id, leagueName: "Premier League", kickoff, homeTeamId: homeId, awayTeamId: awayId,
    homeTeam: homeId, awayTeam: awayId, homeScore, awayScore,
    events: [
      ...(homeScore > 0 ? [{ teamId: homeId, minute: 80, type: "goal" as const, observedAt: new Date(Date.parse(kickoff) + 2 * 60 * 60_000).toISOString() }] : []),
      ...(awayScore > 0 ? [{ teamId: awayId, minute: 25, type: "goal" as const, observedAt: new Date(Date.parse(kickoff) + 2 * 60 * 60_000).toISOString() }] : []),
    ],
    statistics: withStats ? [
      { teamId: homeId, observedAt: kickoff, xg: 1.8, shots: 14, shotsOnTarget: 6, possession: 57 },
      { teamId: awayId, observedAt: kickoff, xg: 1.1, shots: 9, shotsOnTarget: 3, possession: 43 },
    ] : undefined,
  };
}

function input(extra: TeamMatchObservation[] = []): MatchIntelligenceInput {
  const observations: TeamMatchObservation[] = [];
  for (let i = 1; i <= 10; i += 1) {
    observations.push(i <= 5 ? match(`h${i}`, i, "home", `x${i}`, 2, 1) : match(`h${i}`, i, `x${i}`, "home", 1, 0));
    observations.push(match(`a${i}`, i, `y${i}`, "away", i % 2 ? 1 : 0, i % 2 ? 1 : 2));
  }
  return { target, homeTeamId: "home", awayTeamId: "away", observations: [...observations, ...extra], capabilityMap: capabilities,
    generatedAt: new Date("2026-09-19T12:00:00.000Z") };
}

describe("MatchIntelligenceEngine", () => {
  it("last5 ve last10 formu ayri hesaplar", () => {
    const result = new MatchIntelligenceEngine(5).analyze(input());
    expect(result.home.form.last5).toMatchObject({ wins: { value: 5 }, losses: { value: 0 }, pointsPerGame: { value: 3 } });
    expect(result.home.form.last10).toMatchObject({ wins: { value: 5 }, losses: { value: 5 }, pointsPerGame: { value: 1.5 } });
  });

  it("BTTS, gol esikleri, clean sheet ve failed-to-score oranlarini uretir", () => {
    const form = new MatchIntelligenceEngine(5).analyze(input()).home.form.last5;
    expect(form).toMatchObject({ bttsRate: { value: 100 }, over15Rate: { value: 100 }, over25Rate: { value: 100 },
      over35Rate: { value: 0 }, cleanSheetRate: { value: 0 }, failedToScoreRate: { value: 0 } });
  });

  it("genel formdan bagimsiz home ve away venue split hesaplar", () => {
    const result = new MatchIntelligenceEngine(5).analyze(input());
    expect(result.home.venue).toMatchObject({ venue: "home", pointsPerGame: { value: 3 }, goalsForPerGame: { value: 2 } });
    expect(result.away.venue).toMatchObject({ venue: "away", pointsPerGame: { value: 2 }, goalsAgainstPerGame: { value: 0.5 } });
  });

  it("gercek event dakikalarindan timing bucket ve second-half tendency hesaplar", () => {
    const timing = new MatchIntelligenceEngine(5).analyze(input()).home.timing;
    expect(timing.goalsScoredByBucket.value?.["76-90+"]).toBe(5);
    expect(timing.secondHalfGoalRate.value).toBe(50);
    expect(timing.lateGoalTendency.value).toBe(50);
  });

  it("xG ve shot ortalamalarini kullanir; gecersiz stats'i reddeder", () => {
    const invalid = match("invalid-stat", 0.5, "home", "z", 1, 0);
    invalid.statistics = [{ teamId: "home", observedAt: invalid.kickoff, xg: -2, shots: -1, possession: 120 }];
    const stats = new MatchIntelligenceEngine(5).analyze(input([invalid])).home.stats.last10;
    expect(stats.xg).toMatchObject({ value: 1.49, sampleSize: 9 });
    expect(stats.shots).toMatchObject({ value: 11.78, sampleSize: 9 });
    expect(stats.possession).toMatchObject({ value: 50.78, sampleSize: 9 });
  });

  it("xG unavailable iken gol sayisindan sahte xG uretmez", () => {
    const value = input(); value.capabilityMap = { ...capabilities, xg: "unavailable", fixtureStats: "unavailable" };
    value.observations.forEach((row) => { row.statistics = undefined; });
    const result = new MatchIntelligenceEngine(5).analyze(value);
    expect(result.home.stats.last10.xg).toMatchObject({ value: null, availability: "unavailable" });
    expect(result.capabilityMap.xg).toBe("unavailable");
  });

  it("ayni lig baseline'i ile strength normalize eder", () => {
    const result = new MatchIntelligenceEngine(5).analyze(input());
    expect(result.strengths.leagueGoalsPerTeamGame.sampleSize).toBe(20);
    expect(result.strengths.homeAttackStrength.value).not.toBeNull();
    expect(result.goalEnvironment.reasons.length).toBeGreaterThan(0);
    expect(["home_edge", "away_edge", "balanced"]).toContain(result.teamStrengthEnvironment);
  });

  it("kucuk sample confidence'i dusurur ve outcome probability olarak sunmaz", () => {
    const small = input(); small.observations = small.observations.slice(0, 2);
    const result = new MatchIntelligenceEngine(5).analyze(small);
    expect(result.confidence.score).toBeLessThan(70);
    expect(result.confidence.note).toContain("outcome probability degildir");
    expect(result.dataAvailability).toBe("partial");
  });

  it("score conflict ve impossible score'u sessizce birlestirmez", () => {
    const conflict = match("conflict", 11, "home", "z", 2, 1); conflict.reportedHomeScore = 1; conflict.reportedAwayScore = 1;
    const impossible = match("impossible", 12, "home", "z2", -1, 0);
    const result = new MatchIntelligenceEngine(5).analyze(input([conflict, impossible]));
    expect(result.conflicts).toEqual(expect.arrayContaining(["score_conflict:conflict", "invalid_score:impossible"]));
    expect(result.dataAvailability).toBe("conflict");
  });

  it("target maci ve kickoff sonrasi fixture/event/stat verisini prematch girdisinden dislar", () => {
    const targetRow = match("target", 1, "home", "away", 9, 9);
    const future = match("future", -1, "home", "away", 8, 8);
    const futureDetail = match("future-detail", 11, "home", "z", 1, 0);
    futureDetail.events = [{ teamId: "home", minute: 90, type: "goal", observedAt: "2026-09-21T00:00:00.000Z" }];
    futureDetail.statistics = [{ teamId: "home", observedAt: "2026-09-21T00:00:00.000Z", xg: 99, shots: 99 }];
    const result = new MatchIntelligenceEngine(5).analyze(input([targetRow, future, futureDetail]));
    expect(result.home.form.last10.goalsScoredPerGame.value).toBe(1);
    expect(result.home.stats.last10.xg.value).toBe(1.45);
    expect(result.home.timing.goalsScoredByBucket.value?.["76-90+"]).toBe(5);
  });
});
