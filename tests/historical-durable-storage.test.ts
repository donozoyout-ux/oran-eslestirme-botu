import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MatchFixture, OddsQuote } from "../src/domain.js";
import { HistoricalExistingDataImporter } from "../src/historical-existing-data-importer.js";
import { HistoricalOddsArchive } from "../src/historical-odds-archive.js";
import { HistoricalOddsPatternEngine } from "../src/historical-odds-pattern-engine.js";
import { createHistoricalRepository } from "../src/historical-repository-factory.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "../src/historical-odds.js";
import { JsonHistoricalOddsRepository, MemoryHistoricalOddsRepository } from "../src/historical-odds-repository.js";
import { HISTORICAL_POSTGRES_MIGRATION } from "../src/historical-postgres-schema.js";
import { PostgresHistoricalOddsRepository, type SqlQueryable, type SqlResult } from "../src/postgres-historical-odds-repository.js";
import { SportmonksHistoricalBackfill } from "../src/sportmonks-historical-backfill.js";
import type { SportmonksProvider } from "../src/providers/sportmonks-provider.js";

const kickoff = "2026-09-08T18:00:00.000Z";
function fixture(status: MatchFixture["resultStatus"] = "scheduled", score?: [number,number]): MatchFixture {
  return { provider:"sportmonks",sourceEventId:"sm-1",leagueName:"Premier League",homeTeam:"Man Utd",awayTeam:"Arsenal",
    commenceTime:kickoff,phase:status === "live" ? "live" : "prematch",resultStatus:status,
    ...(score ? {homeScore:score[0],awayScore:score[1]} : {}) };
}
function quote(price=1.91, updatedAt="2026-09-08T17:00:00.000Z", market:"handicap"|"total_goals"="handicap"): OddsQuote {
  return { provider:"sportmonks",bookmakerKey:"pinnacle",bookmakerName:"Pinnacle",sourceEventId:"sm-1",sportKey:"soccer",
    leagueName:"Premier League",homeTeam:"Manchester United",awayTeam:"Arsenal",commenceTime:kickoff,phase:"prematch",
    marketKey:market,marketName:market,period:"full_time",selectionKey:market === "handicap" ? "home" : "over",
    selectionName:market === "handicap" ? "Manchester United" : "Over",line:market === "handicap" ? -0.5 : 2.5,price,updatedAt };
}
function completed(provider="sportmonks", score:[number,number]=[2,1]): HistoricalCompletedFixture {
  return { canonicalEventId:"event-1",providerEventIds:[{provider,eventId:`${provider}-1`}],league:"Premier League",
    normalizedLeagueKey:"premier league",homeTeam:"Manchester United",awayTeam:"Arsenal",kickoff,fixtureResult:"finished",
    homeScore:score[0],awayScore:score[1],archivedAt:"2026-09-08T20:00:00.000Z" };
}
function snapshot(id:string, market:"handicap"|"total_goals", type:"prematch"|"closing"="closing"): HistoricalOddsSnapshot {
  return { id,canonicalEventId:"event-1",provider:"sportmonks",sourceEventId:"sm-1",league:"Premier League",normalizedLeagueKey:"premier league",
    homeTeam:"Manchester United",awayTeam:"Arsenal",kickoff,snapshotAt:"2026-09-08T17:59:00.000Z",providerUpdatedAt:"2026-09-08T17:58:00.000Z",
    snapshotType:type,phase:"prematch",marketKey:market,market,period:"full_time",selectionKey:market === "handicap" ? "home" : "over",
    selection:market === "handicap" ? "Manchester United" : "Over",line:market === "handicap" ? -0.5 : 2.5,
    bookmakerKey:"pinnacle",bookmaker:"Pinnacle",price:1.91 };
}

describe("durable historical archive", () => {
  it("explicit postgres storage DATABASE_URL olmadan acik hata verir", async () => {
    await expect(createHistoricalRepository({
      historicalStorage: "postgres",
      historicalOddsFile: "unused.json",
    })).rejects.toThrow("HISTORICAL_STORAGE=postgres icin DATABASE_URL gerekli.");
  });

  it("yalniz gercek price degisimini yazar, opening ve closing restartlarda tekildir", async () => {
    const repository = new MemoryHistoricalOddsRepository();
    const engine = new HistoricalOddsPatternEngine(repository);
    const archive = new HistoricalOddsArchive(repository,engine,{maxQuoteAgeSeconds:7200});
    await archive.record([quote()],[],new Date("2026-09-08T17:00:10Z"));
    await archive.record([quote(1.91,"2026-09-08T17:01:00Z")],[],new Date("2026-09-08T17:01:10Z"));
    await archive.record([quote(1.95,"2026-09-08T17:02:00Z")],[],new Date("2026-09-08T17:02:10Z"));
    expect((await repository.getStats()).oddsSnapshots).toBe(3);
    await archive.record([], [fixture("live")], new Date(kickoff));
    const restarted = new HistoricalOddsArchive(repository,engine,{maxQuoteAgeSeconds:7200});
    await restarted.record([], [fixture("live")], new Date("2026-09-08T18:01:00Z"));
    const data = await repository.getByCanonicalEvent((await repository.getByCanonicalEvent("event-1")).fixture?.canonicalEventId ?? "");
    expect((await repository.getStats()).oddsSnapshots).toBe(4);
    expect(data.snapshots).toHaveLength(0);
  });

  it("score conflict'i isaretler ve conflicted sonucu eligible saymaz", async () => {
    const repository = new MemoryHistoricalOddsRepository();
    await repository.saveCompletedFixture(completed("sportmonks",[2,1]));
    await repository.saveCompletedFixture(completed("football-data",[1,1]));
    await repository.saveOddsSnapshots([snapshot("ah","handicap"),snapshot("ou","total_goals")]);
    const event = await repository.getByCanonicalEvent("event-1");
    expect(event.fixture?.resultConflict).toBe(true);
    expect((await repository.getCompletenessDiagnostics()).patternEligible).toBe(0);
  });

  it("cancelled fixture'i result ve pattern denominatorina almaz", async () => {
    const repository = new MemoryHistoricalOddsRepository();
    await repository.saveCompletedFixture({...completed(),fixtureResult:"cancelled",homeScore:undefined,awayScore:undefined});
    await repository.saveOddsSnapshots([snapshot("ah","handicap"),snapshot("ou","total_goals")]);
    const summary = await repository.getCompletenessDiagnostics();
    expect(summary.withResults).toBe(0); expect(summary.patternEligible).toBe(0);
  });

  it("JSON restartinda duplicate snapshot uretmez ve last write'i korur", async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"historical-json-")); const file=path.join(dir,"history.json");
    await new JsonHistoricalOddsRepository(file).saveOddsSnapshots([snapshot("stable","handicap","prematch")]);
    const restarted=new JsonHistoricalOddsRepository(file); await restarted.saveOddsSnapshots([snapshot("stable","handicap","prematch")]);
    const stats=await restarted.getStats(); expect(stats.oddsSnapshots).toBe(1); expect(stats.lastArchiveWrite).not.toBeNull();
  });

  it("existing importer dry-run'da yazmaz ve apply tekrarinda idempotenttir", async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"historical-import-")); const file=path.join(dir,"daily.json");
    fs.writeFileSync(file,JSON.stringify({fixtures:[fixture("finished",[2,1])],oddsHistory:[{capturedAt:"2026-09-08T17:00:00Z",provider:"sportmonks",sourceEventId:"sm-1",event:"x",phase:"prematch",marketKey:"handicap",market:"AH",period:"full_time",selectionKey:"home",selection:"Man Utd",line:-0.5,bookmakerKey:"pinnacle",bookmaker:"Pinnacle",price:1.91,sourceUpdatedAt:"2026-09-08T16:59:00Z"}]}));
    const repo=new MemoryHistoricalOddsRepository(); const importer=new HistoricalExistingDataImporter(repo);
    expect((await importer.importDailyFile(file,true)).snapshots).toBe(2); expect((await repo.getStats()).oddsSnapshots).toBe(0);
    await importer.importDailyFile(file,false); await importer.importDailyFile(file,false);
    expect((await repo.getStats()).oddsSnapshots).toBe(2); expect((await repo.getStats()).completedFixtures).toBe(1);
  });

  it("SportMonks odds history yoksa fixture/results-only devam eder", async () => {
    let calls=0; const provider={fetchHistoricalDay:async()=>{calls+=1;return {fixtures:[fixture("finished",[2,1])],oddsHistoryCapability:"odds_history_unavailable" as const};}} as unknown as SportmonksProvider;
    const repo=new MemoryHistoricalOddsRepository(); const backfill=new SportmonksHistoricalBackfill(provider,repo); const result=await backfill.run(1,new Date("2026-09-09T12:00:00Z"));
    await backfill.run(1,new Date("2026-09-09T12:00:00Z"));
    expect(result).toMatchObject({resultsStored:1,oddsSnapshotsStored:0,oddsHistoryCapability:"odds_history_unavailable"});
    expect(calls).toBe(1);
  });
});

class RecordingSql implements SqlQueryable {
  calls:string[]=[];
  async query(text:string):Promise<SqlResult>{ this.calls.push(text); return {rows:[]}; }
}

class StatefulSql implements SqlQueryable {
  events=new Map<string,Record<string,unknown>>(); refs:{canonical_event_id:string;provider:string;source_event_id:string}[]=[];
  snapshots=new Map<string,Record<string,unknown>>();
  async query(text:string, values:unknown[]=[]):Promise<SqlResult>{
    if(text.includes("historical:event-by-id")) return {rows:this.events.has(String(values[0]))?[this.events.get(String(values[0]))!]:[]};
    if(text.includes("historical:refs-by-id") || text.startsWith("SELECT provider,source_event_id")) return {rows:this.refs.filter(r=>r.canonical_event_id===String(values[0]))};
    if(text.includes("historical:snapshots-by-id")) return {rows:[...this.snapshots.values()].filter(r=>r.canonical_event_id===String(values[0]))};
    if(text.includes("historical:event-upsert")) { const [id,leagueKey,league,home,away,kickoffValue,status,hs,as,hhs,has,conflict,conflicts,archived]=values;
      this.events.set(String(id),{canonical_event_id:id,normalized_league_key:leagueKey,league_name:league,home_team:home,away_team:away,kickoff:kickoffValue,result_status:status,home_score:hs,away_score:as,halftime_home_score:hhs,halftime_away_score:has,result_conflict:conflict,result_conflicts:JSON.parse(String(conflicts)),archived_at:archived}); return {rows:[]}; }
    if(text.includes("historical:provider-upsert")) { const row={canonical_event_id:String(values[0]),provider:String(values[1]),source_event_id:String(values[2])}; if(!this.refs.some(r=>r.provider===row.provider&&r.source_event_id===row.source_event_id))this.refs.push(row); return {rows:[]}; }
    if(text.includes("historical:snapshot-insert")){const [id,canonical,provider,source,league,leagueKey,home,away,kickoffValue,type,phase,marketKey,market,period,selectionKey,selection,line,bookmakerKey,bookmaker,price,captured,updated]=values;
      if(!this.snapshots.has(String(id)))this.snapshots.set(String(id),{id,canonical_event_id:canonical,provider,source_event_id:source,league_name:league,normalized_league_key:leagueKey,home_team:home,away_team:away,kickoff:kickoffValue,snapshot_type:type,phase,market_key:marketKey,market_name:market,period,selection_key:selectionKey,selection_name:selection,line,bookmaker_key:bookmakerKey,bookmaker_name:bookmaker,price,captured_at:captured,provider_updated_at:updated}); return {rows:[]}; }
    if(text.includes("historical:fixture-query")) return {rows:[...this.events.values()]};
    return {rows:[]};
  }
}

describe("PostgreSQL repository contract",()=>{
  it("migration tekrar calisabilir ve gereken unique/index kurallarini icerir",async()=>{
    const sql=new RecordingSql(); const repo=new PostgresHistoricalOddsRepository("postgres://unused",sql);
    await repo.initialize(); await repo.initialize();
    expect(sql.calls).toHaveLength(2); expect(HISTORICAL_POSTGRES_MIGRATION).toContain("CREATE TABLE IF NOT EXISTS historical_events");
    expect(HISTORICAL_POSTGRES_MIGRATION).toContain("UNIQUE(provider, source_event_id)");
    expect(HISTORICAL_POSTGRES_MIGRATION).toContain("historical_snapshots_market_line_idx");
  });

  it("snapshot insertinde stable primary key ve ON CONFLICT kullanir",async()=>{
    const sql=new RecordingSql(); const repo=new PostgresHistoricalOddsRepository("postgres://unused",sql);
    await repo.saveOddsSnapshots([snapshot("stable","handicap")]); await repo.saveOddsSnapshots([snapshot("stable","handicap")]);
    expect(sql.calls.filter((call)=>call.includes("ON CONFLICT(id) DO NOTHING"))).toHaveLength(2);
  });

  it("mock PostgreSQL ile JSON/in-memory repository temel davranis parity'sini korur",async()=>{
    const memory=new MemoryHistoricalOddsRepository(); const postgres=new PostgresHistoricalOddsRepository("postgres://unused",new StatefulSql());
    for(const repository of [memory,postgres]) { await repository.saveCompletedFixture(completed()); await repository.saveOddsSnapshots([snapshot("stable","handicap")]); await repository.saveOddsSnapshots([snapshot("stable","handicap")]); }
    const memoryEvent=await memory.getByCanonicalEvent("event-1"); const postgresEvent=await postgres.getByCanonicalEvent("event-1");
    expect(postgresEvent.fixture).toMatchObject({canonicalEventId:memoryEvent.fixture?.canonicalEventId,homeScore:2,awayScore:1});
    expect(postgresEvent.snapshots.map(s=>s.id)).toEqual(memoryEvent.snapshots.map(s=>s.id));
  });
});
