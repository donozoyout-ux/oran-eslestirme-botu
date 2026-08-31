import { describe, expect, it, vi } from "vitest";
import type { DailySheetDataset, OddsHistoryEntry } from "../src/daily-match-sheet.js";
import type { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";
import { enableRawOddsGoogleSheet, latestRawOdds, rawOddsRows } from "../src/google-sheets-raw-odds.js";

const baseEntry: OddsHistoryEntry = {
  capturedAt: "2026-08-31T18:05:33.000Z",
  provider: "betexplorer_scraper",
  sourceEventId: "match-1",
  event: "Alpha - Beta",
  phase: "prematch",
  marketKey: "match_winner_3way",
  market: "Mac Sonucu",
  period: "full_time",
  selectionKey: "home",
  selection: "Alpha",
  line: null,
  bookmakerKey: "pinnacle",
  bookmaker: "Pinnacle",
  price: 2.1,
  sourceUpdatedAt: "2026-08-31T18:05:32.000Z",
};

function dataset(entries: OddsHistoryEntry[]): DailySheetDataset {
  return {
    date: "2026-08-31",
    fixtures: [],
    oddsHistory: entries,
    signals: [],
  };
}

describe("Google Sheets raw odds görünümü", () => {
  it("fixture listesi olmasa bile son gerçek oranı tutar", () => {
    const older = { ...baseEntry, capturedAt: "2026-08-31T18:00:00.000Z", price: 2.05 };
    const newer = { ...baseEntry, capturedAt: "2026-08-31T18:05:00.000Z", price: 2.12 };

    const latest = latestRawOdds([older, newer]);
    const rows = rawOddsRows([older, newer]);

    expect(latest).toHaveLength(1);
    expect(latest[0]?.price).toBe(2.12);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("Alpha - Beta");
    expect(rows[1]).toContain(2.12);
  });

  it("Oran_Tablosu ve Oran_Gecmisi sekmelerine ham oranları zorunlu yazar", async () => {
    const baseSync = vi.fn(async (_dataset: DailySheetDataset) => undefined);
    const prepareCalls: Array<Array<{ title: string; hidden?: boolean; rows: unknown[][] }>> = [];
    const requestCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeMirror = {
      url: "https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnopqrstuv/edit",
      sync: baseSync,
      accessToken: vi.fn(async () => "token"),
      ensureSheets: vi.fn(async (_token: string, titles: string[]) =>
        new Map(titles.map((title, index) => [title, index + 1])),
      ),
      prepareSheets: vi.fn(async (_token: string, tables: Array<{ title: string; hidden?: boolean; rows: unknown[][] }>) => {
        prepareCalls.push(tables);
      }),
      request: vi.fn(async (_url: string, _token: string, init?: RequestInit) => {
        requestCalls.push({ url: _url, init });
        return {};
      }),
    } as unknown as GoogleSheetsMirror;

    const wrapped = enableRawOddsGoogleSheet(fakeMirror);
    await wrapped.sync(dataset([baseEntry]));

    expect(baseSync).toHaveBeenCalledOnce();
    expect(prepareCalls).toHaveLength(1);
    expect(prepareCalls[0]?.map((table) => table.title)).toEqual(["Oran_Tablosu", "Oran_Gecmisi"]);
    expect(prepareCalls[0]?.find((table) => table.title === "Oran_Gecmisi")?.hidden).toBe(false);

    const updateCall = requestCalls.find((call) => call.url.endsWith("values:batchUpdate"));
    expect(updateCall).toBeTruthy();
    const body = JSON.parse(String(updateCall?.init?.body));
    const rawTable = body.data.find((item: { range: string }) => item.range === "'Oran_Tablosu'!A1");
    expect(rawTable.values).toHaveLength(2);
    expect(JSON.stringify(rawTable.values)).toContain("Alpha - Beta");
    expect(JSON.stringify(rawTable.values)).toContain("Pinnacle");
  });
});
