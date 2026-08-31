const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const WRONG_GRANT_TYPE = "urn:ietf:params:oauth2:grant-type:jwt-bearer";
const CORRECT_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function rewriteGoogleOauthInit(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.body) return init;

  if (init.body instanceof URLSearchParams) {
    if (init.body.get("grant_type") !== WRONG_GRANT_TYPE) return init;
    const body = new URLSearchParams(init.body);
    body.set("grant_type", CORRECT_GRANT_TYPE);
    return { ...init, body };
  }

  if (typeof init.body === "string") {
    const params = new URLSearchParams(init.body);
    if (params.get("grant_type") !== WRONG_GRANT_TYPE) return init;
    params.set("grant_type", CORRECT_GRANT_TYPE);
    return { ...init, body: params.toString() };
  }

  return init;
}

export function installGoogleOauthGrantTypeFix(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (requestUrl(input) !== GOOGLE_TOKEN_URL) return originalFetch(input, init);
    return originalFetch(input, rewriteGoogleOauthInit(init));
  };
}

export const googleOauthCompatInternals = {
  GOOGLE_TOKEN_URL,
  WRONG_GRANT_TYPE,
  CORRECT_GRANT_TYPE,
};
