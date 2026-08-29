import test from "node:test";
import assert from "node:assert/strict";
import { rankCouponCandidates } from "../src/coupon-engine.js";
import type { SelectionConsensus } from "../src/market-analysis-engine.js";

function row(overrides: Partial<SelectionConsensus> = {}): SelectionConsensus {
  return { eventKey:"a|b",event:"A - B",phase:"prematch",marketKey:"match_winner_3way",market:"Maç Sonucu",period:"full_time",selectionKey:"home",selection:"A",line:null,sourceCount:5,consensusPrice:2,fairProbabilityPercent:50,dispersionPercent:2,confidenceScore:90,bestBookmaker:"Book A",bestPrice:2.16,detectedAt:new Date().toISOString(),...overrides };
}

test("guclu value ve guven sinyalini oynanabilir olarak siralar",()=>{
 const [candidate]=rankCouponCandidates([row()]);
 assert.ok(candidate);
 assert.equal(candidate.verdict,"PLAYABLE");
 assert.ok(candidate.valuePercent>7);
 assert.ok(candidate.score>=75);
});

test("fiyat avantaji olmayan secimi oynanabilir yapmaz",()=>{
 const [candidate]=rankCouponCandidates([row({bestPrice:1.95})]);
 assert.ok(candidate);
 assert.equal(candidate.verdict,"AVOID");
 assert.ok(candidate.valuePercent<0);
});
