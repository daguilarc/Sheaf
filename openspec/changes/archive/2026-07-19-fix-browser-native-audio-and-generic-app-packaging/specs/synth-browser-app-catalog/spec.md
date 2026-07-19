## MODIFIED Requirements

### Requirement: sbac-10 — Distribution: first-party catalog and package
WHEN the synth browser publication artifacts are assembled, THE repository SHALL generate a first-party `sheaf` catalog containing every configured application, publish that catalog and its immutable application packages through GitHub Pages, configure the production Cloudflare launcher to trust the stable GitHub Pages catalog URL, and retain a relative catalog source for localhost development.

#### Scenario: Production page is only a launcher
- **WHEN** the deployed Cloudflare site is opened before selection
- **THEN** it displays the SheafPatch catalog launcher
- **AND** it does not auto-load or name a concrete application in generic launcher/runtime source code

#### Scenario: First source points back to the Sheaf publisher
- **WHEN** the production Cloudflare launcher fetches its first configured source
- **THEN** it reads the catalog published by this repository at `https://jvictor0.github.io/Sheaf/catalogs/sheaf/catalog.json`
- **AND** selecting Mini App or Braid 4 loads that app's immutable package from the same GitHub Pages publisher

#### Scenario: Local development remains self-contained
- **WHEN** the launcher is built and served for localhost development
- **THEN** its checked-in source list resolves to the locally built first-party catalog
- **AND** local testing does not require a live GitHub Pages deployment
