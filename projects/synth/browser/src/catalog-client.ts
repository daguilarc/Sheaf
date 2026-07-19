import {
  mergeCatalogs,
  parseCatalog,
  parseCatalogSources,
  type Catalog,
  type CatalogApp,
  type DuplicateAppDiagnostic,
} from "./catalog.js";

export type CatalogSourceDiagnostic = Readonly<{
  catalogUrl: string;
  status: "loaded" | "network-error" | "incompatible";
  appCount?: number;
  message?: string;
}>;

export type CatalogLoadResult = Readonly<{
  apps: readonly CatalogApp[];
  diagnostics: readonly CatalogSourceDiagnostic[];
  duplicateDiagnostics: readonly DuplicateAppDiagnostic[];
}>;

export type CatalogClientOptions = Readonly<{
  sourcesUrl: string;
  fetcher?: typeof fetch;
}>;

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CatalogClient {
  private readonly sourcesUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: CatalogClientOptions) {
    this.sourcesUrl = typeof location === "object"
      ? new URL(options.sourcesUrl, location.href).href
      : options.sourcesUrl;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async loadSources({ cacheMode }: { cacheMode: RequestCache }): Promise<CatalogLoadResult> {
    const sourcesResponse = await this.fetcher(this.sourcesUrl, { cache: cacheMode });
    if (!sourcesResponse.ok) throw new Error(`catalog sources unavailable: HTTP ${sourcesResponse.status}`);
    const sources = parseCatalogSources(await sourcesResponse.json(), this.sourcesUrl);
    const loaded = await Promise.all(sources.map(async ({ catalogUrl }) => {
      let response: Response;
      try {
        response = await this.fetcher(catalogUrl, { cache: cacheMode });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        return {
          diagnostic: Object.freeze({
            catalogUrl,
            status: "network-error" as const,
            message: messageFor(error),
          }),
        };
      }
      try {
        const catalog = parseCatalog(await response.json(), catalogUrl);
        return {
          catalog,
          diagnostic: Object.freeze({
            catalogUrl,
            status: "loaded" as const,
            appCount: catalog.apps.length,
          }),
        };
      } catch (error) {
        return {
          diagnostic: Object.freeze({
            catalogUrl,
            status: "incompatible" as const,
            message: messageFor(error),
          }),
        };
      }
    }));
    const catalogs = loaded.flatMap(({ catalog }) => catalog ? [catalog] : []) as Catalog[];
    const registry = mergeCatalogs(catalogs);
    return Object.freeze({
      apps: registry.apps,
      diagnostics: Object.freeze(loaded.map(({ diagnostic }) => diagnostic)),
      duplicateDiagnostics: registry.diagnostics,
    });
  }
}
