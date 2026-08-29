import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailySheetDataset } from "../src/daily-match-sheet.js";
import { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const sheetMetadata = {
  sheets: [
    { properties: { sheetId: 1, title: "Pazar_Ozeti" } },
    { properties: { sheetId: 2, title: "Gol_Alt_Ust" } },
    { properties: { sheetId: 3, title: "Kornerler" } },
    { properties: { sheetId: 4, title: "Kartlar" } },
    { properties: { sheetId: 5, title: "Maclar" } },
    { properties: { sheetId: 6, title: "Oran_Gecmisi" } },
    { properties: { sheetId: 7, title: "Sinyaller" } },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Sheets aynasi", () => {
  it("Render'daki kacisli veya tum JSON anahtarini PEM olarak kullanir", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const privateKeyWithEscapedNewlines = pem.replaceAll("\n", "\\n");
    let metadataReads = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
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

    const mirror = new GoogleSheetsMirror({
      spreadsheetId: "1234567890abcdefghijklmnopqrstuv",
      serviceAccountEmail: "bot@example.iam.gserviceaccount.com",
      privateKey: JSON.stringify({ type: "service_account", private_key: privateKeyWithEscapedNewlines }),
    });
    await mirror.sync({ date: "2026-08-29", fixtures: [], oddsHistory: [], signals: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("oauth2.googleapis.com"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pazar ozetini ve gol/korner/kart sekmelerini ham veriden uretir", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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

    const mirror = new GoogleSheetsMirror({
      spreadsheetId: "1234567890abcdefghijklmnopqrstuv",
      serviceAccountEmail: "bot@example.iam.gserviceaccount.com",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });

    const base = {
      capturedAt: "2026-08-29T12:00:00.000Z",
      provider: "test",
      sourceEventId: "event-1",
      event: "A - B",
      phase: "prematch" as const,
      period: "full_time",
      bookmakerKey: "book-a",
      bookmaker: "Book A",
      sourceUpdatedAt: "2026-08-29T12:00:00.000Z",
    };

    const dataset: DailySheetDataset = {
      date: "2026-08-29",
      fixtures: [
        {
          provider: "test",
          sourceEventId: "event-1",
          leagueName: "Test Ligi",
          homeTeam: "A",
          awayTeam: "B",
          commenceTime: "2026-08-29T18:00:00.000Z",
          phase: "prematch",
          sourceUrl: "https://example.com/match",
        },
      ],
      oddsHistory: [
        { ...base, marketKey: "total_goals", market: "Toplam Gol", selectionKey: "over", selection: "Ust", line: 2.5, price: 2.34 },
        { ...base, bookmakerKey: "book-b", bookmaker: "Book B", marketKey: "total_goals", market: "Toplam Gol", selectionKey: "over", selection: "Ust", line: 2.5, price: 2.42 },
        { ...base, marketKey: "corners", market: "Toplam Korner", selectionKey: "over", selection: "Ust", line: 9.5, price: 1.91 },
        { ...base, marketKey: "cards", market: "Toplam Kart", selectionKey: "under", selection: "Alt", line: 4.5, price: 1.84 },
      ],
      signals: [],
    };

    await mirror.sync(dataset);

    const valuesCall = calls.find((call) => call.url.endsWith("values:batchUpdate"));
    const body = JSON.parse(String(valuesCall?.init?.body));
    expect(body.data.map((item: { range: string }) => item.range)).toEqual([
      "'Pazar_Ozeti'!A1",
      "'Gol_Alt_Ust'!A1",
      "'Kornerler'!A1",
      "'Kartlar'!A1",
      "'Maclar'!A1",
      "'Oran_Gecmisi'!A1",
      "'Sinyaller'!A1",
    ]);

    expect(body.data[0].values[0]).toContain("En Iyi Oran");
    expect(body.data[0].values[1][6]).toBe(2.42);
    expect(body.data[1].values).toHaveLength(3);
    expect(body.data[2].values[1][2]).toBe("Toplam Korner");
    expect(body.data[3].values[1][2]).toBe("Toplam Kart");
    expect(mirror.url).toContain("1234567890abcdefghijklmnopqrstuv");
  });
});
