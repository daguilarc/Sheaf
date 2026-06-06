# Web Docs

## Current State

The `web` project provides shared presentation assets for command hub browser
interfaces. It does not own service logic or quest work.

## Shared CSS

`src/sheaf.css` is the initial shared stylesheet. Conductor and other services
with browser UIs can reference it from their HTML rather than duplicating generic
layout, typography, and color tokens.

### Usage

Serve or link to `projects/web/src/sheaf.css` from a project UI. Conductor will
wire this path in a later slice when the web UI is implemented.

### Tokens

The stylesheet defines CSS custom properties for background, text, accent, and
status colors so project UIs can stay visually consistent across services.
