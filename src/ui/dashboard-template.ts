import { dashboardClient } from "./dashboard-client.js";
import { dashboardShell } from "./dashboard-components.js";
import { dashboardStyles } from "./dashboard-styles.js";

export const dashboardHtml = String.raw`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#080c12">
  <title>Oran Eşleştirme Botu · Production Dashboard</title>
  <style>${dashboardStyles}</style>
</head>
<body>
${dashboardShell}
<script>${dashboardClient}</script>
</body>
</html>`;
