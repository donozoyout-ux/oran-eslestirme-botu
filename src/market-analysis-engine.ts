import { createHash } from "node:crypto";
import type { OddsAnalysisSignal, OddsQuote } from "./domain.js";
import { eventKey } from "./comparison-engine.js";

export interface MarketAnalysisOptions { outlierThresholdPercent?: number; minConfidenceScore?: number; minArbitrageMarginPercent?: number; }
export interface SelectionConsensus { eventKey: string; event: string; phase: OddsQuote["phase"]; marketKey: OddsQuote["marketKey"]; market: string; period: OddsQuote["period"]; selectionKey: string; selection: string; line: number | null; sourceCount: number; consensusPrice: number; fairProbabilityPercent: number; dispersionPercent: number; confidenceScore: number; bestBookmaker: string; bestPrice: number; detectedAt: string; }
export interface ArbitrageLeg { selectionKey: string; selection: string; bookmaker: string; price: number; }
export interface ArbitrageOpportunity { id: string; eventKey: string; event: string; phase: OddsQuote["phase"]; marketKey: OddsQuote["marketKey"]; market: string; period: OddsQuote["period"]; line: number | null; impliedProbabilitySum: number; marginPercent: number; legs: ArbitrageLeg[]; detectedAt: string; }
export interface MarketAnalysisResult { consensus: SelectionConsensus[]; arbitrage: ArbitrageOpportunity[]; alertSignals: OddsAnalysisSignal[]; }

function median(values: number[]): number { const sorted = [...values].sort((a,b)=>a-b); if (!sorted.length) return 0; const m=Math.floor(sorted.length/2); return sorted.length%2===0 ? ((sorted[m-1]??0)+(sorted[m]??0))/2 : (sorted[m]??0); }
function relativeDifferencePercent(value:number, reference:number):number { return value>0&&reference>0 ? Math.abs(value-reference)/reference*100 : 0; }
function normalizedLine(line:number|null):string { return line===null?"none":Number(line).toFixed(3); }
function marketGroupKey(q:OddsQuote):string { return [eventKey(q),q.marketKey,q.period,normalizedLine(q.line)].join("|"); }
function stableId(prefix:string,value:string):string { return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0,24)}`; }
function expectedOutcomeCount(key:OddsQuote["marketKey"]):number|null { if(key==="match_winner_3way"||key==="double_chance") return 3; if(["match_winner_2way","total_goals","handicap","both_teams_to_score"].includes(key)) return 2; return null; }
function confidenceScore(sourceCount:number, robustDispersionPercent:number, completeBookmakers:number):number { const coverage=Math.min(sourceCount/5,1)*45; const agreement=Math.max(0,1-robustDispersionPercent/12)*35; const completeness=Math.min(completeBookmakers/3,1)*20; return Math.round(Math.max(0,Math.min(100,coverage+agreement+completeness))); }
function latestQuotes(quotes:OddsQuote[]):OddsQuote[] { const latest=new Map<string,OddsQuote>(); for(const q of quotes){ if(!Number.isFinite(q.price)||q.price<=1) continue; const key=[marketGroupKey(q),q.bookmakerKey,q.selectionKey].join("|"); const old=latest.get(key); if(!old||Date.parse(q.updatedAt)>Date.parse(old.updatedAt)) latest.set(key,q); } return [...latest.values()]; }

export function analyzeOddsMarket(quotes:OddsQuote[], options:MarketAnalysisOptions={}, now=new Date()):MarketAnalysisResult {
 const outlierThreshold=options.outlierThresholdPercent??7, minConfidence=options.minConfidenceScore??70, minArbitrageMargin=options.minArbitrageMarginPercent??0.2;
 const grouped=new Map<string,OddsQuote[]>(); for(const q of latestQuotes(quotes)){ const key=marketGroupKey(q), group=grouped.get(key)??[]; group.push(q); grouped.set(key,group); }
 const consensus:SelectionConsensus[]=[], arbitrage:ArbitrageOpportunity[]=[], alertSignals:OddsAnalysisSignal[]=[];
 for(const group of grouped.values()){
  if(group.length<2) continue; const sample=group[0]!; const byBookmaker=new Map<string,OddsQuote[]>();
  for(const q of group){ const a=byBookmaker.get(q.bookmakerKey)??[]; a.push(q); byBookmaker.set(q.bookmakerKey,a); }
  const expected=expectedOutcomeCount(sample.marketKey), fairProbabilities=new Map<string,number[]>(); let completeBookmakers=0;
  for(const bookmakerQuotes of byBookmaker.values()){
   const unique=new Map(bookmakerQuotes.map(q=>[q.selectionKey,q])); if(expected!==null&&unique.size<expected) continue; if(unique.size<2) continue;
   const overround=[...unique.values()].reduce((s,q)=>s+1/q.price,0); if(!Number.isFinite(overround)||overround<=0) continue; completeBookmakers++;
   for(const q of unique.values()){ const list=fairProbabilities.get(q.selectionKey)??[]; list.push((1/q.price)/overround); fairProbabilities.set(q.selectionKey,list); }
  }
  const bySelection=new Map<string,OddsQuote[]>(); for(const q of group){ const a=bySelection.get(q.selectionKey)??[]; a.push(q); bySelection.set(q.selectionKey,a); }
  for(const selectionQuotes of bySelection.values()){
   const first=selectionQuotes[0]!, prices=selectionQuotes.map(q=>q.price), consensusPrice=median(prices), minPrice=Math.min(...prices), maxPrice=Math.max(...prices);
   const dispersionPercent=consensusPrice>0?(maxPrice-minPrice)/consensusPrice*100:0;
   // Guven skoru tek bir aykiri kaynagin kendisini cezalandirmamasi icin medyan mutlak goreli sapmayi kullanir.
   const robustDispersionPercent=median(prices.map(price=>relativeDifferencePercent(price,consensusPrice)));
   const best=selectionQuotes.reduce((a,q)=>q.price>a.price?q:a), fairValues=fairProbabilities.get(first.selectionKey)??[];
   const fairProbability=fairValues.length?fairValues.reduce((s,v)=>s+v,0)/fairValues.length:1/consensusPrice;
   const confidence=confidenceScore(selectionQuotes.length,robustDispersionPercent,completeBookmakers);
   const row:SelectionConsensus={eventKey:eventKey(first),event:`${first.homeTeam} - ${first.awayTeam}`,phase:first.phase,marketKey:first.marketKey,market:first.marketName,period:first.period,selectionKey:first.selectionKey,selection:first.selectionName,line:first.line,sourceCount:selectionQuotes.length,consensusPrice,fairProbabilityPercent:fairProbability*100,dispersionPercent,confidenceScore:confidence,bestBookmaker:best.bookmakerName,bestPrice:best.price,detectedAt:now.toISOString()}; consensus.push(row);
   if(selectionQuotes.length>=3&&confidence>=minConfidence){ for(const q of selectionQuotes){ const deviation=relativeDifferencePercent(q.price,consensusPrice); if(deviation<outlierThreshold) continue; const direction=q.price>consensusPrice?"yüksek":"düşük", signalKey=[marketGroupKey(q),q.selectionKey,q.bookmakerKey,direction].join("|"); alertSignals.push({id:stableId("outlier",signalKey),type:"source_outlier",event:row.event,market:row.market,selection:row.selection,line:row.line,detail:`${q.bookmakerName} oranı ${q.price.toFixed(2)}; piyasa medyanı ${consensusPrice.toFixed(2)}. Sapma %${deviation.toFixed(1)} (${direction}). Güven ${confidence}/100.`,detectedAt:now.toISOString(),bookmaker:q.bookmakerName,currentPrice:q.price,consensusPrice,fairProbabilityPercent:row.fairProbabilityPercent,sourceCount:row.sourceCount,confidenceScore:confidence,changePercent:q.price>consensusPrice?deviation:-deviation}); } }
  }
  const bestBySelection=[...bySelection.values()].map(a=>a.reduce((x,q)=>q.price>x.price?q:x)); const count=bestBySelection.length; if(count<2||(expected!==null&&count<expected)) continue;
  const impliedProbabilitySum=bestBySelection.reduce((s,q)=>s+1/q.price,0), marginPercent=(1-impliedProbabilitySum)*100; if(marginPercent<minArbitrageMargin) continue;
  const arbKey=[marketGroupKey(sample),...bestBySelection.map(q=>`${q.selectionKey}:${q.bookmakerKey}:${q.price}`)].join("|");
  const opportunity:ArbitrageOpportunity={id:stableId("arb",arbKey),eventKey:eventKey(sample),event:`${sample.homeTeam} - ${sample.awayTeam}`,phase:sample.phase,marketKey:sample.marketKey,market:sample.marketName,period:sample.period,line:sample.line,impliedProbabilitySum,marginPercent,legs:bestBySelection.map(q=>({selectionKey:q.selectionKey,selection:q.selectionName,bookmaker:q.bookmakerName,price:q.price})),detectedAt:now.toISOString()}; arbitrage.push(opportunity);
  alertSignals.push({id:opportunity.id,type:"arbitrage",event:opportunity.event,market:opportunity.market,selection:opportunity.legs.map(l=>l.selection).join(" / "),line:opportunity.line,detail:`Teorik arbitraj marjı %${marginPercent.toFixed(2)}. ${opportunity.legs.map(l=>`${l.selection}: ${l.bookmaker} ${l.price.toFixed(2)}`).join(" | ")}`,detectedAt:now.toISOString(),confidenceScore:100,arbitrageMarginPercent:marginPercent,sourceCount:new Set(bestBySelection.map(q=>q.bookmakerKey)).size});
 }
 return {consensus:consensus.sort((a,b)=>b.confidenceScore-a.confidenceScore),arbitrage:arbitrage.sort((a,b)=>b.marginPercent-a.marginPercent),alertSignals};
}
