import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailySheetDataset } from "../src/daily-match-sheet.js";
import { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("biten maclari siler ve ana sekmede ayni maci tek satir gosterir", async () => {
    vi.setSystemTime(new Date("2026-08-29T17:00:00.000Z"));
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

    const activeBase = {
      capturedAt: "2026-08-29T16:55:00.000Z",
      provider: "test",
      sourceEventId: "event-1",
      event: "A - B",
      phase: "prematch" as const,
      period: "full_time",
      sourceUpdatedAt: "2026-08-29T16:55:00.000Z",
    };
    const finishedBase = {
      ...activeBase,
      sourceEventId: "event-finished",
      event: "C - D",
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
          sourceUrl: "https://example.com/a-b",
        },
        {
          provider: "test",
          sourceEventId: "event-finished",
          leagueName: "Test Ligi",
          homeTeam: "C",
          awayTeam: "D",
          commenceTime: "2026-08-29T15:00:00.000Z",
          phase: "prematch",
          sourceUrl: "https://example.com/c-d",
        },
      ],
      oddsHistory: [
        { ...activeBase, bookmakerKey: "book-a", bookmaker: "Book A", marketKey: "total_goals", market: "Toplam Gol", selectionKey: "over", selection: "Üst", line: 2.5, price: 2.00 },
        { ...activeBase, bookmakerKey: "book-b", bookmaker: "Book B", marketKey: "total_goals", market: "Toplam Gol", selectionKey: "over", selection: "Üst", line: 2.5, price: 2.02 },
        { ...activeBase, bookmakerKey: "book-c", bookmaker: "Book C", marketKey: "total_goals", market: "Toplam Gol", selectionKey: "over", selection: "Üst", line: 2.5, price: 2.16 },
        { ...activeBase, bookmakerKey: "book-a", bookmaker: "Book A", marketKey: "match_winner_3way", market: "Maç Sonucu", selectionKey: "home", selection: "1", line: null, price: 2.10 },
        { ...activeBase, bookmakerKey: "book-b", bookmaker: "Book B", marketKey: "match_winner_3way", market: "Maç Sonucu", selectionKey: "home", selection: "1", line: null, price: 2.12 },
        { ...activeBase, bookmakerKey: "book-c", bookmaker: "Book C", marketKey: "match_winner_3way", market: "Maç Sonucu", selectionKey: "home", selection: "1", line: null, price: 2.20 },
        { ...finishedBase, bookmakerKey: "book-a", bookmaker: "Book A", marketKey: "total_goals", market: "Toplam Gol", selectionKey: "over", selection: "Üst", line: 2.5, price: 2.50 },
      ],
      signals: [],
    };

    await mirror.sync(dataset);

    const valuesCall = calls.find((call) => call.url.endsWith("values:batchUpdate"));
    const body = JSON.parse(String(valuesCall?.init?.body));
    expect(body.data[0].range).toBe("'BUGUN_NE_OYNANIR'!A1");
    expect(body.data[0].values[0]).toEqual(["SIRA", "DURUM", "KARAR", "MAÇ", "NE OYNANIR?", "ORAN", "BOOKMAKER", "GÜVEN", "KISA NEDEN"]);
    expect(body.data[0].values).toHaveLength(2);
    expect(body.data[0].values[1][3]).toBe("A - B");
    expect(JSON.stringify(body.data)).not.toContain("C - D");

    const matchesSheet = body.data.find((item: { range: string }) => item.range === "'Maclar'!A1");
    expect(matchesSheet.values).toHaveLength(2);
    expect(matchesSheet.values[1][3]).toBe("A");
  });
});
