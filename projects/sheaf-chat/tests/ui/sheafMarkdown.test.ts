import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_sheafMarkdownPath = path.join(x_packageRoot, "src", "ui", "sheaf-markdown.js");

type SheafMarkdownApi =
{
  renderMarkdown: (markdown: string, options?: unknown) => string | null;
  enhanceRenderedLinks: (
    container: { querySelectorAll: (selector: string) => FakeLink[] },
    context: {
      basePath?: string;
      rootMode?: string;
      onFileLink?: (pathValue: string, fragment?: string) => void;
    },
  ) => void;
  resolveFileLink: (
    href: string,
    basePath?: string,
    rootMode?: string,
  ) => { path: string; fragment?: string } | null;
  _test: {
    decodePathSegments: (pathValue: string) => string | null;
    isMarkdownPath: (pathValue: string) => boolean;
    protectMath: (markdown: string, placeholders: string[]) => string;
    restoreMath: (html: string, placeholders: string[]) => string;
    resolveRelativePath: (basePath: string, relativePath: string) => string | null;
  };
};

class FakeLink
{
  public readonly listeners: Record<string, Array<(event: { preventDefault: () => void }) => void>> = {};
  private x_href: string;
  public className = "";

  public readonly classList = {
    add: (name: string): void => {
      const names = this.className.split(/\s+/).filter(Boolean);
      if (!names.includes(name)) {
        names.push(name);
        this.className = names.join(" ");
      }
    },
  };

  public constructor(href: string)
  {
    this.x_href = href;
  }

  public getAttribute(name: string): string | null
  {
    if (name === "href") {
      return this.x_href;
    }
    return null;
  }

  public addEventListener(
    type: string,
    handler: (event: { preventDefault: () => void }) => void,
  ): void
  {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  public click(): void
  {
    const event = {
      prevented: false,
      preventDefault(): void {
        this.prevented = true;
      },
    };
    for (const handler of this.listeners.click || []) {
      handler(event);
    }
  }
}

class FakeContainer
{
  private readonly x_links: FakeLink[];

  public constructor(links: FakeLink[])
  {
    this.x_links = links;
  }

  public querySelectorAll(selector: string): FakeLink[]
  {
    if (selector === "a[href]") {
      return this.x_links;
    }
    return [];
  }
}

function ToPlain<T>(value: T): T
{
  return JSON.parse(JSON.stringify(value)) as T;
}

async function LoadSheafMarkdown(options?: {
  includeVendors?: boolean;
  includeMarkdownIt?: boolean;
  includeKatex?: boolean;
}): Promise<SheafMarkdownApi>
{
  const sandbox: Record<string, unknown> = {
    globalThis: {},
    window: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  if (options?.includeVendors === true || options?.includeMarkdownIt === true)
  {
    const markdownItModule = await import("markdown-it");
    sandbox.markdownit = markdownItModule.default;
  }

  if (options?.includeVendors === true || options?.includeKatex === true)
  {
    const katexModule = await import("katex");
    sandbox.katex = katexModule.default;
  }

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(x_sheafMarkdownPath, "utf8"), sandbox as vm.Context);

  return sandbox.SheafMarkdown as SheafMarkdownApi;
}

test("resolveFileLink resolves relative, root-relative, and sheaf-file links with fragments", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown();

  assert.deepEqual(
    ToPlain(sheafMarkdown.resolveFileLink("other.md", "docs/readme.md")),
    { path: "docs/other.md" },
  );
  assert.deepEqual(
    ToPlain(sheafMarkdown.resolveFileLink("other.md#section", "docs/readme.md")),
    { path: "docs/other.md", fragment: "section" },
  );
  assert.deepEqual(
    ToPlain(sheafMarkdown.resolveFileLink("/docs/readme.md")),
    { path: "docs/readme.md" },
  );
  assert.deepEqual(
    ToPlain(sheafMarkdown.resolveFileLink("sheaf-file:notes/topic.md#intro")),
    { path: "notes/topic.md", fragment: "intro" },
  );
});

test("resolveFileLink rejects traversal, protocol, and unsupported targets", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown();

  assert.equal(sheafMarkdown.resolveFileLink("../secret.md", "docs/readme.md"), null);
  assert.equal(sheafMarkdown.resolveFileLink("..%2Fsecret.md", "docs/readme.md"), null);
  assert.equal(sheafMarkdown.resolveFileLink("https://example.com/doc.md"), null);
  assert.equal(sheafMarkdown.resolveFileLink("//example.com/doc.md"), null);
  assert.equal(sheafMarkdown.resolveFileLink("/etc/passwd"), null);
  assert.equal(sheafMarkdown.resolveFileLink("image.png", "docs/readme.md"), null);
  assert.equal(sheafMarkdown.resolveFileLink("other.md"), null);
  assert.equal(sheafMarkdown.resolveFileLink(""), null);
});

test("enhanceRenderedLinks invokes onFileLink for resolved markdown links", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown();
  const link = new FakeLink("sheaf-file:docs/readme.md#top");
  const container = new FakeContainer([link]);
  const calls: Array<{ path: string; fragment?: string }> = [];

  sheafMarkdown.enhanceRenderedLinks(container, {
    onFileLink(pathValue, fragment) {
      calls.push({ path: pathValue, fragment });
    },
  });

  assert.match(link.className, /sheaf-markdown-file-link/);
  link.click();
  assert.deepEqual(calls, [{ path: "docs/readme.md", fragment: "top" }]);
});

test("renderMarkdown renders headings, emphasis, code, links, and KaTeX math", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown({ includeVendors: true });
  const html = sheafMarkdown.renderMarkdown(
    "# Heading\n\n**bold** and *italic* with `inline` and [link](https://example.com)\n\n$x^2$\n\n$$E=mc^2$$",
  );

  assert.ok(html);
  assert.match(html!, /<h1>Heading<\/h1>/);
  assert.match(html!, /<strong>bold<\/strong>/);
  assert.match(html!, /<em>italic<\/em>/);
  assert.match(html!, /<code>inline<\/code>/);
  assert.match(html!, /href="https:\/\/example.com"/);
  assert.match(html!, /class="sheaf-markdown-math/);
  assert.match(html!, /class="sheaf-markdown"/);
  assert.equal(html!.includes("<script>"), false);
});

test("renderMarkdown does not render math inside code spans or fenced code blocks", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown({ includeVendors: true });
  const html = sheafMarkdown.renderMarkdown(
    "`$x$`\n\n```sh\ncp $a $b\n$$not math$$\n```\n\nCurrency: it costs $5 to $10\n\nOutside math: $x^2$",
  );

  assert.ok(html);
  assert.match(html!, /<code>\$x\$<\/code>/);
  assert.match(html!, /cp \$a \$b/);
  assert.match(html!, /\$\$not math\$\$/);
  assert.match(html!, /it costs \$5 to \$10/);
  assert.equal(html!.match(/sheaf-markdown-math/g)?.length, 1);
});

test("renderMarkdown escapes math fallback text when KaTeX is unavailable", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown({ includeMarkdownIt: true });
  const html = sheafMarkdown.renderMarkdown("$<img src=x onerror=alert(1)>$");

  assert.ok(html);
  assert.equal(html!.includes("<img"), false);
  assert.match(html!, /\$&lt;img src=x onerror=alert\(1\)&gt;\$/);
});

test("renderMarkdown returns null when markdown-it is unavailable", async () =>
{
  const sheafMarkdown = await LoadSheafMarkdown();
  assert.equal(sheafMarkdown.renderMarkdown("hello"), null);
});
