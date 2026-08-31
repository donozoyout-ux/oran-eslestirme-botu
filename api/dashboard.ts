import { dashboardHtml } from "../src/dashboard.js";

export default function handler(_request: any, response: any): void {
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-cache");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(dashboardHtml);
}
