declare module "markdown-it"
{
  type MarkdownItInstance =
  {
    render: (source: string) => string;
  };

  type MarkdownItConstructor = (options?: Record<string, unknown>) => MarkdownItInstance;

  const markdownIt: MarkdownItConstructor;
  export default markdownIt;
}

declare module "katex"
{
  type KatexModule =
  {
    renderToString: (tex: string, options?: Record<string, unknown>) => string;
  };

  const katex: KatexModule;
  export default katex;
}
