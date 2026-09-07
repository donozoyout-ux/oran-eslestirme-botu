import { CanonicalMatchResolver } from "./canonical-match-resolver.js";
import type { HistoricalOddsRepository } from "./historical-odds-repository.js";
import { historicalSnapshotId } from "./historical-odds-archive.js";
import { selectClosingSnapshots } from "./closing-odds.js";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "./historical-odds.js";
import type { MatchFixture } from "./domain.js";
import { setProviderDiagnostic } from "./provider-diagnostics.js";
import type { SportmonksProvider } from "./providers/sportmonks-provider.js";

export interface BackfillResult { days: number; fixtures: number; results: number; oddsSnapshots: number; oddsHistoryCapability: "available" | "odds_history_unavailable" }

export class SportmonksHistoricalBackfill {
  private readonly resolver = new CanonicalMatchResolver();
  constructor(private readonly provider: SportmonksProvider, private readonly repository: HistoricalOddsRepository) {}
  async run(days = 7, now = new Date()): Promise<BackfillResult> {
    const safeDays = Math.max(1, Math.min(30, Math.floor(days)));
    let fixtures = 0; let results = 0; const allFixtures:MatchFixture[]=[]; const completed:HistoricalCompletedFixture[]=[];
    const checkpoint = await this.repository.getIngestionCheckpoint("sportmonks-recent");
    for (let offset = safeDays; offset >= 1; offset -= 1) {
      const date = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0,10);
      if (checkpoint && date <= checkpoint) continue;
      const day = await this.provider.fetchHistoricalDay(date);
      for (const fixture of this.resolver.resolveFixtures(day.fixtures)) {
        allFixtures.push(fixture);
        if (fixture.resultStatus !== "finished" && fixture.resultStatus !== "cancelled") continue;
        fixtures += 1;
        if (fixture.resultStatus === "finished" && fixture.homeScore !== undefined && fixture.awayScore !== undefined) results += 1;
        const historicalFixture:HistoricalCompletedFixture = {
          canonicalEventId: fixture.canonicalEventId!, providerEventIds: [{provider:fixture.provider,eventId:fixture.sourceEventId}],
          league: fixture.leagueName, normalizedLeagueKey: this.resolver.normalizeLeague(fixture.leagueName), homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam, kickoff: fixture.commenceTime, fixtureResult: fixture.resultStatus,
          ...(fixture.homeScore === undefined ? {} : {homeScore:fixture.homeScore}), ...(fixture.awayScore === undefined ? {} : {awayScore:fixture.awayScore}),
          ...(fixture.halftimeHomeScore === undefined ? {} : {halftimeHomeScore:fixture.halftimeHomeScore}),
          ...(fixture.halftimeAwayScore === undefined ? {} : {halftimeAwayScore:fixture.halftimeAwayScore}), archivedAt: now.toISOString(),
        };
        completed.push(historicalFixture); await this.repository.saveCompletedFixture(historicalFixture);
      }
      await this.repository.saveIngestionCheckpoint("sportmonks-recent",date);
    }
    const recentStored=await this.repository.queryCompletedFixtures({after:new Date(now.getTime()-safeDays*86_400_000).toISOString(),before:now.toISOString(),limit:10_000});
    for(const row of recentStored) {
      if(!completed.some(f=>f.canonicalEventId===row.canonicalEventId)) completed.push(row);
      if(!allFixtures.some(f=>f.canonicalEventId===row.canonicalEventId)) {
        const ref=row.providerEventIds.find(candidate=>candidate.provider==="sportmonks")??row.providerEventIds[0];
        allFixtures.push({provider:ref?.provider??"historical",sourceEventId:ref?.eventId??row.canonicalEventId,
          canonicalEventId:row.canonicalEventId,leagueName:row.league,homeTeam:row.homeTeam,awayTeam:row.awayTeam,commenceTime:row.kickoff,phase:"prematch",resultStatus:row.fixtureResult,
          ...(row.homeScore===undefined?{}:{homeScore:row.homeScore}),...(row.awayScore===undefined?{}:{awayScore:row.awayScore})});
      }
    }
    const oddsResult = typeof this.provider.fetchHistoricalOdds === "function"
      ? await this.provider.fetchHistoricalOdds(allFixtures)
      : {capability:"odds_history_unavailable" as const,quotes:[]};
    const canonicalBySource=new Map(allFixtures.map(f=>[f.sourceEventId,f.canonicalEventId!])); const raw:HistoricalOddsSnapshot[]=[];
    for(const quote of oddsResult.quotes.sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))){const canonicalEventId=canonicalBySource.get(quote.sourceEventId); if(!canonicalEventId)continue;
      const value:Omit<HistoricalOddsSnapshot,"id">={canonicalEventId,provider:quote.provider,sourceEventId:quote.sourceEventId,league:quote.leagueName,
        normalizedLeagueKey:this.resolver.normalizeLeague(quote.leagueName),homeTeam:quote.homeTeam,awayTeam:quote.awayTeam,kickoff:quote.commenceTime,
        snapshotAt:quote.updatedAt,providerUpdatedAt:quote.updatedAt,snapshotType:"prematch",phase:"prematch",marketKey:quote.marketKey,market:quote.marketName,
        period:quote.period,selectionKey:quote.selectionKey,selection:quote.selectionName,line:quote.line,bookmakerKey:quote.bookmakerKey,bookmaker:quote.bookmakerName,price:quote.price};
      if(Date.parse(value.providerUpdatedAt)>=Date.parse(value.kickoff))continue; raw.push({...value,id:historicalSnapshotId(value)}); }
    const openings:HistoricalOddsSnapshot[]=[]; const seen=new Set<string>(); for(const snapshot of raw){const key=[snapshot.canonicalEventId,snapshot.provider,snapshot.bookmakerKey,snapshot.marketKey,snapshot.period,snapshot.selectionKey,snapshot.line??"none"].join("|"); if(seen.has(key))continue; seen.add(key); const opening={...snapshot,snapshotType:"opening" as const}; openings.push({...opening,id:historicalSnapshotId(opening)});}
    await this.repository.saveOddsSnapshots([...raw,...openings]); let closingCount=0; for(const fixture of completed){const event=await this.repository.getByCanonicalEvent(fixture.canonicalEventId); const closing=selectClosingSnapshots(event.snapshots,fixture,{maxProviderAgeSeconds:86_400}); closingCount+=closing.length; await this.repository.saveOddsSnapshots(closing);}
    const result: BackfillResult = { days:safeDays,fixtures,results,oddsSnapshots:raw.length+openings.length+closingCount,oddsHistoryCapability:oddsResult.capability };
    setProviderDiagnostic("sportmonks_historical", { enabled:true,status:"ok",mode:result.oddsHistoryCapability,fixtureCount:fixtures,quoteCount:0,lastProviderRunAt:now.toISOString(),lastSuccessAt:now.toISOString(),lastError:null });
    return result;
  }
}
