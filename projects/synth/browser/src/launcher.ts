import type { CatalogClient, CatalogLoadResult } from "./catalog-client.js";
import type { CatalogApp } from "./catalog.js";

type CatalogLoader = Pick<CatalogClient, "loadSources">;

export type SheafPatchLauncherOptions = Readonly<{
  client: CatalogLoader;
  select: (app: CatalogApp) => Promise<void>;
  navigateToLauncher?: () => void;
  ownsRoot?: () => boolean;
}>;

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Application launch failed";
}

export class SheafPatchLauncher {
  private result: CatalogLoadResult | undefined;
  private loadError: string | undefined;
  private loading = false;
  private selectionPending = false;
  private selectionComplete = false;
  private selectedId: string | undefined;
  private selectionError: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: SheafPatchLauncherOptions,
  ) {}

  async start(): Promise<void> {
    await this.load("default");
  }

  private ownsRoot(): boolean {
    return this.options.ownsRoot?.() ?? true;
  }

  private async load(cacheMode: RequestCache): Promise<void> {
    if (!this.ownsRoot() || this.loading || this.selectionPending || this.selectionComplete) return;
    this.loading = true;
    this.loadError = undefined;
    const loadingShell = this.render();
    try {
      this.result = await this.options.client.loadSources({ cacheMode });
    } catch (error) {
      this.loadError = errorMessage(error);
    } finally {
      this.loading = false;
      if (loadingShell && this.ownsRoot() && this.root.firstElementChild === loadingShell) this.render();
    }
  }

  private render(): HTMLElement | undefined {
    if (!this.ownsRoot()) return undefined;
    this.root.replaceChildren();
    const shell = element("section", "synth-launcher");
    shell.setAttribute("aria-labelledby", "synth-launcher-title");
    const header = element("header", "synth-launcher__header");
    const title = element("h1", "synth-launcher__title", "SheafPatch");
    title.id = "synth-launcher-title";
    header.append(title, element("p", "synth-launcher__subtitle", "Trusted browser applications"));
    shell.append(header);

    const status = element("p", "synth-launcher__status");
    status.setAttribute("role", "status");
    status.textContent = this.loading
      ? "Loading trusted catalogs…"
      : this.loadError
        ? `Catalog discovery failed: ${this.loadError}`
        : `${this.result?.apps.length ?? 0} applications available`;
    shell.append(status);

    if (this.result) {
      const apps = element("ul", "synth-launcher__apps");
      apps.setAttribute("aria-label", "Available applications");
      for (const app of this.result.apps) apps.append(this.renderApp(app));
      shell.append(apps);
      const failed = this.result.diagnostics.filter(({ status }) => status !== "loaded");
      if (failed.length > 0 || this.result.duplicateDiagnostics.length > 0) {
        const sources = element("section", "synth-launcher__sources");
        sources.append(element("h2", "synth-launcher__sources-title", "Catalog status"));
        const list = element("ul", "synth-launcher__diagnostics");
        for (const diagnostic of failed) {
          const state = diagnostic.status === "network-error" ? "Unavailable" : "Incompatible";
          list.append(element("li", "synth-launcher__diagnostic", `${diagnostic.catalogUrl} — ${state}: ${diagnostic.message ?? "unknown error"}`));
        }
        for (const diagnostic of this.result.duplicateDiagnostics) {
          list.append(element("li", "synth-launcher__diagnostic",
            `${diagnostic.rejectedCatalogUrl} — Duplicate ${diagnostic.globalId}; using ${diagnostic.acceptedCatalogUrl}`));
        }
        sources.append(list);
        shell.append(sources);
      }
    }

    if ((this.loadError || this.result?.diagnostics.some(({ status }) => status !== "loaded")) && !this.selectionComplete) {
      const retry = element("button", "synth-launcher__retry", "Retry catalogs");
      retry.type = "button";
      retry.disabled = this.loading;
      retry.addEventListener("click", () => { void this.load("no-cache"); });
      shell.append(retry);
    }

    if (this.selectionComplete) {
      const back = element("button", "synth-launcher__back", "Back to launcher");
      back.type = "button";
      back.addEventListener("click", () => (this.options.navigateToLauncher ?? (() => location.reload()))());
      shell.append(back);
    }
    this.root.append(shell);
    return shell;
  }

  private renderApp(app: CatalogApp): HTMLLIElement {
    const row = element("li", "synth-launcher__app");
    const details = element("div", "synth-launcher__app-details");
    details.append(element("h2", "synth-launcher__app-name", app.displayName));
    const metadata = element("dl", "synth-launcher__metadata");
    for (const [label, value] of [
      ["Publisher", app.publisher.name],
      ["Author", app.author],
      ["Category", app.category],
      // Incompatible catalogs are diagnosed by CatalogClient and never enter result.apps.
      ["Compatibility", "Compatible"],
    ]) {
      metadata.append(element("dt", undefined, label), element("dd", undefined, value));
    }
    details.append(metadata);
    row.append(details);

    const selected = this.selectedId === app.globalId;
    const buttonLabel = selected && this.selectionError
      ? `Retry ${app.displayName}`
      : selected && this.selectionPending
        ? `Loading ${app.displayName}`
        : `Launch ${app.displayName}`;
    const button = element("button", "synth-launcher__launch", buttonLabel);
    button.type = "button";
    button.disabled = this.selectionPending || this.selectionComplete;
    button.addEventListener("click", () => { void this.select(app); });
    row.append(button);
    if (selected && this.selectionError) {
      const error = element("p", "synth-launcher__app-error", this.selectionError);
      error.setAttribute("role", "alert");
      row.append(error);
    }
    return row;
  }

  private async select(app: CatalogApp): Promise<void> {
    if (!this.ownsRoot() || this.selectionPending || this.selectionComplete) return;
    this.selectionPending = true;
    this.selectedId = app.globalId;
    this.selectionError = undefined;
    const pendingShell = this.render();
    try {
      await this.options.select(app);
      this.selectionComplete = true;
    } catch (error) {
      this.selectionError = errorMessage(error);
    } finally {
      this.selectionPending = false;
      if (pendingShell && this.ownsRoot() && this.root.firstElementChild === pendingShell) this.render();
    }
  }
}
