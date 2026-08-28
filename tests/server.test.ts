import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { OddsMonitor } from "../src/monitor.js";
import { createServer } from "../src/server.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function monitorStub(): OddsMonitor {
  return {
    getStatus: () => ({
      provider: "mock",
      notifier: "console",
      running: false,
      startedAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastRun: null,
      recentQuotes: [],
      recentMatches: [],
      dailySheet: { date: "2026-08-28", fixtures: [], oddsSnapshotCount: 0, signalCount: 0, recentSignals: [] },
      totals: { runs: 0, alertsSent: 0, errors: 0 },
    }),
    runOnce: async () => ({
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      quotesFetched: 0,
      quotesFresh: 0,
      matchesFound: 0,
      alertsSent: 0,
      alertsSuppressed: 0,
    }),
    getDailyFixturesCsv: () => "\uFEFFTarih\r\n",
    getOddsHistoryCsv: () => "\uFEFFOran\r\n",
  } as OddsMonitor;
}

async function startServer() {
  const server = createServer(monitorStub());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("dashboard", () => {
  it("ana sayfada durum panelini sunar", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("Oran Eşleştirme Botu");
    expect(html).toContain("fetch('/status'");
  });

  it("saglik ucunu korur", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "oran-eslestirme-botu" });
  });

  it("gunluk mac ve oran gecmisi CSV dosyalarini sunar", async () => {
    const baseUrl = await startServer();
    const fixtures = await fetch(`${baseUrl}/daily-matches.csv`);
    const history = await fetch(`${baseUrl}/odds-history.csv`);

    expect(fixtures.headers.get("content-type")).toContain("text/csv");
    expect(fixtures.headers.get("content-disposition")).toContain("gunun-maclari.csv");
    expect(history.status).toBe(200);
  });
});
