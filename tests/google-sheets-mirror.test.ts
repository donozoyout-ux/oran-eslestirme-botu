import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailySheetDataset } from "../src/daily-match-sheet.js";
import { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";

const sheetMetadata = {
  sheets: [
    { properties: { sheetId: 1, title: "BUGUN_NE_OYNANIR" } },
    { properties: { sheetId: 2, title: "Kupon_Adaylari" } },
    { properties: { sheetId: 3, title: "Pazar_Ozeti" } },
    { properties: { sheetId: 4, title: "Gol_Alt_Ust" } },
    { properties: { sheetId: 5, title: "Kornerler" } },
    { properties: { sheetId: 6, title: "Kartlar" } },
    { properties: { sheetId: 7, title: "Maclar" } },
    { properties: { sheetId: 8, title: "Oran_Gecmisi" } },
    { properties: { sheetId: 9, title: "Sinyaller" } },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mockGoogle(): { calls: Array<{ url: string; init?: RequestInit }> } {
  let metadataReads = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("?fields=sheets.properties")) {
      metadataReads += 1;
      return new Response(JSON.stringify(metadataReads === 1 ? { sheets: [] } : sheetMetadata), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

function mirrorWithKey(): GoogleSheetsMirror {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return new GoogleSheetsMirror({
    spreadsheetId: "1234567890abcdefghijklmnopqrstuv",
    serviceAccountEmail: "bot@example.iam.gserviceaccount.com",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

describe("Google Sheets aynasi", () => {
  it("Render'daki kacisli servis hesabi anahtarini kabul eder", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { calls } = mockGoogle();
    const mirror = new GoogleSheetsMirror({
      spreadsheetId: "1234567890abcdefghijklmnopqrstuv",
      serviceAccountEmail: "bot@example.iam.gserviceaccount.com",
      privateKey: JSON.stringify({ type: "service_account", private_key: pem.replaceAll("\n", "\\n") }),
    });

    await mirror.sync({ date: "2026-08-29", fixtures: [], oddsHistory: [], signals: [] });
    expect(calls.some((call) => call.url.includes("oauth2.googleapis.com"))).toBe(true);
  });

  it("biten/stale maclari siler ve farkli provider ID'lerini tek mac olarak gosterir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:00:00.000Z"));
    const { calls } = mockGoogle();
    const mirror = mirrorWithKey();

    const quoteBase = {
      capturedAt: "2026-08-29T17:58:00.000Z",
      phase: "prematch" as const,
      period: "full_time",
      sourceUpdatedAt: "2026-08-29T17:58:00.000Z",
      event: "Alpha FC - Beta Club",
      marketKey: "total_goals",
      market: "Toplam Gol",
      selectionKey: "over",
      selection: "Üst",
      line: 2.5,
    };

    const dataset: DailySheetDataset = {
      date: "2026-08-29",
      fixtures: [
        {
          provider: "provider-a",
          sourceEventId: "a-101",
          leagueName: "Test Ligi",
          homeTeam: "Alpha FC",
          awayTeam: "Beta Club",
          commenceTime: "2026-08-29T19:00:00.000Z",
          phase: "prematch",
          lastOddsCheckAt: "2026-08-29T17:58:00.000Z",
        },
        {
          provider: "provider-b",
          sourceEventId: "b-999",
          leagueName: "Test Ligi",
          homeTeam: "Alpha",
          awayTeam: "Beta",
          commenceTime: "2026-08-29T19:02:00.000Z",
          phase: "prematch",
          lastOddsCheckAt: "2026-08-29T17:59:00.000Z",
        },
        {
          provider: "provider-a",
          sourceEventId: "old-live",
          leagueName: "Test Ligi",
          homeTeam: "Old",
          awayTeam: "Game",
          commenceTime: "2026-08-29T15:00:00.000Z",
          phase: "live",
          lastOddsCheckAt: "2026-08-29T16:00:00.000Z",
        },
        {
          provider: "provider-a",
          sourceEventId: "finished-prematch",
          leagueName: "Test Ligi",
          homeTeam: "Finished",
          awayTeam: "Match",
          commenceTime: "2026-08-29T16:00:00.000Z",
          phase: "prematch",
        },
      ],
      oddsHistory: [
        { ...quoteBase, provider: "provider-a", sourceEventId: "a-101", bookmakerKey: "book-a", bookmaker: "Book A", price: 2.00 },
        { ...quoteBase, provider: "provider-a", sourceEventId: "a-101", bookmakerKey: "book-b", bookmaker: "Book B", price: 2.02 },
        { ...quoteBase, provider: "provider-b", sourceEventId: "b-999", bookmakerKey: "book-c", bookmaker: "Book C", price: 2.04 },
        { ...quoteBase, provider: "provider-b", sourceEventId: "b-999", bookmakerKey: "book-d", bookmaker: "Book D", price: 2.18 },
        { ...quoteBase, provider: "provider-a", sourceEventId: "old-live", event: "Old - Game", phase: "live" as const, bookmakerKey: "old", bookmaker: "Old Book", price: 2.50 },
        { ...quoteBase, provider: "provider-a", sourceEventId: "finished-prematch", event: "Finished - Match", bookmakerKey: "fin", bookmaker: "Fin Book", price: 2.40 },
      ],
      signals: [],
    };

    await mirror.sync(dataset);

    const valuesCall = calls.find((call) => call.url.endsWith("values:batchUpdate"));
    const body = JSON.parse(String(valuesCall?.init?.body));
    const today = body.data.find((item: { range: string }) => item.range === "'BUGUN_NE_OYNANIR'!A1");
    const matches = body.data.find((item: { range: string }) => item.range === "'Maclar'!A1");
    const goals = body.data.find((item: { range: string }) => item.range === "'Gol_Alt_Ust'!A1");

    expect(today.values).toHaveLength(2);
    expect(today.values[1][3]).toContain("Alpha");
    expect(matches.values).toHaveLength(2);
    expect(goals.values).toHaveLength(2);
    expect(goals.values[1][8]).toBe(4);
    expect(JSON.stringify(body.data)).not.toContain("Old - Game");
    expect(JSON.stringify(body.data)).not.toContain("Finished - Match");

    const prepareCall = calls.find((call) => call.url.endsWith(":batchUpdate") && String(call.init?.body).includes("updateSheetProperties"));
    const prepareBody = JSON.parse(String(prepareCall?.init?.body));
    expect(prepareBody.requests.some((request: { updateSheetProperties?: { properties?: { hidden?: boolean } } }) => request.updateSheetProperties?.properties?.hidden === true)).toBe(true);
  });
});
