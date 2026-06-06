# Web Docs

## Overview

The `web` project provides shared presentation assets for command hub browser
interfaces. It does not own service logic, REST APIs, lifecycle behavior, or
project-specific browser JavaScript.

## Shared CSS

`src/sheaf.css` is the shared stylesheet for command hub UIs. It defines:

- CSS custom properties for background, surface, text, accent, and status colors
- Base page layout (`.sheaf-page`, `.sheaf-header`)
- Cards and tables (`.sheaf-card`, `.sheaf-table`)
- Health badges (`.sheaf-status--healthy`, `.sheaf-status--unhealthy`)
- Buttons (`.sheaf-button`, `.sheaf-button--primary`)
- Log viewer styling (`.sheaf-log-view`)

## How Conductor Consumes Shared Assets

Conductor serves shared CSS from the repository copy of this project:

```text
GET /assets/web/sheaf.css  →  projects/web/src/sheaf.css
```

Conductor HTML templates link that URL in `<link rel="stylesheet">` tags. Conductor
browser JavaScript and page-specific markup live under `projects/conductor/src/ui/` and
are served separately at `/assets/conductor/*`.

Other service projects with browser UIs can link the same stylesheet path if their
backend exposes the file from `projects/web/src/`, or copy the asset URL pattern
Conductor uses.

## Adding Shared Assets

Place new shared static files under `src/`. Document new surfaces here when they are
added. Keep project-specific UI logic, API calls, and service controls in the consuming
project, not in `projects/web/`.
