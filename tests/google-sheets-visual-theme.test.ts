import { describe, expect, it, vi } from "vitest";
import type { GoogleSheetsMirror } from "../src/google-sheets-mirror.js";
import { enableGoogleSheetVisualTheme } from "../src/google-sheets-visual-theme.js";

describe("Google Sheets visual theme", () => {
  it("sekme renkleri, grid gizleme ve durum renklerini uygular", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const originalPrepare = vi.fn(async () => undefined);
    const fake = {
      url: "https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnopqrstuv/edit",
      prepareSheets: originalPrepare,
      async request(url: string, _token: string, init: RequestInit = {}) {
        calls.push({ url, body: typeof init.body === "string" ? init.body : undefined });
        return {};
      },
    } as unknown as GoogleSheetsMirror;

    const themed = enableGoogleSheetVisualTheme(fake) as unknown as {
      prepareSheets(token: string, tables: unknown[], sheetIds: Map<string, number>): Promise<void>;
    };

    await themed.prepareSheets("token", [
      {
        title: "BUGUN_NE_OYNANIR",
        rows: [
          ["SIRA", "DURUM", "KARAR", "MAÇ", "ORAN"],
          [1, "CANLI", "GÜÇLÜ ADAY", "Alpha - Beta", 2.1],
          [2, "YAKLAŞAN", "İZLE", "Gamma - Delta", 1.95],
        ],
        columnWidths: [60, 90, 120, 220, 80],
      },
    ], new Map([["BUGUN_NE_OYNANIR", 7]]));

    expect(originalPrepare).toHaveBeenCalledOnce();
    const visualCall = calls.find((call) => call.url.endsWith(":batchUpdate"));
    expect(visualCall).toBeTruthy();
    const body = JSON.parse(visualCall?.body ?? "{}");
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("tabColorStyle");
    expect(serialized).toContain("hideGridlines");
    expect(serialized).toContain("SOLID_THICK");
    expect(serialized).toContain("fontSize");
    expect(body.requests.some((request: { repeatCell?: { range?: { startRowIndex?: number; startColumnIndex?: number } } }) =>
      request.repeatCell?.range?.startRowIndex === 1 && request.repeatCell?.range?.startColumnIndex === 1)).toBe(true);
  });
});
