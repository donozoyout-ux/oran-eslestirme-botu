import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { legacyDashboardHtml, v2DashboardHtml } from "./dashboard.js";
import { buildV2Matches, buildV2Recommendations } from "./v2-api.js";
import type { OddsMonitor } from "./monitor.js";
import { getProviderDiagnostics } from "./provider-diagnostics.js";

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendDashboard(response: ServerResponse, html = v2DashboardHtml): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    "content-security-policy": "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(html);
}

function sendCsv(response: ServerResponse, filename: string, content: string): void {
  response.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(content);
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

    if (method === "GET" && (url.pathname === "/" || url.pathname === "/v2")) {
      sendDashboard(response);
      return;
    }

    if (method === "GET" && url.pathname === "/legacy") {
      sendDashboard(response, legacyDashboardHtml);
      return;
    }

    if (method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "public, max-age=86400" });
      response.end();
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "oran-eslestirme-botu", timestamp: new Date().toISOString() });
      return;
    }

    if (method === "GET" && url.pathname === "/status") {
      sendJson(response, 200, {
        ...monitor.getStatus(),
        providerDiagnostics: getProviderDiagnostics(),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/v2/matches") {
      sendJson(response, 200, buildV2Matches(monitor.getStatus()));
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/v2/matches/")) {
      const id = decodeURIComponent(url.pathname.slice("/v2/matches/".length));
      const match = buildV2Matches(monitor.getStatus()).matches.find((item) => item.canonicalEventId === id);
      if (!match) {
        sendJson(response, 404, { error: "Maç bulunamadı." });
        return;
      }
      sendJson(response, 200, match);
      return;
    }

    if (method === "GET" && url.pathname === "/v2/recommendations") {
      sendJson(response, 200, buildV2Recommendations(monitor.getStatus()));
      return;
    }

    if (method === "GET" && url.pathname === "/historical-pattern") {
      sendJson(response, 200, monitor.getStatus().historicalPattern);
      return;
    }

    if (method === "GET" && url.pathname === "/match-intelligence") {
      sendJson(response, 200, monitor.getStatus().matchIntelligence);
      return;
    }

    if (method === "GET" && url.pathname === "/daily-matches.csv") {
      sendCsv(response, "gunun-maclari.csv", monitor.getDailyFixturesCsv());
      return;
    }

    if (method === "GET" && url.pathname === "/odds-history.csv") {
      sendCsv(response, "oran-gecmisi.csv", monitor.getOddsHistoryCsv());
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
