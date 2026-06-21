/**
 * Read-only Emacs-style navigation helpers for the Sheaf Chat file viewer.
 */
(function () {
  "use strict";

  function ClampOffset(content, offset) {
    const text = String(content == null ? "" : content);
    const parsed = Number.isFinite(offset) ? Math.trunc(offset) : 0;
    return Math.max(0, Math.min(text.length, parsed));
  }

  function NavigationText(tab) {
    if (tab && tab.renderDocument && typeof tab.renderDocument.text === "string") {
      return tab.renderDocument.text;
    }
    if (tab && typeof tab.navigationDocumentText === "string") {
      return tab.navigationDocumentText;
    }
    return String(tab && tab.content != null ? tab.content : "");
  }

  function CreateTextNode(text) {
    return document.createTextNode(String(text == null ? "" : text));
  }

  function AppendDecoratedSource(parent, content, state) {
    const text = String(content == null ? "" : content);
    const point = ClampOffset(text, state && state.point);
    const hasRegion =
      state &&
      state.markActive === true &&
      state.mark !== null &&
      state.mark !== point;
    const regionStart = hasRegion ? Math.min(state.mark, point) : -1;
    const regionEnd = hasRegion ? Math.max(state.mark, point) : -1;
    const searchStart =
      state && state.prompt && state.prompt.type === "search"
        ? state.prompt.matchStart
        : null;
    const searchEnd =
      state && state.prompt && state.prompt.type === "search"
        ? state.prompt.matchEnd
        : null;
    const hasSearch =
      Number.isFinite(searchStart) &&
      Number.isFinite(searchEnd) &&
      searchEnd > searchStart;
    let index = 0;

    function AppendRun(end, inRegion, inSearch) {
      if (end <= index) {
        return;
      }
      const value = text.slice(index, end);
      if (inSearch) {
        const search = document.createElement("span");
        search.className = "sheaf-chat-file-search-match";
        search.textContent = value;
        if (inRegion) {
          const region = document.createElement("span");
          region.className = "sheaf-chat-file-region";
          region.appendChild(search);
          parent.appendChild(region);
        } else {
          parent.appendChild(search);
        }
      } else if (inRegion) {
        const region = document.createElement("span");
        region.className = "sheaf-chat-file-region";
        region.textContent = value;
        parent.appendChild(region);
      } else {
        parent.appendChild(CreateTextNode(value));
      }
      index = end;
    }

    while (index < text.length) {
      if (index === point) {
        const pointNode = document.createElement("span");
        pointNode.className = "sheaf-chat-file-point";
        pointNode.setAttribute("data-navigation-role", "point");
        pointNode.textContent = text.charAt(index);
        parent.appendChild(pointNode);
        index += 1;
        continue;
      }

      const inRegion = hasRegion && index >= regionStart && index < regionEnd;
      const inSearch = hasSearch && index >= searchStart && index < searchEnd;
      const nextPoint = point > index ? point : text.length;
      const nextRegionBoundary = hasRegion
        ? (inRegion ? regionEnd : (regionStart > index ? regionStart : text.length))
        : text.length;
      const nextSearchBoundary = hasSearch
        ? (inSearch ? searchEnd : (searchStart > index ? searchStart : text.length))
        : text.length;
      AppendRun(Math.min(nextPoint, nextRegionBoundary, nextSearchBoundary, text.length), inRegion, inSearch);
    }

    if (point >= text.length) {
      const pointNode = document.createElement("span");
      pointNode.className = "sheaf-chat-file-point sheaf-chat-file-point--empty";
      pointNode.setAttribute("data-navigation-role", "point");
      pointNode.textContent = "";
      parent.appendChild(pointNode);
    }
  }

  function CreateNavigationState(content) {
    return {
      point: ClampOffset(content, 0),
      mark: null,
      markActive: false,
      desiredColumn: null,
      lastSearch: "",
      prefix: null,
      prompt: null,
      reviewFocusKey: null,
    };
  }

  function BuildLineStarts(content) {
    const text = String(content == null ? "" : content);
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
      if (text.charAt(index) === "\n" && index + 1 <= text.length) {
        starts.push(index + 1);
      }
    }
    return starts;
  }

  function LineIndexForOffset(starts, offset) {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (starts[mid] <= offset && (mid === starts.length - 1 || starts[mid + 1] > offset)) {
        return mid;
      }
      if (starts[mid] > offset) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return 0;
  }

  function LineEndOffset(content, starts, lineIndex) {
    const text = String(content == null ? "" : content);
    const start = starts[lineIndex] == null ? 0 : starts[lineIndex];
    const nextStart = starts[lineIndex + 1];
    const rawEnd = nextStart == null ? text.length : nextStart - 1;
    return Math.max(start, rawEnd);
  }

  function MoveVertical(content, point, desiredColumn, delta) {
    const text = String(content == null ? "" : content);
    const starts = BuildLineStarts(text);
    const lineIndex = LineIndexForOffset(starts, point);
    const currentStart = starts[lineIndex];
    const column = desiredColumn == null ? point - currentStart : desiredColumn;
    const nextLineIndex = Math.max(0, Math.min(starts.length - 1, lineIndex + delta));
    const nextStart = starts[nextLineIndex];
    const nextEnd = LineEndOffset(text, starts, nextLineIndex);
    return {
      point: Math.max(nextStart, Math.min(nextStart + column, nextEnd)),
      desiredColumn: column,
    };
  }

  function NormalizeRelativePath(pathValue) {
    const raw = String(pathValue == null ? "" : pathValue).replace(/\\/g, "/");
    if (raw.indexOf("\0") >= 0 || raw.charAt(0) === "/" || /^[a-zA-Z]:/.test(raw)) {
      return null;
    }
    const segments = raw.split("/").filter(function (segment) {
      return segment.length > 0 && segment !== ".";
    });
    const normalized = [];
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index] === "..") {
        return null;
      }
      normalized.push(segments[index]);
    }
    return normalized.join("/");
  }

  function DirectoryName(pathValue) {
    const normalized = NormalizeRelativePath(pathValue);
    if (!normalized) {
      return "";
    }
    const slash = normalized.lastIndexOf("/");
    return slash < 0 ? "" : normalized.slice(0, slash + 1);
  }

  function BaseName(pathValue) {
    const normalized = String(pathValue || "");
    const slash = normalized.lastIndexOf("/");
    return slash < 0 ? normalized : normalized.slice(slash + 1);
  }

  function TextSegments(container) {
    const renderedSegments = RenderedTextSegments(container);
    if (renderedSegments.length > 0) {
      return renderedSegments;
    }
    const segments = [];
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const length = node.nodeValue ? node.nodeValue.length : 0;
      segments.push({
        node: node,
        start: offset,
        end: offset + length,
      });
      offset += length;
      node = walker.nextNode();
    }
    return segments;
  }

  function HasRenderOffsets(element) {
    return !!(
      element &&
      element.nodeType === 1 &&
      element.hasAttribute("data-render-start") &&
      element.hasAttribute("data-render-end")
    );
  }

  function RenderOffsetElementNumber(element, name) {
    const value = Number(element.getAttribute(name));
    return Number.isFinite(value) ? value : null;
  }

  function IsNestedRenderOffsetElement(element, container) {
    let parent = element.parentElement;
    while (parent) {
      if (HasRenderOffsets(parent)) {
        return true;
      }
      if (parent === container) {
        return false;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function RenderOffsetElements(container) {
    if (!container || container.nodeType !== 1) {
      return [];
    }
    const elements = [];
    if (HasRenderOffsets(container)) {
      elements.push(container);
    }
    Array.prototype.forEach.call(
      container.querySelectorAll("[data-render-start][data-render-end]"),
      function (element) {
        if (!IsNestedRenderOffsetElement(element, container)) {
          elements.push(element);
        }
      }
    );
    return elements;
  }

  function RenderedTextSegments(container) {
    const elements = RenderOffsetElements(container);
    const segments = [];
    elements.forEach(function (element) {
      const renderStart = RenderOffsetElementNumber(element, "data-render-start");
      const renderEnd = RenderOffsetElementNumber(element, "data-render-end");
      if (renderStart === null || renderEnd === null || renderEnd < renderStart) {
        return;
      }

      let localOffset = 0;
      let emittedTextSegment = false;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const length = node.nodeValue ? node.nodeValue.length : 0;
        const start = renderStart + localOffset;
        const end = Math.min(renderEnd, start + length);
        if (end > start) {
          emittedTextSegment = true;
          segments.push({
            node: node,
            element: element,
            start: start,
            end: end,
          });
        }
        localOffset += length;
        node = walker.nextNode();
      }
      if (!emittedTextSegment && renderStart === renderEnd) {
        segments.push({
          node: null,
          element: element,
          start: renderStart,
          end: renderEnd,
        });
      }
    });
    return segments;
  }

  function WrapTextRange(container, start, end, className) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }
    const segments = TextSegments(container);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (
        !segment ||
        !segment.node ||
        segment.end <= start ||
        segment.start >= end ||
        !segment.node.parentNode
      ) {
        continue;
      }
      const text = segment.node.nodeValue || "";
      const localStart = Math.max(0, start - segment.start);
      const localEnd = Math.min(text.length, end - segment.start);
      if (localEnd <= localStart) {
        continue;
      }
      const fragment = document.createDocumentFragment();
      if (localStart > 0) {
        fragment.appendChild(CreateTextNode(text.slice(0, localStart)));
      }
      const span = document.createElement("span");
      span.className = className;
      span.textContent = text.slice(localStart, localEnd);
      fragment.appendChild(span);
      if (localEnd < text.length) {
        fragment.appendChild(CreateTextNode(text.slice(localEnd)));
      }
      segment.node.parentNode.replaceChild(fragment, segment.node);
    }
  }

  function InsertPointAtTextOffset(container, point, className) {
    const segments = TextSegments(container);
    const safePoint = Math.max(0, point);
    let boundarySegment = null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (
        segment &&
        safePoint === segment.end &&
        (
          (segment.node && segment.node.parentNode) ||
          (segment.element && segment.element.nodeType === 1)
        )
      ) {
        boundarySegment = segment;
      }
      if (
        !segment ||
        !segment.node ||
        safePoint < segment.start ||
        safePoint >= segment.end ||
        !segment.node.parentNode
      ) {
        continue;
      }
      const text = segment.node.nodeValue || "";
      const localOffset = safePoint - segment.start;
      const pointNode = document.createElement("span");
      pointNode.className = className || "sheaf-chat-file-point";
      pointNode.setAttribute("data-navigation-role", "point");
      pointNode.textContent = text.charAt(localOffset);

      const fragment = document.createDocumentFragment();
      if (localOffset > 0) {
        fragment.appendChild(CreateTextNode(text.slice(0, localOffset)));
      }
      fragment.appendChild(pointNode);
      if (localOffset + 1 < text.length) {
        fragment.appendChild(CreateTextNode(text.slice(localOffset + 1)));
      }
      segment.node.parentNode.replaceChild(fragment, segment.node);
      return pointNode;
    }

    const pointNode = document.createElement("span");
    pointNode.className = (className || "sheaf-chat-file-point") + " sheaf-chat-file-point--empty";
    pointNode.setAttribute("data-navigation-role", "point");
    pointNode.textContent = "";
    if (boundarySegment && boundarySegment.node && boundarySegment.node.parentNode) {
      boundarySegment.node.parentNode.insertBefore(
        pointNode,
        boundarySegment.node.nextSibling
      );
      return pointNode;
    }
    if (boundarySegment && boundarySegment.element && boundarySegment.element.nodeType === 1) {
      boundarySegment.element.appendChild(pointNode);
      return pointNode;
    }
    container.appendChild(pointNode);
    return pointNode;
  }

  function DecorateRenderedSource(container, tab, state, pointClassName) {
    const text = NavigationText(tab);
    const point = ClampOffset(text, state && state.point);
    if (state && state.markActive === true && state.mark !== null && state.mark !== point) {
      WrapTextRange(
        container,
        Math.min(state.mark, point),
        Math.max(state.mark, point),
        "sheaf-chat-file-region"
      );
    }
    if (
      state &&
      state.prompt &&
      state.prompt.type === "search" &&
      Number.isFinite(state.prompt.matchStart) &&
      Number.isFinite(state.prompt.matchEnd)
    ) {
      WrapTextRange(
        container,
        state.prompt.matchStart,
        state.prompt.matchEnd,
        "sheaf-chat-file-search-match"
      );
    }
    InsertPointAtTextOffset(container, point, pointClassName || "sheaf-chat-file-point");
  }

  function OffsetFromRenderedPoint(container, node, localOffset) {
    const segments = TextSegments(container);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment && segment.node === node) {
        return segment.start + Math.max(0, Math.min(localOffset, segment.end - segment.start));
      }
    }
    return null;
  }

  function NavigationSnapshot(tab, state) {
    const text = NavigationText(tab);
    const starts = BuildLineStarts(text);
    const lineIndex = LineIndexForOffset(starts, state.point);
    const lineStart = starts[lineIndex] || 0;
    return {
      point: ClampOffset(text, state.point),
      mark: state.mark === null ? null : ClampOffset(text, state.mark),
      markActive: state.markActive === true,
      line: lineIndex,
      column: state.point - lineStart,
      before: text.slice(Math.max(0, state.point - 24), state.point),
      after: text.slice(state.point, Math.min(text.length, state.point + 24)),
    };
  }

  function RestorePointFromSnapshot(content, snapshot) {
    const text = String(content == null ? "" : content);
    if (snapshot && Number.isFinite(snapshot.point) && snapshot.point <= text.length) {
      return ClampOffset(text, snapshot.point);
    }
    if (snapshot && typeof snapshot.before === "string" && typeof snapshot.after === "string") {
      const anchor = snapshot.before + snapshot.after;
      const found = anchor.length > 0 ? text.indexOf(anchor) : -1;
      if (found >= 0) {
        return ClampOffset(text, found + snapshot.before.length);
      }
    }
    if (snapshot && Number.isFinite(snapshot.line) && Number.isFinite(snapshot.column)) {
      const starts = BuildLineStarts(text);
      const line = Math.max(0, Math.min(starts.length - 1, Math.trunc(snapshot.line)));
      const end = LineEndOffset(text, starts, line);
      return ClampOffset(text, Math.min(end, (starts[line] || 0) + Math.trunc(snapshot.column)));
    }
    return 0;
  }

  function CreateController(config) {
    const fileViewEl = config.fileViewEl;
    const getSelectedTab = typeof config.getSelectedTab === "function"
      ? config.getSelectedTab
      : function () { return null; };
    const getTabs = typeof config.getTabs === "function"
      ? config.getTabs
      : function () { return []; };
    const listDirectory = typeof config.listDirectory === "function"
      ? config.listDirectory
      : function () { return Promise.resolve([]); };
    const openFile = typeof config.openFile === "function"
      ? config.openFile
      : function () { return Promise.resolve(); };
    const selectTab = typeof config.selectTab === "function"
      ? config.selectTab
      : function () { return Promise.resolve(); };
    const renderSelectedFile = typeof config.renderSelectedFile === "function"
      ? config.renderSelectedFile
      : function () {};
    const onStateChange = typeof config.onStateChange === "function"
      ? config.onStateChange
      : function () {};
    const tabStates = new Map();
    const pendingSnapshots = new Map();
    let fileViewActive = false;
    let suppressNextPrefixKeyUp = false;
    let suppressScrollSync = false;
    let lastScrollTop = fileViewEl ? fileViewEl.scrollTop || 0 : 0;
    let currentNavigationPath = null;
    let previousSelectedPath = null;

    if (fileViewEl) {
      fileViewEl.tabIndex = 0;
      fileViewEl.setAttribute("role", "region");
      fileViewEl.setAttribute("aria-label", "File view");
    }

    function StateForTab(tab) {
      const path = tab && tab.path ? String(tab.path) : "";
      if (!tabStates.has(path)) {
        const text = NavigationText(tab);
        const state = CreateNavigationState(text);
        if (pendingSnapshots.has(path)) {
          const snapshot = pendingSnapshots.get(path);
          state.point = RestorePointFromSnapshot(text, snapshot);
          state.mark = snapshot && snapshot.mark === null
            ? null
            : ClampOffset(text, snapshot ? snapshot.mark : null);
          state.markActive = snapshot ? snapshot.markActive === true : false;
          pendingSnapshots.delete(path);
        }
        tabStates.set(path, state);
      }
      const state = tabStates.get(path);
      const text = NavigationText(tab);
      state.point = ClampOffset(text, state.point);
      if (state.mark !== null) {
        state.mark = ClampOffset(text, state.mark);
      }
      return state;
    }

    function SelectedTabAndState() {
      const tab = getSelectedTab();
      if (!tab) {
        return null;
      }
      return {
        tab: tab,
        state: StateForTab(tab),
      };
    }

    function NavigationSurface() {
      if (!fileViewEl) {
        return null;
      }
      return fileViewEl.querySelector(".sheaf-chat-file-navigable") || fileViewEl;
    }

    function MeasuredLineHeight() {
      const surface = NavigationSurface();
      if (surface && typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        const parsed = parseFloat(window.getComputedStyle(surface).lineHeight);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
      return 18;
    }

    function PageLineDelta() {
      if (!fileViewEl) {
        return 1;
      }
      return Math.max(1, Math.floor((fileViewEl.clientHeight || 160) / MeasuredLineHeight()) - 1);
    }

    function SetViewportScrollTop(scrollTop) {
      if (!fileViewEl) {
        return;
      }
      const maxScroll = Math.max(0, fileViewEl.scrollHeight - fileViewEl.clientHeight);
      suppressScrollSync = true;
      fileViewEl.scrollTop = Math.max(0, Math.min(maxScroll, scrollTop));
      lastScrollTop = fileViewEl.scrollTop || 0;
      window.requestAnimationFrame(function () {
        suppressScrollSync = false;
      });
    }

    function NoteProgrammaticScroll(scrollTop) {
      if (!fileViewEl) {
        return;
      }
      suppressScrollSync = true;
      lastScrollTop = Number.isFinite(scrollTop) ? scrollTop : (fileViewEl.scrollTop || 0);
      window.requestAnimationFrame(function () {
        suppressScrollSync = false;
      });
    }

    function ScheduleViewportScrollTop(scrollTop, ensurePointVisible) {
      if (!fileViewEl) {
        return;
      }
      window.requestAnimationFrame(function () {
        SetViewportScrollTop(scrollTop);
        if (ensurePointVisible) {
          window.requestAnimationFrame(EnsurePointVisible);
        }
      });
    }

    function EnsurePointVisible() {
      if (!fileViewEl || typeof fileViewEl.getBoundingClientRect !== "function") {
        return;
      }
      const point = fileViewEl.querySelector(".sheaf-chat-file-point");
      if (!point || typeof point.getBoundingClientRect !== "function") {
        return;
      }
      const viewRect = fileViewEl.getBoundingClientRect();
      const pointRect = point.getBoundingClientRect();
      if (pointRect.top >= viewRect.top && pointRect.bottom <= viewRect.bottom) {
        return;
      }
      const pointTop = pointRect.top - viewRect.top + fileViewEl.scrollTop;
      const targetRatio = pointRect.top < viewRect.top ? 0.33 : 0.67;
      SetViewportScrollTop(pointTop - fileViewEl.clientHeight * targetRatio);
    }

    function ScheduleEnsurePointVisible() {
      if (!fileViewEl) {
        return;
      }
      window.requestAnimationFrame(EnsurePointVisible);
    }

    function ScheduleEnsureSourcePointVisible(tab, state) {
      if (!fileViewEl || !tab || !state) {
        return;
      }
      const point = state.point;
      const content = NavigationText(tab);
      window.requestAnimationFrame(function () {
        const starts = BuildLineStarts(content);
        const lineIndex = LineIndexForOffset(starts, ClampOffset(content, point));
        const lineHeight = MeasuredLineHeight();
        const pointTop = lineIndex * lineHeight;
        const viewTop = fileViewEl.scrollTop || 0;
        const viewBottom = viewTop + fileViewEl.clientHeight;
        if (pointTop < viewTop) {
          SetViewportScrollTop(pointTop - fileViewEl.clientHeight * 0.33);
          return;
        }
        if (pointTop + lineHeight > viewBottom) {
          SetViewportScrollTop(pointTop - fileViewEl.clientHeight * 0.67);
          return;
        }
        EnsurePointVisible();
      });
    }

    function SetPoint(tab, state, point, desiredColumn, options) {
      state.point = ClampOffset(NavigationText(tab), point);
      state.desiredColumn = desiredColumn == null ? null : desiredColumn;
      onStateChange();
      renderSelectedFile();
      if (options && Number.isFinite(options.scrollTop)) {
        ScheduleViewportScrollTop(options.scrollTop, options.ensureVisible !== false);
      } else if (!options || options.ensureVisible !== false) {
        ScheduleEnsureSourcePointVisible(tab, state);
      }
    }

    function SetMark() {
      const selected = SelectedTabAndState();
      if (!selected) {
        return false;
      }
      selected.state.mark = selected.state.point;
      selected.state.markActive = true;
      selected.state.prefix = null;
      onStateChange();
      renderSelectedFile();
      return true;
    }

    function ExchangePointAndMark() {
      const selected = SelectedTabAndState();
      if (!selected || selected.state.mark === null) {
        return false;
      }
      const previousPoint = selected.state.point;
      selected.state.point = ClampOffset(NavigationText(selected.tab), selected.state.mark);
      selected.state.mark = previousPoint;
      selected.state.markActive = true;
      selected.state.prefix = null;
      onStateChange();
      renderSelectedFile();
      return true;
    }

    function CancelCommandState() {
      const selected = SelectedTabAndState();
      if (!selected) {
        return false;
      }
      const prompt = selected.state.prompt;
      if (prompt && prompt.type === "search") {
        selected.state.point = prompt.origin;
        selected.state.mark = prompt.previousMark;
        selected.state.markActive = prompt.previousMarkActive;
      } else if (!prompt && !selected.state.prefix && selected.state.markActive) {
        selected.state.markActive = false;
      }
      selected.state.prefix = null;
      selected.state.prompt = null;
      onStateChange();
      renderSelectedFile();
      return true;
    }

    function SearchHasUppercase(query) {
      return /[A-Z]/.test(String(query == null ? "" : query));
    }

    function SearchTextPair(content, query) {
      const text = String(content == null ? "" : content);
      const needle = String(query == null ? "" : query);
      if (SearchHasUppercase(needle)) {
        return {
          text: text,
          query: needle,
        };
      }
      return {
        text: text.toLowerCase(),
        query: needle.toLowerCase(),
      };
    }

    function FindSearchMatch(content, query, fromOffset, direction, allowWrap) {
      const text = String(content == null ? "" : content);
      const search = SearchTextPair(text, query);
      if (!query) {
        return null;
      }
      if (direction === "reverse") {
        const before = search.text.slice(0, Math.max(0, fromOffset));
        let index = before.lastIndexOf(search.query);
        if (index < 0 && allowWrap) {
          index = search.text.lastIndexOf(search.query);
        }
        return index < 0 ? null : {
          index: index,
          wrapped: before.lastIndexOf(search.query) < 0,
        };
      }
      const start = Math.max(0, fromOffset);
      let index = search.text.indexOf(search.query, start);
      if (index < 0 && allowWrap) {
        index = search.text.indexOf(search.query, 0);
      }
      return index < 0 ? null : {
        index: index,
        wrapped: index >= 0 && index < start,
      };
    }

    function LongestCommonPrefix(values) {
      const strings = values
        .map(function (value) { return String(value == null ? "" : value); })
        .filter(function (value) { return value.length > 0; });
      if (strings.length === 0) {
        return "";
      }
      let prefix = strings[0];
      for (let index = 1; index < strings.length; index += 1) {
        const value = strings[index];
        let shared = 0;
        const limit = Math.min(prefix.length, value.length);
        while (
          shared < limit &&
          prefix.charAt(shared).toLowerCase() === value.charAt(shared).toLowerCase()
        ) {
          shared += 1;
        }
        prefix = prefix.slice(0, shared);
        if (prefix.length === 0) {
          break;
        }
      }
      return prefix;
    }

    function ApplyPromptSegmentCompletion(prompt, fullPath, slash, prefix, completed) {
      if (completed.length <= prefix.length) {
        return false;
      }
      prompt.input =
        (slash < 0 ? "" : fullPath.slice(0, slash + 1)) +
        completed;
      return true;
    }

    function UpdateSearchPrompt(state, tab, nextQuery, direction, repeat) {
      const prompt = state.prompt;
      if (!prompt || prompt.type !== "search") {
        return false;
      }
      prompt.query = nextQuery;
      prompt.direction = direction || prompt.direction;
      if (!repeat) {
        prompt.wrapPendingDirection = null;
        prompt.error = null;
      }
      if (!prompt.query) {
        prompt.matchStart = null;
        prompt.matchEnd = null;
        prompt.wrapPendingDirection = null;
        prompt.error = null;
        state.point = prompt.origin;
        onStateChange();
        renderSelectedFile();
        ScheduleEnsureSourcePointVisible(tab, state);
        return true;
      }

      const startOffset = repeat
        ? (prompt.direction === "reverse" ? state.point : state.point + prompt.query.length)
        : prompt.origin;
      let allowWrap = false;
      if (repeat && prompt.wrapPendingDirection === prompt.direction) {
        allowWrap = true;
      }
      const match = FindSearchMatch(NavigationText(tab), prompt.query, startOffset, prompt.direction, allowWrap);
      if (match !== null) {
        prompt.matchStart = match.index;
        prompt.matchEnd = match.index + prompt.query.length;
        prompt.wrapPendingDirection = null;
        prompt.error = match.wrapped ? "Wrapped" : null;
        state.point = match.index;
      } else if (repeat) {
        prompt.wrapPendingDirection = prompt.direction;
        prompt.error = prompt.direction === "reverse" ? "Failing reverse search" : "Failing search";
      }
      onStateChange();
      renderSelectedFile();
      if (match !== null) {
        ScheduleEnsureSourcePointVisible(tab, state);
      }
      return true;
    }

    function StartSearch(direction) {
      const selected = SelectedTabAndState();
      if (!selected) {
        return false;
      }
      const state = selected.state;
      if (state.prompt && state.prompt.type === "search") {
        return UpdateSearchPrompt(
          state,
          selected.tab,
          state.prompt.query,
          direction,
          state.prompt.query.length > 0
        );
      }
      state.prefix = null;
      state.prompt = {
        type: "search",
        direction: direction,
        query: "",
        origin: state.point,
        previousMark: state.mark,
        previousMarkActive: state.markActive,
        matchStart: null,
        matchEnd: null,
        wrapPendingDirection: null,
        error: null,
      };
      renderSelectedFile();
      return true;
    }

    function AcceptSearch() {
      const selected = SelectedTabAndState();
      if (!selected || !selected.state.prompt || selected.state.prompt.type !== "search") {
        return false;
      }
      const prompt = selected.state.prompt;
      selected.state.lastSearch = prompt.query;
      if (!prompt.previousMarkActive) {
        selected.state.mark = prompt.origin;
        selected.state.markActive = false;
      }
      selected.state.prompt = null;
      onStateChange();
      renderSelectedFile();
      return true;
    }

    function HandleSearchPromptKey(event, selected) {
      const state = selected.state;
      const prompt = state.prompt;
      if (!prompt || prompt.type !== "search") {
        return false;
      }
      const key = String(event.key || "");
      const lower = key.toLowerCase();
      if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "s") {
        return UpdateSearchPrompt(state, selected.tab, prompt.query, "forward", true);
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "r") {
        return UpdateSearchPrompt(state, selected.tab, prompt.query, "reverse", true);
      }
      if (key === "Enter") {
        return AcceptSearch();
      }
      if (key === "Backspace") {
        return UpdateSearchPrompt(state, selected.tab, prompt.query.slice(0, -1), prompt.direction, false);
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && key.length === 1) {
        return UpdateSearchPrompt(state, selected.tab, prompt.query + key, prompt.direction, false);
      }
      return false;
    }

    function StartFindFile() {
      const selected = SelectedTabAndState();
      if (!selected) {
        return false;
      }
      selected.state.prefix = null;
      selected.state.prompt = {
        type: "find-file",
        input: DirectoryName(selected.tab.path),
        error: null,
        candidates: [],
      };
      onStateChange();
      renderSelectedFile();
      return true;
    }

    function StartBufferSwitch() {
      const selected = SelectedTabAndState();
      if (!selected) {
        return false;
      }
      selected.state.prefix = null;
      selected.state.prompt = {
        type: "buffer",
        input: "",
        error: null,
        candidates: [],
      };
      onStateChange();
      renderSelectedFile();
      return true;
    }

    function PromptFullPath(prompt) {
      return NormalizeRelativePath(prompt.input || "");
    }

    function CompleteFindFilePrompt(selected) {
      const prompt = selected.state.prompt;
      const fullPath = PromptFullPath(prompt);
      if (fullPath === null) {
        prompt.error = "Unsafe path";
        renderSelectedFile();
        return true;
      }
      const slash = fullPath.lastIndexOf("/");
      const directoryPath = slash < 0 ? "." : fullPath.slice(0, slash) || ".";
      const prefix = slash < 0 ? fullPath : fullPath.slice(slash + 1);
      listDirectory(directoryPath).then(function (entries) {
        const matches = entries.filter(function (entry) {
          return entry && String(entry.name || "").indexOf(prefix) === 0;
        });
        prompt.candidates = matches.map(function (entry) {
          return String(entry.name || "");
        });
        if (matches.length === 1) {
          const entry = matches[0];
          const completed = String(entry.name || "");
          prompt.input =
            (slash < 0 ? "" : fullPath.slice(0, slash + 1)) +
            completed +
            (entry.kind === "directory" ? "/" : "");
        } else if (matches.length > 1) {
          ApplyPromptSegmentCompletion(
            prompt,
            fullPath,
            slash,
            prefix,
            LongestCommonPrefix(matches.map(function (entry) {
              return String(entry.name || "");
            }))
          );
        }
        renderSelectedFile();
      });
      return true;
    }

    function AcceptFindFilePrompt(selected) {
      const prompt = selected.state.prompt;
      const fullPath = PromptFullPath(prompt);
      if (fullPath === null || fullPath.length === 0) {
        prompt.error = "Unsafe path";
        renderSelectedFile();
        return true;
      }
      const slash = fullPath.lastIndexOf("/");
      const directoryPath = slash < 0 ? "." : fullPath.slice(0, slash) || ".";
      const name = slash < 0 ? fullPath : fullPath.slice(slash + 1);
      listDirectory(directoryPath).then(function (entries) {
        const entry = entries.find(function (candidate) {
          return candidate && candidate.name === name;
        });
        if (!entry) {
          prompt.error = "No matching file";
          renderSelectedFile();
          return;
        }
        if (entry.kind === "directory") {
          prompt.input = fullPath + "/";
          prompt.error = null;
          renderSelectedFile();
          return;
        }
        if (entry.supported === false) {
          prompt.error = "Unsupported file";
          renderSelectedFile();
          return;
        }
        selected.state.prompt = null;
        openFile(entry.path || fullPath);
      });
      return true;
    }

    function MatchingTabs(input) {
      const query = String(input || "").toLowerCase();
      return getTabs().filter(function (tab) {
        const path = String(tab.path || "");
        const name = BaseName(path);
        return query.length === 0 ||
          path.toLowerCase().indexOf(query) >= 0 ||
          name.toLowerCase().indexOf(query) >= 0;
      });
    }

    function CompleteBufferPrompt(selected) {
      const prompt = selected.state.prompt;
      const matches = MatchingTabs(prompt.input);
      prompt.candidates = matches.map(function (tab) {
        return String(tab.path || "");
      });
      if (matches.length === 1) {
        prompt.input = String(matches[0].path || "");
      } else if (matches.length > 1) {
        const query = String(prompt.input || "");
        const prefixMatches = matches.filter(function (tab) {
          return String(tab.path || "").toLowerCase().indexOf(query.toLowerCase()) === 0;
        });
        const completionMatches = prefixMatches.length > 0 ? prefixMatches : matches;
        const completed = LongestCommonPrefix(completionMatches.map(function (tab) {
          return String(tab.path || "");
        }));
        if (completed.length > query.length) {
          prompt.input = completed;
        }
      }
      renderSelectedFile();
      return true;
    }

    function AcceptBufferPrompt(selected) {
      const prompt = selected.state.prompt;
      const targetPath =
        prompt.input.length === 0
          ? previousSelectedPath
          : (MatchingTabs(prompt.input)[0] || {}).path;
      if (!targetPath) {
        prompt.error = "No matching buffer";
        renderSelectedFile();
        return true;
      }
      selected.state.prompt = null;
      selectTab(targetPath);
      return true;
    }

    function HandleCompletionPromptKey(event, selected) {
      const state = selected.state;
      const prompt = state.prompt;
      if (!prompt || (prompt.type !== "find-file" && prompt.type !== "buffer")) {
        return false;
      }
      const key = String(event.key || "");
      if (key === "Enter") {
        return prompt.type === "find-file"
          ? AcceptFindFilePrompt(selected)
          : AcceptBufferPrompt(selected);
      }
      if (key === "Tab") {
        return prompt.type === "find-file"
          ? CompleteFindFilePrompt(selected)
          : CompleteBufferPrompt(selected);
      }
      if (key === "Backspace") {
        prompt.input = prompt.input.slice(0, -1);
        prompt.error = null;
        onStateChange();
        renderSelectedFile();
        return true;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && key.length === 1) {
        prompt.input += key;
        prompt.error = null;
        onStateChange();
        renderSelectedFile();
        return true;
      }
      return false;
    }

    function MoveSelectedPoint(command) {
      const selected = SelectedTabAndState();
      if (!selected) {
        return false;
      }
      const tab = selected.tab;
      const state = selected.state;
      const text = NavigationText(tab);
      const starts = BuildLineStarts(text);
      const lineIndex = LineIndexForOffset(starts, state.point);

      if (command === "left") {
        SetPoint(tab, state, state.point - 1, null);
        return true;
      }
      if (command === "right") {
        SetPoint(tab, state, state.point + 1, null);
        return true;
      }
      if (command === "line-start") {
        SetPoint(tab, state, starts[lineIndex], null);
        return true;
      }
      if (command === "line-end") {
        SetPoint(tab, state, LineEndOffset(text, starts, lineIndex), null);
        return true;
      }
      if (command === "up" || command === "down") {
        const moved = MoveVertical(
          text,
          state.point,
          state.desiredColumn,
          command === "up" ? -1 : 1
        );
        SetPoint(tab, state, moved.point, moved.desiredColumn);
        return true;
      }
      if (command === "page-down") {
        const lineDelta = PageLineDelta();
        const moved = MoveVertical(text, state.point, state.desiredColumn, lineDelta);
        const scrollTop = fileViewEl
          ? (fileViewEl.scrollTop || 0) + lineDelta * MeasuredLineHeight()
          : null;
        SetPoint(tab, state, moved.point, moved.desiredColumn, {
          scrollTop: scrollTop,
          ensureVisible: true,
        });
        return true;
      }
      if (command === "page-up") {
        const lineDelta = PageLineDelta();
        const moved = MoveVertical(text, state.point, state.desiredColumn, -lineDelta);
        const scrollTop = fileViewEl
          ? (fileViewEl.scrollTop || 0) - lineDelta * MeasuredLineHeight()
          : null;
        SetPoint(tab, state, moved.point, moved.desiredColumn, {
          scrollTop: scrollTop,
          ensureVisible: true,
        });
        return true;
      }

      return false;
    }

    function MovementCommandFromEvent(event) {
      const key = String(event.key || "");
      const lower = key.toLowerCase();
      if (!event.altKey && !event.metaKey && !event.ctrlKey && key === "ArrowLeft") {
        return "left";
      }
      if (!event.altKey && !event.metaKey && !event.ctrlKey && key === "ArrowRight") {
        return "right";
      }
      if (!event.altKey && !event.metaKey && !event.ctrlKey && key === "ArrowUp") {
        return "up";
      }
      if (!event.altKey && !event.metaKey && !event.ctrlKey && key === "ArrowDown") {
        return "down";
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "a") {
        return "line-start";
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "e") {
        return "line-end";
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "v") {
        return "page-down";
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && lower === "v") {
        return "page-up";
      }
      return null;
    }

    function HandleKeyDown(event) {
      const eventTarget = event.target;
      const targetTag = eventTarget && eventTarget.tagName
        ? String(eventTarget.tagName).toLowerCase()
        : "";
      if (
        targetTag === "input" ||
        targetTag === "textarea" ||
        (eventTarget && eventTarget.isContentEditable === true)
      ) {
        return;
      }
      if (
        fileViewEl &&
        !fileViewActive &&
        event.target !== fileViewEl &&
        !fileViewEl.contains(event.target) &&
        document.activeElement !== fileViewEl &&
        !fileViewEl.contains(document.activeElement)
      ) {
        return;
      }

      const key = String(event.key || "");
      const lower = key.toLowerCase();
      const movementCommand = MovementCommandFromEvent(event);
      let handled = false;
      const selected = SelectedTabAndState();
      const state = selected ? selected.state : null;

      if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "g") {
        handled = CancelCommandState();
      } else if (state && state.prompt) {
        handled = HandleSearchPromptKey(event, selected) ||
          HandleCompletionPromptKey(event, selected);
        if (!handled && state.prompt.type === "search" && movementCommand) {
          AcceptSearch();
          handled = MoveSelectedPoint(movementCommand);
        }
      } else if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "s") {
        handled = StartSearch("forward");
      } else if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "r") {
        handled = StartSearch("reverse");
      } else if (state && state.prefix === "C-x") {
        if (!event.altKey && !event.metaKey && lower === "x") {
          handled = ExchangePointAndMark();
          if (!handled) {
            state.prefix = null;
            SyncSelectedTab(selected.tab);
            handled = true;
          }
        } else if (!event.altKey && !event.metaKey && lower === "f") {
          handled = StartFindFile();
        } else if (!event.altKey && !event.metaKey && lower === "b") {
          handled = StartBufferSwitch();
        } else {
          state.prefix = null;
          SyncSelectedTab(selected.tab);
          handled = true;
        }
      } else if (event.ctrlKey && !event.altKey && !event.metaKey && lower === "x") {
        if (state) {
          state.prefix = "C-x";
          suppressNextPrefixKeyUp = true;
          SyncSelectedTab(selected.tab);
          handled = true;
        }
      } else if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        (key === " " || key === "Space" || key === "Spacebar")
      ) {
        handled = SetMark();
      } else if (movementCommand) {
        handled = MoveSelectedPoint(movementCommand);
      }

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function HandleKeyUp(event) {
      if (
        fileViewEl &&
        !fileViewActive &&
        event.target !== fileViewEl &&
        !fileViewEl.contains(event.target) &&
        document.activeElement !== fileViewEl &&
        !fileViewEl.contains(document.activeElement)
      ) {
        return;
      }
      const selected = SelectedTabAndState();
      const state = selected ? selected.state : null;
      const lower = String(event.key || "").toLowerCase();
      if (state && state.prefix === "C-x" && lower === "x") {
        if (suppressNextPrefixKeyUp) {
          suppressNextPrefixKeyUp = false;
          return;
        }
        if (ExchangePointAndMark()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }

    function HandleFocusIn() {
      fileViewActive = true;
    }

    function HandleClick(event) {
      fileViewActive = true;
      const selected = SelectedTabAndState();
      if (!selected || !event || !event.target) {
        return;
      }
      if (event.target.closest && event.target.closest(".sheaf-chat-file-minibuffer")) {
        return;
      }
      const sourceContainer = event.target.closest
        ? event.target.closest(".sheaf-chat-file-navigable, .sheaf-markdown, .sheaf-chat-agent-review-inline")
        : null;
      if (!sourceContainer || !fileViewEl.contains(sourceContainer)) {
        return;
      }
      if (
        sourceContainer.classList &&
        sourceContainer.classList.contains("sheaf-chat-agent-review-inline")
      ) {
        return;
      }
      const doc = fileViewEl.ownerDocument || document;
      let range = null;
      if (typeof doc.caretRangeFromPoint === "function") {
        range = doc.caretRangeFromPoint(event.clientX, event.clientY);
      } else if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(event.clientX, event.clientY);
        if (position && position.offsetNode) {
          range = doc.createRange();
          range.setStart(position.offsetNode, position.offset);
          range.collapse(true);
        }
      }
      const offset = range
        ? OffsetFromRenderedPoint(sourceContainer, range.startContainer, range.startOffset)
        : null;
      if (offset !== null) {
        SetPoint(selected.tab, selected.state, offset, null);
      }
    }

    function HandleDocumentFocusIn(event) {
      if (fileViewEl && !fileViewEl.contains(event.target)) {
        fileViewActive = false;
      }
    }

    function HandleScroll() {
      if (!fileViewEl) {
        return;
      }
      const currentScrollTop = fileViewEl.scrollTop || 0;
      if (suppressScrollSync) {
        if (Math.abs(currentScrollTop - lastScrollTop) < 1) {
          suppressScrollSync = false;
          lastScrollTop = currentScrollTop;
          return;
        }
        suppressScrollSync = false;
      }
      const delta = currentScrollTop - lastScrollTop;
      const lineDelta = Math.round(delta / MeasuredLineHeight());
      if (lineDelta === 0) {
        return;
      }
      const selected = SelectedTabAndState();
      if (!selected || selected.state.prompt) {
        lastScrollTop = currentScrollTop;
        return;
      }
      const moved = MoveVertical(
        NavigationText(selected.tab),
        selected.state.point,
        selected.state.desiredColumn,
        lineDelta
      );
      selected.state.point = ClampOffset(NavigationText(selected.tab), moved.point);
      selected.state.desiredColumn = moved.desiredColumn;
      lastScrollTop = currentScrollTop;
      onStateChange();
      renderSelectedFile();
      ScheduleViewportScrollTop(currentScrollTop, false);
    }

    if (fileViewEl) {
      fileViewEl.addEventListener("focusin", HandleFocusIn);
      fileViewEl.addEventListener("click", HandleClick);
      fileViewEl.addEventListener("scroll", HandleScroll);
      document.addEventListener("focusin", HandleDocumentFocusIn);
      fileViewEl.addEventListener("keydown", HandleKeyDown, true);
      document.addEventListener("keydown", HandleKeyDown, true);
      document.addEventListener("keyup", HandleKeyUp, true);
    }

    function SyncSelectedTab(tab) {
      if (!fileViewEl) {
        return null;
      }
      if (!tab) {
        fileViewEl.removeAttribute("data-point-offset");
        fileViewEl.removeAttribute("data-navigation-path");
        fileViewEl.removeAttribute("data-mark-offset");
        fileViewEl.removeAttribute("data-mark-active");
        fileViewEl.removeAttribute("data-key-prefix");
        return null;
      }
      const state = StateForTab(tab);
      const path = String(tab.path || "");
      if (path && currentNavigationPath !== path) {
        if (currentNavigationPath) {
          previousSelectedPath = currentNavigationPath;
        }
        currentNavigationPath = path;
      }
      fileViewEl.setAttribute("data-point-offset", String(state.point));
      fileViewEl.setAttribute("data-navigation-path", path);
      if (state.mark === null) {
        fileViewEl.removeAttribute("data-mark-offset");
      } else {
        fileViewEl.setAttribute("data-mark-offset", String(state.mark));
      }
      fileViewEl.setAttribute("data-mark-active", state.markActive ? "true" : "false");
      if (state.prefix) {
        fileViewEl.setAttribute("data-key-prefix", state.prefix);
      } else {
        fileViewEl.removeAttribute("data-key-prefix");
      }
      return state;
    }

    function CreatePromptElement(state) {
      if (!state || !state.prompt) {
        return null;
      }
      const prompt = document.createElement("div");
      prompt.className = "sheaf-chat-file-minibuffer sheaf-chat-file-minibuffer--" + state.prompt.type;
      prompt.setAttribute("role", "status");

      const label = document.createElement("span");
      label.className = "sheaf-chat-file-minibuffer-label";
      const input = document.createElement("span");
      input.className = "sheaf-chat-file-minibuffer-input";

      if (state.prompt.type === "search") {
        label.textContent = state.prompt.direction === "reverse" ? "I-search backward: " : "I-search: ";
        input.textContent = state.prompt.query;
      } else if (state.prompt.type === "find-file") {
        label.textContent = "Find file: ";
        input.textContent = state.prompt.input || "";
      } else if (state.prompt.type === "buffer") {
        label.textContent = "Switch buffer: ";
        input.textContent = state.prompt.input || "";
      }

      prompt.appendChild(label);
      prompt.appendChild(input);

      if (state.prompt.error) {
        const error = document.createElement("span");
        error.className = "sheaf-chat-file-minibuffer-error";
        error.textContent = " [" + state.prompt.error + "]";
        prompt.appendChild(error);
      }

      if (state.prompt.candidates && state.prompt.candidates.length > 1) {
        const candidates = document.createElement("span");
        candidates.className = "sheaf-chat-file-minibuffer-candidates";
        candidates.textContent = " {" + state.prompt.candidates.join(", ") + "}";
        prompt.appendChild(candidates);
      }

      return prompt;
    }

    function AppendPrompt(wrap, state) {
      const prompt = CreatePromptElement(state);
      if (!prompt) {
        return;
      }
      wrap.appendChild(prompt);
    }

    function RenderPlainText(tab) {
      const state = SyncSelectedTab(tab);
      const wrap = document.createElement("div");
      wrap.className = "sheaf-chat-file-navigation-layer";
      const pre = document.createElement("pre");
      pre.className = "sheaf-chat-file-plain sheaf-chat-file-navigable";
      pre.setAttribute("data-navigation-kind", "source");
      AppendDecoratedSource(pre, NavigationText(tab), state);
      wrap.appendChild(pre);
      AppendPrompt(wrap, state);
      return wrap;
    }

    function DecorateRenderedMarkdown(container, tab) {
      const state = SyncSelectedTab(tab);
      container.classList.add("sheaf-chat-file-navigable");
      DecorateRenderedSource(
        container,
        tab,
        state,
        "sheaf-chat-file-point sheaf-chat-file-point--markdown"
      );
      AppendPrompt(container, state);
    }

    function DecorateHighlightedPreview(container, tab) {
      const state = SyncSelectedTab(tab);
      container.classList.add("sheaf-chat-file-navigable");
      DecorateRenderedSource(container, tab, state, "sheaf-chat-file-point");
      return container;
    }

    function RenderPrompt(tab) {
      return CreatePromptElement(SyncSelectedTab(tab));
    }

    function PreferredFocusedReviewRow(review) {
      const rows = Array.prototype.slice.call(
        review.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused")
      );
      return rows.find(function (row) {
        return row.classList.contains("sheaf-chat-agent-review-inline-row--addition") &&
          row.querySelector(".sheaf-chat-agent-review-inline-code[data-render-start]");
      }) ||
        rows.find(function (row) {
          return row.classList.contains("sheaf-chat-agent-review-inline-row--context") &&
            row.querySelector(".sheaf-chat-agent-review-inline-code[data-render-start]");
        }) ||
        rows.find(function (row) {
          return !row.classList.contains("sheaf-chat-agent-review-inline-row--deletion") &&
            row.querySelector(".sheaf-chat-agent-review-inline-code[data-render-start]");
        }) ||
        rows.find(function (row) {
          return row.querySelector(".sheaf-chat-agent-review-inline-code[data-render-start]");
        }) ||
        null;
    }

    function DecorateRenderedReview(container, tab) {
      const review = container.querySelector(".sheaf-chat-agent-review-inline");
      const state = StateForTab(tab);
      let focusedRow = null;
      let focusedCode = null;
      if (review) {
        review.classList.add("sheaf-chat-file-navigable");
        focusedRow = PreferredFocusedReviewRow(review);
        focusedCode = focusedRow
          ? focusedRow.querySelector(".sheaf-chat-agent-review-inline-code[data-render-start]")
          : null;
        if (focusedCode) {
          const focusKey =
            String(focusedRow.getAttribute("data-hunk-id") || "") +
            ":" +
            String(focusedCode.getAttribute("data-render-start") || "");
          if (state.reviewFocusKey !== focusKey) {
            state.point = ClampOffset(
              NavigationText(tab),
              Number(focusedCode.getAttribute("data-render-start"))
            );
            state.desiredColumn = null;
            state.reviewFocusKey = focusKey;
          }
        }
      }
      SyncSelectedTab(tab);
      DecorateRenderedSource(
        review || container,
        tab,
        state,
        "sheaf-chat-file-point sheaf-chat-file-point--review"
      );
      AppendPrompt(container, state);
    }

    function ExportState() {
      const result = {};
      getTabs().forEach(function (tab) {
        if (!tab || !tab.path) {
          return;
        }
        result[String(tab.path)] = NavigationSnapshot(tab, StateForTab(tab));
      });
      return result;
    }

    function ApplyState(snapshot) {
      if (!snapshot || typeof snapshot !== "object") {
        return;
      }
      Object.keys(snapshot).forEach(function (path) {
        pendingSnapshots.set(path, snapshot[path]);
        const tab = getTabs().find(function (candidate) {
          return candidate && candidate.path === path;
        });
        if (tab) {
          tabStates.delete(path);
          StateForTab(tab);
        }
      });
    }

    return {
      applyState: ApplyState,
      decorateHighlightedPreview: DecorateHighlightedPreview,
      decorateRenderedMarkdown: DecorateRenderedMarkdown,
      decorateRenderedReview: DecorateRenderedReview,
      exportState: ExportState,
      noteProgrammaticScroll: NoteProgrammaticScroll,
      renderPrompt: RenderPrompt,
      renderPlainText: RenderPlainText,
      syncSelectedTab: SyncSelectedTab,
      destroy: function () {
        if (fileViewEl) {
          fileViewEl.removeEventListener("focusin", HandleFocusIn);
          fileViewEl.removeEventListener("click", HandleClick);
          fileViewEl.removeEventListener("scroll", HandleScroll);
          document.removeEventListener("focusin", HandleDocumentFocusIn);
          fileViewEl.removeEventListener("keydown", HandleKeyDown, true);
          document.removeEventListener("keydown", HandleKeyDown, true);
          document.removeEventListener("keyup", HandleKeyUp, true);
        }
        tabStates.clear();
      },
    };
  }

  window.SheafFileNavigation = {
    createController: CreateController,
    clampOffset: ClampOffset,
  };
})();
