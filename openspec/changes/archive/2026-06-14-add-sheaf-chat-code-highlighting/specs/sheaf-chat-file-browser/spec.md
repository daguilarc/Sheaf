## MODIFIED Requirements

### Requirement: fb-21 — Browser workspace: file rendering and error display

WHEN the selected file is Markdown, THE UI SHALL render it with Markdown-it and render supported math syntax through KaTeX; WHEN the selected file is another `text/*` type and its file extension maps to a supported highlight language, THE UI SHALL render an escaped syntax-highlighted preview; WHEN the selected file is another `text/*` type with no supported highlight mapping or highlighting is unavailable, THE UI SHALL show escaped plain text; IF a file cannot be fetched or is unsupported, THEN THE UI SHALL show the server error message or an unsupported-preview message in the file pane.

#### Scenario: Markdown file selected

- **WHEN** the selected file is Markdown
- **THEN** the UI renders it with Markdown-it and renders supported math syntax through KaTeX

#### Scenario: Highlighted text file selected

- **WHEN** the selected file is a `text/*` file whose extension maps to a supported highlight language
- **THEN** the UI renders an escaped syntax-highlighted preview for that language

#### Scenario: Unmapped text file selected

- **WHEN** the selected file is a `text/*` file whose extension does not map to a supported highlight language
- **THEN** the UI shows escaped plain text

#### Scenario: Highlighter unavailable

- **WHEN** the selected file is a `text/*` file whose extension maps to a supported highlight language but the highlighter is unavailable or fails
- **THEN** the UI shows escaped plain text

#### Scenario: File cannot be fetched or is unsupported

- **WHEN** a file cannot be fetched or is unsupported
- **THEN** the UI shows the server error message or an unsupported-preview message in the file pane

## ADDED Requirements

### Requirement: fb-25 — Browser workspace: initial syntax-highlight language map

THE UI SHALL map file extensions to the initial supported highlight languages as follows: C++ (`.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`, `.h++`, `.h`), Python (`.py`, `.pyw`), TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`), JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`), JSON (`.json`, `.jsonc`, `.json5`), XML/HTML (`.xml`, `.html`, `.htm`, `.xhtml`, `.svg`, `.plist`), YAML (`.yml`, `.yaml`), Swift (`.swift`), and Bash (`.sh`, `.bash`, `.zsh`).

#### Scenario: C++ source selected

- **WHEN** a file preview is opened for `example.cpp`
- **THEN** the UI uses the C++ highlight language

#### Scenario: JSON file selected

- **WHEN** a file preview is opened for `config.json`
- **THEN** the UI uses the JSON highlight language

#### Scenario: YAML file selected

- **WHEN** a file preview is opened for `workflow.yaml`
- **THEN** the UI uses the YAML highlight language

#### Scenario: Unsupported extension selected

- **WHEN** a file preview is opened for a text file with an extension outside the initial language map
- **THEN** the UI uses the plain-text fallback
