const ALLOWED_PATHS = new Set([
  "health",
  "status",
  "daily-matches.csv",
  "odds-history.csv",
]);

interface BackendTarget {
  baseUrl: string | null;
  host: string | null;
  error: string | null;
}

function backendTarget(): BackendTarget {
  const raw = process.env.BACKEND_URL?.trim();
  if (!raw) {
    return {
      baseUrl: null,
      host: null,
      error: "Vercel BACKEND_URL ayarlanmamis.",
    };
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { baseUrl: null, host: parsed.hostname || null, error: "BACKEND_URL http veya https olmali." };
    }
    if (parsed.hostname.endsWith('.railway.internal')) {
      return {
        baseUrl: null,
        host: parsed.hostname,
        error: "Railway internal adresi Vercel'den erisilemez. Public *.up.railway.app domain kullanin.",
      };
    }
    return {
      baseUrl: candidate.replace(/\/+$/, ""),
      host: parsed.hostname,
      error: null,
    };
  } catch {
    return {
      baseUrl: null,
      host: null,
      error: "BACKEND_URL gecersiz. Railway public domainini kullanin.",
    };
  }
}

export default async function handler(request: any, response: any): Promise<void> {
  const path = typeof request.query?.path === "string" ? request.query.path : "";
  if (!ALLOWED_PATHS.has(path)) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Bulunamadi." }));
    return;
  }

  const backend = backendTarget();
  if (!backend.baseUrl) {
    response.statusCode = 503;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({
      error: backend.error,
      backendHost: backend.host,
      hint: "BACKEND_URL degeri Railway public servis adresi olmali. https:// yazmasaniz da artik otomatik eklenir.",
    }));
    return;
  }

  try {
    const upstream = await fetch(`${backend.baseUrl}/${path}`, {
      method: "GET",
      headers: { accept: request.headers?.accept ?? "*/*" },
      signal: AbortSignal.timeout(15_000),
    });

    const body = Buffer.from(await upstream.arrayBuffer());
    response.statusCode = upstream.status;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-backend-host", backend.host ?? "unknown");

    const contentType = upstream.headers.get("content-type");
    const contentDisposition = upstream.headers.get("content-disposition");
    if (contentType) response.setHeader("content-type", contentType);
    if (contentDisposition) response.setHeader("content-disposition", contentDisposition);
    response.end(body);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({
      error: "Railway backend'e ulasilamadi.",
      backendHost: backend.host,
      detail: error instanceof Error ? error.message : String(error),
    }));
  }
}
