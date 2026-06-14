## MODIFIED Requirements

### Requirement: svc-13 — Vendor asset allowlist

THE service SHALL serve vendor assets only from the explicit allowlist for Markdown-it, KaTeX JavaScript/CSS, KaTeX font files, Highlight.js JavaScript, and Highlight.js theme CSS under `/assets/vendor/`; any unlisted vendor path SHALL return 404.

#### Scenario: Allowlisted vendor asset

- **WHEN** a request is received for a vendor path in the explicit allowlist (Markdown-it, KaTeX JS/CSS, KaTeX font files, Highlight.js JavaScript, or Highlight.js theme CSS)
- **THEN** the service serves the corresponding file

#### Scenario: Unlisted vendor path

- **WHEN** a request is received for a `/assets/vendor/` path not in the explicit allowlist
- **THEN** the service returns 404
