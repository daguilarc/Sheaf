(function () {
  "use strict";

  function Text(value) {
    return String(value == null ? "" : value);
  }

  function CreateElement(tag, className) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function LanguageClass(language) {
    return Text(language).replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  function RenderHighlightedCode(text, language, highlighter) {
    if (
      !highlighter ||
      typeof highlighter.highlight !== "function" ||
      typeof highlighter.getLanguage !== "function"
    ) {
      return null;
    }

    try {
      if (!highlighter.getLanguage(language)) {
        return null;
      }
      const result = highlighter.highlight(Text(text), {
        language: language,
        ignoreIllegals: true,
      });
      return result && result.value != null ? Text(result.value) : "";
    } catch (_error) {
      return null;
    }
  }

  function BuildPlainDocument(path, content) {
    const text = Text(content);
    return {
      path: Text(path),
      text: text,
      segments: [{
        id: "source:0",
        kind: "source",
        text: text,
        start: 0,
        end: text.length,
        sourceStart: 0,
        sourceEnd: text.length,
      }],
    };
  }

  function BuildReviewDocument(path, inlineFile) {
    const rows = inlineFile && Array.isArray(inlineFile.rows) ? inlineFile.rows : [];
    const segments = [];
    let text = "";

    rows.forEach(function (row, index) {
      const rowText = Text(row && row.text);
      const separatorText = index === 0 ? "" : "\n";
      if (separatorText) {
        segments.push({
          id: "separator:" + index,
          kind: "separator",
          text: separatorText,
          start: text.length,
          end: text.length + separatorText.length,
        });
        text += separatorText;
      }

      const start = text.length;
      const kind = row && row.kind ? Text(row.kind) : "context";
      text += rowText;
      segments.push({
        id: Text(row && row.id) || "row:" + index,
        kind: kind,
        text: rowText,
        start: start,
        end: text.length,
        hunkId: typeof (row && row.hunkId) === "string" ? row.hunkId : null,
        oldLineNumber: row && row.oldLineNumber != null ? Number(row.oldLineNumber) : null,
        newLineNumber: row && row.newLineNumber != null ? Number(row.newLineNumber) : null,
        virtual: kind === "deletion",
      });
    });

    return { path: Text(path), text: text, segments: segments };
  }

  function ApplySegmentAttributes(element, segment) {
    if (!element || !segment) {
      return;
    }
    element.setAttribute("data-render-segment-id", Text(segment.id));
    if (Number.isFinite(segment.start)) {
      element.setAttribute("data-render-start", String(segment.start));
    }
    if (Number.isFinite(segment.end)) {
      element.setAttribute("data-render-end", String(segment.end));
    }
    if (Number.isFinite(segment.sourceStart)) {
      element.setAttribute("data-source-start", String(segment.sourceStart));
    }
    if (Number.isFinite(segment.sourceEnd)) {
      element.setAttribute("data-source-end", String(segment.sourceEnd));
    }
  }

  function RenderCodeSegment(parent, segment, language, highlighter) {
    const text = Text(segment && segment.text);
    const highlighted = language
      ? RenderHighlightedCode(text, language, highlighter)
      : null;
    const code = CreateElement(
      "code",
      highlighted === null
        ? ""
        : "hljs language-" + LanguageClass(language)
    );
    ApplySegmentAttributes(code, segment);
    if (highlighted === null) {
      code.textContent = text;
    } else {
      code.innerHTML = highlighted;
    }
    parent.appendChild(code);
    return highlighted !== null;
  }

  function RenderDocument(documentModel, options) {
    const model = documentModel && typeof documentModel === "object"
      ? documentModel
      : BuildPlainDocument("", "");
    const segments = Array.isArray(model.segments) && model.segments.length > 0
      ? model.segments
      : BuildPlainDocument(model.path, model.text).segments;
    const renderOptions = options && typeof options === "object" ? options : {};
    const language = renderOptions.language ? Text(renderOptions.language) : null;
    const highlighter = renderOptions.highlighter || null;
    const pre = CreateElement("pre", "sheaf-chat-file-plain");
    let highlighted = false;

    segments.forEach(function (segment) {
      if (!segment || segment.kind === "separator") {
        pre.appendChild(document.createTextNode(Text(segment && segment.text)));
        return;
      }
      if (RenderCodeSegment(pre, segment, language, highlighter)) {
        highlighted = true;
      }
    });

    if (highlighted) {
      pre.className = "sheaf-chat-file-plain sheaf-chat-file-highlighted";
    }
    return pre;
  }

  function SegmentForOffset(documentModel, offset) {
    const segments = documentModel && Array.isArray(documentModel.segments) ? documentModel.segments : [];
    const textLength = documentModel && typeof documentModel.text === "string" ? documentModel.text.length : 0;
    let normalizedOffset = Number(offset);
    if (!Number.isFinite(normalizedOffset) || normalizedOffset < 0) {
      normalizedOffset = 0;
    }
    if (normalizedOffset > textLength) {
      normalizedOffset = textLength;
    }

    return segments.find(function (segment) {
      return segment && normalizedOffset >= segment.start && normalizedOffset < segment.end;
    }) || segments[segments.length - 1] || null;
  }

  window.SheafSourceRendering = {
    buildPlainDocument: BuildPlainDocument,
    buildReviewDocument: BuildReviewDocument,
    renderCodeSegment: RenderCodeSegment,
    renderDocument: RenderDocument,
    segmentForOffset: SegmentForOffset,
  };
})();
