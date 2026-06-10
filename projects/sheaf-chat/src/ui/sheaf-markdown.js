/**
 * Shared Markdown-it/KaTeX rendering and safe file-link resolution for Sheaf chat.
 */
(function () {
  "use strict";

  const x_MarkdownExtensions = [".md", ".markdown"];
  const x_SheafFilePrefix = "sheaf-file:";
  const x_MathPlaceholderPrefix = "[[[SHEAF_MATH_";
  const x_MathPlaceholderSuffix = "]]]";

  let m_md = null;

  function IsMarkdownPath(pathValue) {
    const lower = String(pathValue).toLowerCase();
    for (let index = 0; index < x_MarkdownExtensions.length; index += 1) {
      if (lower.endsWith(x_MarkdownExtensions[index])) {
        return true;
      }
    }
    return false;
  }

  function SplitFragment(href) {
    const hashIndex = href.indexOf("#");
    if (hashIndex < 0) {
      return { target: href, fragment: undefined };
    }
    return {
      target: href.slice(0, hashIndex),
      fragment: href.slice(hashIndex + 1) || undefined,
    };
  }

  function DecodePathValue(pathValue) {
    let decoded = pathValue;

    try {
      decoded = decodeURIComponent(pathValue.replace(/\+/g, " "));
    } catch (_error) {
      return null;
    }

    if (decoded.indexOf("\0") >= 0) {
      return null;
    }

    return decoded.replace(/\\/g, "/");
  }

  function DecodePathSegments(pathValue) {
    const decodedPath = DecodePathValue(pathValue);

    if (!decodedPath) {
      return null;
    }

    const segments = decodedPath.split("/").filter(function (segment) {
      return segment.length > 0;
    });
    const normalized = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === ".") {
        continue;
      }
      if (segment === "..") {
        return null;
      }

      normalized.push(segment);
    }

    return normalized.join("/");
  }

  function ResolveRelativePath(basePath, relativePath) {
    const baseParts = basePath.split("/");
    if (baseParts.length > 0) {
      baseParts.pop();
    }

    const decodedRelative = DecodePathValue(relativePath);

    if (!decodedRelative) {
      return null;
    }

    const relativeParts = decodedRelative.split("/");
    const combined = baseParts.concat(relativeParts).join("/");
    return DecodePathSegments(combined);
  }

  function HasProtocol(target) {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target);
  }

  function ResolveSheafFileTarget(target) {
    if (!target.startsWith(x_SheafFilePrefix)) {
      return null;
    }

    const relativePath = target.slice(x_SheafFilePrefix.length).replace(/^\/+/, "");
    return DecodePathSegments(relativePath);
  }

  function ResolveFileLink(href, basePath, _rootMode) {
    if (href == null || typeof href !== "string") {
      return null;
    }

    const trimmed = href.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const split = SplitFragment(trimmed);
    const target = split.target;
    const fragment = split.fragment;

    if (target.indexOf("\\") >= 0 || target.indexOf("\0") >= 0) {
      return null;
    }

    if (target.startsWith("//")) {
      return null;
    }

    if (target.startsWith("/") && (target.length === 1 || target.charAt(1) === "/")) {
      return null;
    }

    let resolved = null;

    const sheafFilePath = ResolveSheafFileTarget(target);
    if (sheafFilePath != null) {
      resolved = sheafFilePath;
    } else if (HasProtocol(target)) {
      return null;
    } else if (target.startsWith("/")) {
      resolved = DecodePathSegments(target.replace(/^\/+/, ""));
    } else if (basePath) {
      resolved = ResolveRelativePath(basePath, target);
    } else {
      return null;
    }

    if (!resolved || resolved.length === 0) {
      return null;
    }

    if (resolved.charAt(0) === "/" || /^[a-zA-Z]:[\\/]/.test(resolved)) {
      return null;
    }

    if (!IsMarkdownPath(resolved)) {
      return null;
    }

    if (fragment != null) {
      return { path: resolved, fragment: fragment };
    }

    return { path: resolved };
  }

  function RenderKatex(tex, displayMode) {
    if (typeof katex === "undefined" || !katex.renderToString) {
      return null;
    }

    try {
      return katex.renderToString(tex, {
        displayMode: displayMode === true,
        throwOnError: false,
      });
    } catch (_error) {
      return null;
    }
  }

  function ProtectMath(markdown, placeholders) {
    let working = markdown;

    function ProtectPattern(pattern, displayMode) {
      working = working.replace(pattern, function (match, tex) {
        const rendered = RenderKatex(String(tex).trim(), displayMode);
        const index = placeholders.length;
        placeholders.push(
          rendered != null
            ? '<span class="sheaf-markdown-math' +
                (displayMode ? " sheaf-markdown-math--display" : "") +
                '">' +
                rendered +
                "</span>"
            : match
        );
        return x_MathPlaceholderPrefix + index + x_MathPlaceholderSuffix;
      });
    }

    ProtectPattern(/\$\$([\s\S]+?)\$\$/g, true);
    ProtectPattern(/\\\[([\s\S]+?)\\\]/g, true);
    ProtectPattern(/\\\(([\s\S]+?)\\\)/g, false);
    working = working.replace(
      /(^|[^\\])\$([^$\n]+?)\$(?!\$)/g,
      function (match, prefix, tex) {
        const rendered = RenderKatex(String(tex).trim(), false);
        const index = placeholders.length;
        placeholders.push(
          rendered != null
            ? '<span class="sheaf-markdown-math">' + rendered + "</span>"
            : match
        );
        return prefix + x_MathPlaceholderPrefix + index + x_MathPlaceholderSuffix;
      }
    );

    return working;
  }

  function RestoreMath(html, placeholders) {
    let restored = html;
    for (let index = 0; index < placeholders.length; index += 1) {
      const token = x_MathPlaceholderPrefix + index + x_MathPlaceholderSuffix;
      restored = restored.split(token).join(placeholders[index]);
    }
    return restored;
  }

  function GetMarkdownIt() {
    if (m_md) {
      return m_md;
    }

    if (typeof markdownit === "undefined") {
      return null;
    }

    m_md = markdownit({
      html: false,
      linkify: true,
      breaks: false,
    });

    return m_md;
  }

  function RenderMarkdown(markdown, _options) {
    const source = markdown != null ? String(markdown) : "";
    const md = GetMarkdownIt();

    if (!md) {
      return null;
    }

    const placeholders = [];
    const protectedSource = ProtectMath(source, placeholders);
    const rendered = md.render(protectedSource);
    const withMath = RestoreMath(rendered, placeholders);

    return '<div class="sheaf-markdown">' + withMath + "</div>";
  }

  function EnhanceRenderedLinks(container, context) {
    if (!container || !container.querySelectorAll) {
      return;
    }

    const opts = context || {};
    const links = container.querySelectorAll("a[href]");

    for (let index = 0; index < links.length; index += 1) {
      const link = links[index];
      const href = link.getAttribute("href");
      const resolved = ResolveFileLink(href, opts.basePath, opts.rootMode);

      if (!resolved || typeof opts.onFileLink !== "function") {
        continue;
      }

      link.classList.add("sheaf-markdown-file-link");
      link.addEventListener("click", function (event) {
        event.preventDefault();
        opts.onFileLink(resolved.path, resolved.fragment);
      });
    }
  }

  const SheafMarkdown = {
    renderMarkdown: RenderMarkdown,
    enhanceRenderedLinks: EnhanceRenderedLinks,
    resolveFileLink: ResolveFileLink,
    _test: {
      decodePathSegments: DecodePathSegments,
      isMarkdownPath: IsMarkdownPath,
      protectMath: ProtectMath,
      restoreMath: RestoreMath,
      resolveRelativePath: ResolveRelativePath,
    },
  };

  if (typeof globalThis !== "undefined") {
    globalThis.SheafMarkdown = SheafMarkdown;
  }
  if (typeof window !== "undefined") {
    window.SheafMarkdown = SheafMarkdown;
  }
})();
