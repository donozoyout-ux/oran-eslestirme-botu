import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { OddsMonitor } from "./monitor.js";

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function createServer(monitor: OddsMonitor, adminToken?: string): http.Server {
  return http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "oran-eslestirme-botu", timestamp: new Date().toISOString() });
      return;
    }

    if (method === "GET" && url.pathname === "/status") {
      sendJson(response, 200, monitor.getStatus());
      return;
    }

    if (method === "POST" && url.pathname === "/run-once") {
      if (!adminToken) {
        sendJson(response, 404, { error: "Bu uc devre disi." });
        return;
      }
      if (bearerToken(request) !== adminToken) {
        sendJson(response, 401, { error: "Yetkisiz." });
        return;
      }
      try {
        sendJson(response, 200, await monitor.runOnce());
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    sendJson(response, 404, { error: "Bulunamadi." });
  });
}
