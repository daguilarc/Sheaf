(function ()
{
  const serviceNameEl = document.getElementById("service-name-data");
  const statusEl = document.getElementById("logs-status");
  const controlsEl = document.getElementById("logs-controls");
  const fileSelectEl = document.getElementById("log-file-select");
  const followToggleEl = document.getElementById("follow-toggle");
  const reopenButtonEl = document.getElementById("reopen-button");
  const errorEl = document.getElementById("logs-error");
  const logViewEl = document.getElementById("log-view");

  const serviceName = JSON.parse(serviceNameEl.textContent);

  let webSocket = null;
  let selectedFile = null;
  let earliestStart = null;
  let readBeforePending = false;
  let suppressScrollLoad = false;

  function buildWebSocketUrl()
  {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/services/${encodeURIComponent(serviceName)}/logs/stream`;
  }

  function showError(message)
  {
    errorEl.hidden = false;
    errorEl.textContent = message;
    reopenButtonEl.hidden = false;
  }

  function clearError()
  {
    errorEl.hidden = true;
    errorEl.textContent = "";
    reopenButtonEl.hidden = true;
  }

  function closeWebSocket()
  {
    if (webSocket)
    {
      webSocket.close();
      webSocket = null;
    }
  }

  function appendLogText(text)
  {
    logViewEl.hidden = false;
    logViewEl.textContent += text;
    logViewEl.scrollTop = logViewEl.scrollHeight;
  }

  function prependLogText(text)
  {
    const previousScrollHeight = logViewEl.scrollHeight;
    const previousScrollTop = logViewEl.scrollTop;

    logViewEl.textContent = text + logViewEl.textContent;

    suppressScrollLoad = true;
    logViewEl.scrollTop = previousScrollTop + (logViewEl.scrollHeight - previousScrollHeight);
    window.requestAnimationFrame(() =>
    {
      suppressScrollLoad = false;
    });
  }

  function handleServerMessage(message)
  {
    if (message.type === "chunk")
    {
      if (earliestStart === null || message.start < earliestStart)
      {
        earliestStart = message.start;
      }

      if (readBeforePending)
      {
        prependLogText(message.text);
        readBeforePending = false;
        return;
      }

      logViewEl.textContent = message.text;
      logViewEl.hidden = false;
      logViewEl.scrollTop = logViewEl.scrollHeight;
      return;
    }

    if (message.type === "append")
    {
      appendLogText(message.text);
      return;
    }

    if (message.type === "error")
    {
      showError(message.message);
    }
  }

  function sendFollowState()
  {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN)
    {
      return;
    }

    webSocket.send(JSON.stringify({
      type: "follow",
      enabled: followToggleEl.checked,
    }));
  }

  function openSelectedFile()
  {
    const filePath = fileSelectEl.value;

    if (!filePath)
    {
      return;
    }

    closeWebSocket();
    clearError();
    selectedFile = filePath;
    earliestStart = null;
    readBeforePending = false;
    logViewEl.textContent = "";
    logViewEl.hidden = false;
    statusEl.textContent = `Opening ${filePath}…`;

    webSocket = new WebSocket(buildWebSocketUrl());

    webSocket.addEventListener("open", () =>
    {
      webSocket.send(JSON.stringify({
        type: "open",
        file: selectedFile,
        tail_bytes: 65536,
      }));
      sendFollowState();
      statusEl.textContent = `Streaming ${selectedFile}`;
    });

    webSocket.addEventListener("message", (event) =>
    {
      let parsed;

      try
      {
        parsed = JSON.parse(event.data);
      }
      catch
      {
        showError("Received malformed log stream message");
        return;
      }

      handleServerMessage(parsed);
    });

    webSocket.addEventListener("close", () =>
    {
      if (webSocket && webSocket.readyState === WebSocket.CLOSED)
      {
        webSocket = null;
      }
    });
  }

  function requestEarlierBytes()
  {
    if (
      !webSocket
      || webSocket.readyState !== WebSocket.OPEN
      || earliestStart === null
      || earliestStart <= 0
      || readBeforePending
    )
    {
      return;
    }

    readBeforePending = true;
    webSocket.send(JSON.stringify({
      type: "read_before",
      before: earliestStart,
      max_bytes: 65536,
    }));
  }

  function renderFileList(files)
  {
    fileSelectEl.replaceChildren();

    for (const file of files)
    {
      const option = document.createElement("option");
      option.value = file.path;
      option.textContent = `${file.path} (${file.size} bytes)`;
      fileSelectEl.appendChild(option);
    }

    controlsEl.hidden = false;
    fileSelectEl.addEventListener("change", () =>
    {
      openSelectedFile();
    });

    openSelectedFile();
  }

  function showNoLogsState()
  {
    controlsEl.hidden = true;
    logViewEl.hidden = true;
    statusEl.textContent = "No log files are available for this service yet.";
  }

  async function loadFileList()
  {
    statusEl.textContent = "Loading log files…";

    const response = await fetch(`/api/services/${encodeURIComponent(serviceName)}/logs`);

    if (!response.ok)
    {
      statusEl.textContent = `Failed to load log files (${response.status})`;
      return;
    }

    const listing = await response.json();

    if (!listing.files || listing.files.length === 0)
    {
      showNoLogsState();
      return;
    }

    renderFileList(listing.files);
  }

  followToggleEl.addEventListener("change", () =>
  {
    sendFollowState();
  });

  reopenButtonEl.addEventListener("click", () =>
  {
    openSelectedFile();
  });

  logViewEl.addEventListener("scroll", () =>
  {
    if (suppressScrollLoad || logViewEl.scrollTop > 0)
    {
      return;
    }

    requestEarlierBytes();
  });

  void loadFileList();
})();
