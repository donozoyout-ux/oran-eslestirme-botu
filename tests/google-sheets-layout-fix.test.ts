import { describe, expect, it, vi } from "vitest";
import type { DailySheetDataset } from "../src/daily-match-sheet.js";
import type { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";
import { enableGoogleSheetLayoutFix } from "../src/google-sheets-layout-fix.js";

interface Call {
  url: string;
  body?: string;
}

const emptyDataset: DailySheetDataset = {
  date: "2026-09-01",
  fixtures: [],
  oddsHistory: [],
  signals: [],
};

describe("Google Sheets layout fix", () => {
  it("eski conditional-format kurallarini temizleyip tek set halinde yeniden kurmaya hazirlar", async () => {
    const calls: Call[] = [];
    const originalPrepare = vi.fn(async () => undefined);
    const fake = {
      url: "https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnopqrstuv/edit",
      sync: vi.fn(async () => undefined),
      accessToken: vi.fn(async () => "token"),
      prepareSheets: originalPrepare,
      async request(url: string, _token: string, init: RequestInit = {}) {
        calls.push({ url, body: typeof init.body === "string" ? init.body : undefined });
        if (url.includes("?fields=sheets(")) {
          return {
            sheets: [
              { properties: { sheetId: 1, title: "BUGUN_NE_OYNANIR" }, conditionalFormats: Array(8).fill({}) },
              { properties: { sheetId: 2, title: "Kupon_Adaylari" }, conditionalFormats: Array(4).fill({}) },
              { properties: { sheetId: 3, title: "Maclar" }, conditionalFormats: Array(3).fill({}) },
            ],
          };
        }
        return {};
      },
    } as unknown as GoogleSheetsMirror;

    const wrapped = enableGoogleSheetLayoutFix(fake) as unknown as {
      prepareSheets(token: string, tables: Array<{ title: string; rows: unknown[][]; columnWidths: number[] }>, ids: Map<string, number>): Promise<void>;
    };

    await wrapped.prepareSheets(
      "token",
      [
        { title: "BUGUN_NE_OYNANIR", rows: [["H"], ["D"]], columnWidths: [100] },
        { title: "Kupon_Adaylari", rows: [["H"]], columnWidths: [100] },
        { title: "Maclar", rows: [["H"]], columnWidths: [100] },
      ],
      new Map([["BUGUN_NE_OYNANIR", 1], ["Kupon_Adaylari", 2], ["Maclar", 3]]),
    );

    expect(originalPrepare).toHaveBeenCalledOnce();
    const deleteCall = calls.find((call) => call.body?.includes("deleteConditionalFormatRule"));
    const deleteBody = JSON.parse(deleteCall?.body ?? "{}");
    expect(deleteBody.requests).toHaveLength(12);
    expect(deleteBody.requests.every((request: { deleteConditionalFormatRule?: { index?: number } }) => request.deleteConditionalFormatRule?.index === 0)).toBe(true);

    const layoutCall = calls.find((call) => call.body?.includes("wrapStrategy"));
    expect(layoutCall?.body).toContain("WRAP");
    expect(layoutCall?.body).toContain("pixelSize");
  });

  it("mac veya oran yoksa bos sekmeler yerine aciklayici durum satirlari yazar", async () => {
    const calls: Call[] = [];
    const fake = {
      url: "https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnopqrstuv/edit",
      sync: vi.fn(async () => undefined),
      accessToken: vi.fn(async () => "token"),
      prepareSheets: vi.fn(async () => undefined),
      async request(url: string, _token: string, init: RequestInit = {}) {
        calls.push({ url, body: typeof init.body === "string" ? init.body : undefined });
        return {};
      },
    } as unknown as GoogleSheetsMirror;

    const wrapped = enableGoogleSheetLayoutFix(fake);
    await wrapped.sync(emptyDataset);

    const update = calls.find((call) => call.url.endsWith("values:batchUpdate"));
    const body = JSON.parse(update?.body ?? "{}");
    expect(body.data.some((item: { range: string }) => item.range === "'Maclar'!A2:H2")).toBe(true);
    expect(body.data.some((item: { range: string }) => item.range === "'Kupon_Adaylari'!A2:Q2")).toBe(true);
    expect(JSON.stringify(body)).toContain("Bugün takip edilen 6 ligde aktif maç yok");
    expect(JSON.stringify(body)).toContain("Henüz yeterli oran verisi yok");
  });
});
