const ALLOWED_PATHS = new Set([
  "health",
  "status",
  "daily-matches.csv",
  "odds-history.csv",
]);

function backendBaseUrl(): string | null {
  const value = process.env.BACKEND_URL?.trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

export default async function handler(request: any, response: any): Promise<void> {
  const path = typeof request.query?.path === "string" ? request.query.path : "";
  if (!ALLOWED_PATHS.has(path)) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Bulunamadi." }));
    return;
  }

  const backend = backendBaseUrl();
  if (!backend) {
    response.statusCode = 503;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({
      error: "Vercel BACKEND_URL ayarlanmamis.",
      hint: "BACKEND_URL degeri Railway public servis adresi olmali.",
    }));
    return;
  }

  try {
    const upstream = await fetch(`${backend}/${path}`, {
      method: "GET",
      headers: { accept: request.headers?.accept ?? "*/*" },
      signal: AbortSignal.timeout(15_000),
    });

    const body = Buffer.from(await upstream.arrayBuffer());
    response.statusCode = upstream.status;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");

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
      detail: error instanceof Error ? error.message : String(error),
    }));
  }
}
