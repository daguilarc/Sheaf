/**
 * Shared helpers for dashboard detail pages (unit-tested with Node).
 */

export function EscapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ParseDashboardTimestamp(value) {
  if (value == null || value === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function Pluralize(value, unit) {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function FormatDashboardTimestamp(value) {
  const date = ParseDashboardTimestamp(value);
  if (!date) {
    return EscapeHtml(value || "—");
  }
  return EscapeHtml(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  );
}

export function FormatRelativeAge(value, now = new Date()) {
  const date = ParseDashboardTimestamp(value);
  if (!date) {
    return "";
  }
  const deltaSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  let amount;
  let unit;
  if (absSeconds < 60) {
    amount = absSeconds;
    unit = "second";
  } else if (absSeconds < 3600) {
    amount = Math.round(absSeconds / 60);
    unit = "minute";
  } else if (absSeconds < 86400) {
    amount = Math.round(absSeconds / 3600);
    unit = "hour";
  } else {
    amount = Math.round(absSeconds / 86400);
    unit = "day";
  }
  const label = Pluralize(amount, unit);
  return deltaSeconds < 0 ? `in ${label}` : `${label} ago`;
}

export function FormatDashboardTimestampWithAge(value, now = new Date()) {
  const date = ParseDashboardTimestamp(value);
  if (!date) {
    return EscapeHtml(value || "—");
  }
  return `${FormatDashboardTimestamp(value)} <span class="dash-muted">(${EscapeHtml(
    FormatRelativeAge(value, now)
  )})</span>`;
}

/**
 * Renders quest ``last_transition`` from API (legacy or metadata-backed).
 */
export function FormatQuestLastTransitionHtml(lt) {
  if (!lt) return "—";
  let body = `${FormatDashboardTimestamp(lt.timestamp)}: ${EscapeHtml(lt.previous_state)} → ${EscapeHtml(
    lt.next_state
  )}`;
  if (lt.global_step != null) {
    body += ` <span class="dash-muted">(step ${EscapeHtml(String(lt.global_step))})</span>`;
  }
  if (lt.child_chain && lt.child_chain.length > 1) {
    const c = lt.child_chain[1];
    body += ` · slice: ${EscapeHtml(c.state_before)} → ${EscapeHtml(c.state_after)}`;
  }
  return body;
}

function RenderInlineMarkdown(text) {
  let out = EscapeHtml(text);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

/**
 * Mirrors server `render_dashboard_markdown`: safe lightweight markdown rendering.
 */
export function MarkdownToSafeHtml(markdown) {
  if (markdown == null || markdown === "") {
    return '<div class="dashboard-markdown"></div>';
  }
  const lines = String(markdown).split(/\r?\n/);
  let html = "";
  let paragraph = [];
  let listItems = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const joined = paragraph.map((line) => line.trim()).filter(Boolean).join(" ");
    if (joined) {
      html += `<p>${RenderInlineMarkdown(joined)}</p>`;
    }
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    html += `<ul>${listItems.join("")}</ul>`;
    listItems = [];
  };

  const flushCode = () => {
    html += `<pre><code>${EscapeHtml(codeLines.join("\n"))}</code></pre>`;
    codeLines = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\n$/, "");
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!stripped) {
      flushParagraph();
      flushList();
      continue;
    }
    if (stripped.startsWith("#")) {
      flushParagraph();
      flushList();
      const level = Math.min((stripped.match(/^#+/) || [""])[0].length, 6);
      const content = stripped.slice(level).trim();
      html += `<h${level}>${RenderInlineMarkdown(content)}</h${level}>`;
      continue;
    }
    if (stripped.startsWith("- ") || stripped.startsWith("* ")) {
      flushParagraph();
      listItems.push(`<li>${RenderInlineMarkdown(stripped.slice(2).trim())}</li>`);
      continue;
    }
    paragraph.push(line);
  }

  if (inCode) {
    flushCode();
  }
  flushParagraph();
  flushList();
  return `<div class="dashboard-markdown">${html}</div>`;
}

export function PlanFileStorageKey(project, questType, questNumber, sliceNumber) {
  return `dash.planFile:v1|${project}|${questType}|${questNumber}|${sliceNumber}`;
}

export function SelectPlanFile(filenames, storedName) {
  if (!filenames || filenames.length === 0) {
    return null;
  }
  if (storedName && filenames.includes(storedName)) {
    return storedName;
  }
  return filenames[0];
}

export function FileLabelForDiff(f) {
  if (!f) return "";
  if (f.path_before && f.path_before !== f.path) {
    return `${f.path_before} → ${f.path}`;
  }
  return f.path || "";
}

/**
 * Build grid rows for two-panel diff from API `rows` (see parse_unified_diff_to_rows).
 */
export function BuildDiffRowsHtml(rows) {
  if (!rows || !rows.length) {
    return "";
  }
  let html = "";
  for (const row of rows) {
    const k = row.kind;
    if (k === "hunk_header") {
      html += `<div class="dash-diff-hunk" role="presentation">${EscapeHtml(row.text || "")}</div>`;
      continue;
    }
    if (k === "context") {
      const o = row.old;
      const n = row.new;
      html += `<div class="dash-diff-row dash-diff-row--ctx">
        <div class="dash-diff-gutter">${o ? EscapeHtml(String(o.line_no)) : ""}</div>
        <div class="dash-diff-cell dash-diff-cell--old">${EscapeHtml(o ? o.text : "")}</div>
        <div class="dash-diff-gutter">${n ? EscapeHtml(String(n.line_no)) : ""}</div>
        <div class="dash-diff-cell dash-diff-cell--new">${EscapeHtml(n ? n.text : "")}</div>
      </div>`;
      continue;
    }
    if (k === "removal") {
      const o = row.old;
      html += `<div class="dash-diff-row dash-diff-row--del">
        <div class="dash-diff-gutter">${o ? EscapeHtml(String(o.line_no)) : ""}</div>
        <div class="dash-diff-cell dash-diff-cell--old dash-diff-cell--del">${EscapeHtml(
          o ? o.text : ""
        )}</div>
        <div class="dash-diff-gutter"></div>
        <div class="dash-diff-cell dash-diff-cell--new"></div>
      </div>`;
      continue;
    }
    if (k === "addition") {
      const n = row.new;
      html += `<div class="dash-diff-row dash-diff-row--add">
        <div class="dash-diff-gutter"></div>
        <div class="dash-diff-cell dash-diff-cell--old"></div>
        <div class="dash-diff-gutter">${n ? EscapeHtml(String(n.line_no)) : ""}</div>
        <div class="dash-diff-cell dash-diff-cell--new dash-diff-cell--add">${EscapeHtml(
          n ? n.text : ""
        )}</div>
      </div>`;
      continue;
    }
    html += `<div class="dash-diff-row dash-diff-row--other">
      <div class="dash-diff-span4">${EscapeHtml(row.text || "")}</div>
    </div>`;
  }
  return html;
}
