import { createHash } from "node:crypto";
import type { HistoricalCompletedFixture, HistoricalOddsSnapshot } from "./historical-odds.js";

export interface ClosingOddsOptions {
  maxProviderAgeSeconds: number;
}

function marketObservationKey(snapshot: HistoricalOddsSnapshot): string {
  return [
    snapshot.bookmakerKey,
    snapshot.marketKey,
    snapshot.period,
    snapshot.selectionKey,
    snapshot.line === null ? "none" : snapshot.line.toFixed(3),
  ].join("|");
}

function closingId(snapshot: HistoricalOddsSnapshot): string {
  return `closing:${createHash("sha256")
    .update(`${snapshot.canonicalEventId}|${marketObservationKey(snapshot)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

/**
 * Final fixture kickoff'una gore, her bookmaker/market/secim/line icin mac
 * baslamadan onceki son gecerli provider gozlemini secer.
 */
export function selectClosingSnapshots(
  snapshots: HistoricalOddsSnapshot[],
  fixture: HistoricalCompletedFixture,
  options: ClosingOddsOptions,
): HistoricalOddsSnapshot[] {
  const kickoff = Date.parse(fixture.kickoff);
  if (!Number.isFinite(kickoff)) return [];
  const latest = new Map<string, HistoricalOddsSnapshot>();

  for (const snapshot of snapshots) {
    if (snapshot.canonicalEventId !== fixture.canonicalEventId) continue;
    if (snapshot.snapshotType !== "prematch" || snapshot.phase !== "prematch") continue;
    if (!Number.isFinite(snapshot.price) || snapshot.price <= 1) continue;
    const capturedAt = Date.parse(snapshot.snapshotAt);
    const providerUpdatedAt = Date.parse(snapshot.providerUpdatedAt);
    if (!Number.isFinite(capturedAt) || !Number.isFinite(providerUpdatedAt)) continue;
    if (capturedAt >= kickoff || providerUpdatedAt >= kickoff) continue;
    const providerAgeMs = capturedAt - providerUpdatedAt;
    if (providerAgeMs < -60_000 || providerAgeMs > options.maxProviderAgeSeconds * 1_000) continue;
    const key = marketObservationKey(snapshot);
    const existing = latest.get(key);
    if (
      !existing ||
      providerUpdatedAt > Date.parse(existing.providerUpdatedAt) ||
      (providerUpdatedAt === Date.parse(existing.providerUpdatedAt) && capturedAt > Date.parse(existing.snapshotAt))
    ) latest.set(key, snapshot);
  }

  return [...latest.values()].map((snapshot) => ({
    ...snapshot,
    id: closingId(snapshot),
    // Provider katalogundaki son canonical kickoff duzeltmesi arsive yansir.
    kickoff: fixture.kickoff,
    snapshotType: "closing",
  }));
}
