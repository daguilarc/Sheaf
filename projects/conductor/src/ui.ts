import type { ServerResponse } from "node:http";

import { sendHtml } from "./static.js";
import {
  x_LogsJsAssetPath,
  x_MainJsAssetPath,
  x_SharedCssAssetPath,
} from "./ui_helpers.js";

function escapeHtml(value: string): string
{
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPageShell(
  title: string,
  bodyHtml: string,
  scriptPath: string,
): string
{
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${x_SharedCssAssetPath}">
</head>
<body>
  <div class="sheaf-page">
${bodyHtml}
  </div>
  <script src="${scriptPath}" defer></script>
</body>
</html>`;
}

export function renderMainPageHtml(): string
{
  const bodyHtml = `    <header class="sheaf-header">
      <h1>Conductor</h1>
      <p>Registered services from config/services.json</p>
    </header>
    <section class="sheaf-card">
      <div id="services-status" class="sheaf-muted" aria-live="polite">Loading services…</div>
      <div id="services-table-wrap" hidden>
        <table class="sheaf-table" id="services-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Health</th>
              <th>Last checked</th>
              <th>Uptime</th>
              <th>Warning</th>
              <th>Links</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="services-body"></tbody>
        </table>
      </div>
    </section>`;

  return renderPageShell("Conductor", bodyHtml, x_MainJsAssetPath);
}

export function renderLogsPageHtml(serviceName: string): string
{
  const escapedName = escapeHtml(serviceName);
  const bodyHtml = `    <header class="sheaf-header">
      <p><a href="/">← Back to services</a></p>
      <h1>Logs: ${escapedName}</h1>
      <p class="sheaf-muted">Select a log file to stream contents. File paths are sent over WebSocket only.</p>
    </header>
    <section class="sheaf-card" id="logs-panel">
      <div id="logs-status" class="sheaf-muted" aria-live="polite">Loading log files…</div>
      <div id="logs-controls" hidden>
        <label for="log-file-select">Log file</label>
        <select id="log-file-select" class="sheaf-button"></select>
        <label>
          <input type="checkbox" id="follow-toggle" checked>
          Follow new output
        </label>
        <button type="button" id="reopen-button" class="sheaf-button" hidden>Reopen file</button>
      </div>
      <div id="logs-error" class="sheaf-warning" hidden></div>
      <pre id="log-view" class="sheaf-log-view" hidden></pre>
    </section>
    <script type="application/json" id="service-name-data">${JSON.stringify(serviceName)}</script>`;

  return renderPageShell(`Logs: ${serviceName}`, bodyHtml, x_LogsJsAssetPath);
}

export function sendMainPage(response: ServerResponse): void
{
  sendHtml(response, renderMainPageHtml());
}

export function sendLogsPage(response: ServerResponse, serviceName: string): void
{
  sendHtml(response, renderLogsPageHtml(serviceName));
}
