import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailySheetDataset } from "../src/daily-match-sheet.js";
import { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";

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
        return new Response(
          JSON.stringify(
            metadataReads === 1
              ? { sheets: [] }
              : {
                  sheets: [
                    { properties: { sheetId: 1, title: "Maclar" } },
                    { properties: { sheetId: 2, title: "Oran_Gecmisi" } },
                    { properties: { sheetId: 3, title: "Sinyaller" } },
                  ],
                },
          ),
          { status: 200 },
        );
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

  it("gerekli sekmeleri acar ve uc tabloyu ham degerlerle yazar", async () => {
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
        return new Response(
          JSON.stringify(
            metadataReads === 1
              ? { sheets: [] }
              : {
                  sheets: [
                    { properties: { sheetId: 1, title: "Maclar" } },
                    { properties: { sheetId: 2, title: "Oran_Gecmisi" } },
                    { properties: { sheetId: 3, title: "Sinyaller" } },
                  ],
                },
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const mirror = new GoogleSheetsMirror({
      spreadsheetId: "1234567890abcdefghijklmnopqrstuv",
      serviceAccountEmail: "bot@example.iam.gserviceaccount.com",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
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
        {
          capturedAt: "2026-08-29T12:00:00.000Z",
          provider: "test",
          sourceEventId: "event-1",
          event: "A - B",
          phase: "prematch",
          marketKey: "total_goals",
          market: "Toplam Gol",
          period: "full_time",
          selectionKey: "over",
          selection: "Üst",
          line: 2.5,
          bookmakerKey: "book-a",
          bookmaker: "Book A",
          price: 2.34,
          sourceUpdatedAt: "2026-08-29T12:00:00.000Z",
        },
      ],
      signals: [],
    };

    await mirror.sync(dataset);

    expect(calls.some((call) => call.url.endsWith("values:batchClear"))).toBe(true);
    const valuesCall = calls.find((call) => call.url.endsWith("values:batchUpdate"));
    const body = JSON.parse(String(valuesCall?.init?.body));
    expect(body.data.map((item: { range: string }) => item.range)).toEqual([
      "'Maclar'!A1",
      "'Oran_Gecmisi'!A1",
      "'Sinyaller'!A1",
    ]);
    expect(body.data[1].values[1][9]).toBe(2.34);
    expect(mirror.url).toContain("1234567890abcdefghijklmnopqrstuv");
  });
});
