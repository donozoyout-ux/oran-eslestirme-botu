import { describe, expect, it } from "vitest";
import { enableSafeGoogleSheetRefresh, googleSheetSafeRefreshInternals } from "../src/google-sheets-safe-refresh.js";
import type { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";

interface Call {
  url: string;
  body?: string;
}

describe("Google Sheets safe refresh", () => {
  it("yeni veri yazilinca yalnizca alt tarafta kalan eski satirlari temizler", async () => {
    const calls: Call[] = [];
    const fake = {
      async request(url: string, _token: string, init: RequestInit = {}) {
        calls.push({ url, body: typeof init.body === "string" ? init.body : undefined });
        return {};
      },
    } as unknown as GoogleSheetsMirror;

    const patched = enableSafeGoogleSheetRefresh(fake) as unknown as {
      request(url: string, token: string, init?: RequestInit): Promise<unknown>;
    };

    await patched.request("https://sheets.googleapis.com/v4/spreadsheets/x/values:batchClear", "t", {
      method: "POST",
      body: JSON.stringify({ ranges: ["'Maclar'!A:Z"] }),
    });
    expect(calls).toHaveLength(0);

    await patched.request("https://sheets.googleapis.com/v4/spreadsheets/x/values:batchUpdate", "t", {
      method: "POST",
      body: JSON.stringify({
        data: [
          { range: "'Maclar'!A1", values: [["header"], ["m1"], ["m2"]] },
          { range: "'Sinyaller'!A1", values: [["header"]] },
        ],
      }),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("values:batchUpdate");
    expect(calls[1]?.url).toContain("values:batchClear");
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      ranges: ["'Maclar'!A4:Z", "'Sinyaller'!A2:Z"],
    });
  });

  it("batchUpdate basarisizsa clear istegini hic gondermez", async () => {
    const calls: string[] = [];
    const fake = {
      async request(url: string) {
        calls.push(url);
        if (url.includes("batchUpdate")) throw new Error("write failed");
        return {};
      },
    } as unknown as GoogleSheetsMirror;

    const patched = enableSafeGoogleSheetRefresh(fake) as unknown as {
      request(url: string, token: string, init?: RequestInit): Promise<unknown>;
    };
    await patched.request("https://sheets.googleapis.com/v4/spreadsheets/x/values:batchClear", "t", {
      method: "POST",
      body: JSON.stringify({ ranges: ["'Maclar'!A:Z"] }),
    });

    await expect(patched.request("https://sheets.googleapis.com/v4/spreadsheets/x/values:batchUpdate", "t", {
      method: "POST",
      body: JSON.stringify({ data: [{ range: "'Maclar'!A1", values: [["header"]] }] }),
    })).rejects.toThrow("write failed");

    expect(calls).toEqual(["https://sheets.googleapis.com/v4/spreadsheets/x/values:batchUpdate"]);
  });

  it("tail araliklarini batchUpdate satir sayisindan hesaplar", () => {
    expect(googleSheetSafeRefreshInternals.tailRangesFromBatchUpdate(JSON.stringify({
      data: [{ range: "'Maclar'!A1", values: [[1], [2], [3], [4]] }],
    }))).toEqual(["'Maclar'!A5:Z"]);
  });
});
