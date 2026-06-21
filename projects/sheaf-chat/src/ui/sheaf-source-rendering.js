(function () {
  "use strict";

  function Text(value) {
    return String(value == null ? "" : value);
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
    segmentForOffset: SegmentForOffset,
  };
})();
