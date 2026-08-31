import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googleOauthCompatInternals,
  installGoogleOauthGrantTypeFix,
  rewriteGoogleOauthInit,
} from "../src/google-oauth-compat.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google OAuth compatibility", () => {
  it("service-account JWT grant type icindeki hatali oauth2 degerini Google'in kabul ettigi oauth degerine cevirir", () => {
    const body = new URLSearchParams({
      grant_type: googleOauthCompatInternals.WRONG_GRANT_TYPE,
      assertion: "signed-jwt",
    });

    const rewritten = rewriteGoogleOauthInit({ method: "POST", body });
    const rewrittenBody = rewritten?.body as URLSearchParams;

    expect(rewrittenBody.get("grant_type")).toBe(googleOauthCompatInternals.CORRECT_GRANT_TYPE);
    expect(rewrittenBody.get("assertion")).toBe("signed-jwt");
  });

  it("yalnizca Google token endpoint'indeki istegi duzeltir", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    installGoogleOauthGrantTypeFix();

    await fetch(googleOauthCompatInternals.GOOGLE_TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: googleOauthCompatInternals.WRONG_GRANT_TYPE,
        assertion: "signed-jwt",
      }),
    });
    await fetch("https://example.com/api", {
      method: "POST",
      body: new URLSearchParams({ grant_type: googleOauthCompatInternals.WRONG_GRANT_TYPE }),
    });

    const googleBody = fetchMock.mock.calls[0]![1]?.body as URLSearchParams;
    const otherBody = fetchMock.mock.calls[1]![1]?.body as URLSearchParams;
    expect(googleBody.get("grant_type")).toBe(googleOauthCompatInternals.CORRECT_GRANT_TYPE);
    expect(otherBody.get("grant_type")).toBe(googleOauthCompatInternals.WRONG_GRANT_TYPE);
  });
});
