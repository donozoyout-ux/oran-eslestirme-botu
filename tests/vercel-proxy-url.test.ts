import { describe, expect, it } from "vitest";

function normalizeBackendUrl(raw: string | undefined): { baseUrl: string | null; host: string | null; error: string | null } {
  const value = raw?.trim();
  if (!value) return { baseUrl: null, host: null, error: "missing" };
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { baseUrl: null, host: parsed.hostname || null, error: "protocol" };
    if (parsed.hostname.endsWith('.railway.internal')) return { baseUrl: null, host: parsed.hostname, error: "internal" };
    return { baseUrl: candidate.replace(/\/+$/, ""), host: parsed.hostname, error: null };
  } catch {
    return { baseUrl: null, host: null, error: "invalid" };
  }
}

describe("Vercel Railway backend URL", () => {
  it("https yazilmayan Railway public domainine otomatik https ekler", () => {
    expect(normalizeBackendUrl("oran-botu.up.railway.app")).toEqual({
      baseUrl: "https://oran-botu.up.railway.app",
      host: "oran-botu.up.railway.app",
      error: null,
    });
  });

  it("Railway internal domainini Vercel backend olarak reddeder", () => {
    const result = normalizeBackendUrl("oran-eslestirme-botu.railway.internal");
    expect(result.baseUrl).toBeNull();
    expect(result.error).toBe("internal");
  });
});
