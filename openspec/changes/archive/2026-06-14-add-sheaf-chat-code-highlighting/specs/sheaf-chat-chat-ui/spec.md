## MODIFIED Requirements

### Requirement: ui-1 — Shell and routing: dependency-free first-party scripts

THE UI SHALL be dependency-free first-party scripts that render into `#app` in `src/ui/index.html`, loading Markdown-it/KaTeX and Highlight.js vendor assets from `/assets/vendor/`, the shared renderer assets from `/assets/web/`, and its own assets from `/assets/sheaf-chat/`.

#### Scenario: UI loads assets

- **WHEN** the UI page is loaded
- **THEN** it renders into `#app` in `src/ui/index.html`, loading Markdown-it/KaTeX and Highlight.js vendor assets from `/assets/vendor/`, shared renderer assets from `/assets/web/`, and its own assets from `/assets/sheaf-chat/`
