import { describe, expect, it } from "vitest";
import { googleResultsArchiveInternals } from "../src/google-results-archive.js";

type Row = Array<string | number | boolean>;

function detail(date: string, result: string, match: string, detectedAt: string): Row {
  return [
    date,
    "İZLE",
    result,
    match,
    "Toplam Gol",
    "Üst",
    2.5,
    1.95,
    "Bookmaker",
    "72/100",
    2.8,
    3,
    result === "BEKLEMEDE" ? "" : "2-1",
    detectedAt,
    result === "BEKLEMEDE" ? "" : detectedAt,
    result === "BEKLEMEDE" ? "" : "football_data",
  ];
}

describe("Google results archive", () => {
  it("restart sonrasi eski Sheet satirlarini yeni local state ile birlestirir", () => {
    const archived = [detail("2026-08-31", "DOĞRU", "A - B", "2026-08-31T10:00:00Z")];
    const current = [detail("2026-09-01", "BEKLEMEDE", "C - D", "2026-09-01T10:00:00Z")];
    const merged = googleResultsArchiveInternals.mergeDetails(archived, current);
    const rows = googleResultsArchiveInternals.buildRows(merged);

    expect(merged).toHaveLength(2);
    expect(rows[1]).toEqual(expect.arrayContaining(["Toplam", 2, "Doğru", 1]));
    expect(rows.some((row) => row.includes("A - B"))).toBe(true);
    expect(rows.some((row) => row.includes("C - D"))).toBe(true);
  });

  it("ayni macin guncel sonucunu eski bekleyen satirin ustune yazar", () => {
    const archived = [detail("2026-09-01", "BEKLEMEDE", "Hull City - Swansea City", "2026-09-01T18:00:00Z")];
    const current = [detail("2026-09-01", "YANLIŞ", "Hull City - Swansea City", "2026-09-01T18:00:00Z")];
    const merged = googleResultsArchiveInternals.mergeDetails(archived, current);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.[2]).toBe("YANLIŞ");
  });
});
