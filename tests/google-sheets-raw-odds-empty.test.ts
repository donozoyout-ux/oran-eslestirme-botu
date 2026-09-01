import { describe, expect, it, vi } from "vitest";
import type { DailySheetDataset } from "../src/daily-match-sheet.js";
import type { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";
import { enableRawOddsGoogleSheet, rawOddsRows } from "../src/google-sheets-raw-odds.js";

const emptyDataset: DailySheetDataset = {
  date: "2026-09-01",
  fixtures: [],
  oddsHistory: [],
  signals: [],
};

describe("Google Sheets empty raw odds", () => {
  it("oran yokken eski gun verisini birakmak yerine BEKLE satiri yazar", () => {
    const rows = rawOddsRows([]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("Henüz gerçek oran verisi gelmedi");
    expect(rows[1]).toContain("BEKLE");
  });

  it("bos gunde de Oran_Tablosu sync ve tail clear yapar", async () => {
    const requestCalls: Array<{ url: string; body?: string }> = [];
    const fakeMirror = {
      url: "https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnopqrstuv/edit",
      sync: vi.fn(async () => undefined),
      accessToken: vi.fn(async () => "token"),
      ensureSheets: vi.fn(async (_token: string, titles: string[]) => new Map(titles.map((title, index) => [title, index + 1]))),
      prepareSheets: vi.fn(async () => undefined),
      request: vi.fn(async (url: string, _token: string, init: RequestInit = {}) => {
        requestCalls.push({ url, body: typeof init.body === "string" ? init.body : undefined });
        return {};
      }),
    } as unknown as GoogleSheetsMirror;

    const wrapped = enableRawOddsGoogleSheet(fakeMirror);
    await wrapped.sync(emptyDataset);

    const update = requestCalls.find((call) => call.url.endsWith("values:batchUpdate"));
    expect(update).toBeTruthy();
    expect(update?.body).toContain("Henüz gerçek oran verisi gelmedi");
    expect(requestCalls.filter((call) => call.url.includes(":clear")).length).toBe(2);
  });
});
