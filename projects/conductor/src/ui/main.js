(function ()
{
  const statusEl = document.getElementById("services-status");
  const tableWrapEl = document.getElementById("services-table-wrap");
  const tableBodyEl = document.getElementById("services-body");

  function resolveBrowserHomeUrl(homeUrl)
  {
    if (!homeUrl)
    {
      return undefined;
    }

    try
    {
      const url = new URL(homeUrl);

      if (url.hostname === "0.0.0.0")
      {
        url.hostname = window.location.hostname;
      }

      return url.toString();
    }
    catch
    {
      return homeUrl;
    }
  }

  function formatTimestamp(value)
  {
    if (!value)
    {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime()))
    {
      return value;
    }

    return date.toLocaleString();
  }

  function formatUptime(seconds)
  {
    if (typeof seconds !== "number" || !Number.isFinite(seconds))
    {
      return "—";
    }

    return `${seconds.toFixed(1)}s`;
  }

  function healthClass(healthy)
  {
    if (healthy === true)
    {
      return "sheaf-status sheaf-status--healthy";
    }

    if (healthy === false)
    {
      return "sheaf-status sheaf-status--unhealthy";
    }

    return "sheaf-status sheaf-status--unknown";
  }

  function healthLabel(healthy)
  {
    if (healthy === true)
    {
      return "Healthy";
    }

    if (healthy === false)
    {
      return "Unhealthy";
    }

    return "Unknown";
  }

  function createActionButton(label, serviceName, action)
  {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sheaf-button";
    button.textContent = label;
    button.addEventListener("click", () =>
    {
      void lifecycleAction(serviceName, action);
    });
    return button;
  }

  async function lifecycleAction(serviceName, action)
  {
    statusEl.textContent = `${action} requested for ${serviceName}…`;

    const response = await fetch(
      `/api/services/${encodeURIComponent(serviceName)}/${action}`,
      { method: "POST" },
    );

    if (!response.ok)
    {
      const body = await response.json().catch(() => ({}));
      const message = body.error ?? `Request failed (${response.status})`;
      statusEl.textContent = `${action} failed for ${serviceName}: ${message}`;
      return;
    }

    await loadServices();
  }

  function renderServiceRow(service)
  {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = service.name;
    row.appendChild(nameCell);

    const healthCell = document.createElement("td");
    const healthBadge = document.createElement("span");
    healthBadge.className = healthClass(service.healthy);
    healthBadge.textContent = healthLabel(service.healthy);
    healthCell.appendChild(healthBadge);

    if (service.last_error)
    {
      const errorLine = document.createElement("div");
      errorLine.className = "sheaf-muted";
      errorLine.textContent = service.last_error;
      healthCell.appendChild(errorLine);
    }

    row.appendChild(healthCell);

    const checkedCell = document.createElement("td");
    checkedCell.textContent = formatTimestamp(service.last_checked_at);
    row.appendChild(checkedCell);

    const uptimeCell = document.createElement("td");
    uptimeCell.textContent = formatUptime(service.uptime);
    row.appendChild(uptimeCell);

    const warningCell = document.createElement("td");
    warningCell.textContent = service.warning ?? "—";
    if (service.warning)
    {
      warningCell.className = "sheaf-warning";
    }
    row.appendChild(warningCell);

    const linksCell = document.createElement("td");
    const logsLink = document.createElement("a");
    logsLink.href = `/services/${encodeURIComponent(service.name)}/logs`;
    logsLink.textContent = "Logs";
    linksCell.appendChild(logsLink);

    const homeUrl = resolveBrowserHomeUrl(service.home_url);

    if (homeUrl)
    {
      linksCell.appendChild(document.createTextNode(" · "));
      const homeLink = document.createElement("a");
      homeLink.href = homeUrl;
      homeLink.textContent = "Home";
      homeLink.target = "_blank";
      homeLink.rel = "noopener noreferrer";
      linksCell.appendChild(homeLink);
    }

    row.appendChild(linksCell);

    const actionsCell = document.createElement("td");
    actionsCell.appendChild(createActionButton("Start", service.name, "start"));
    actionsCell.appendChild(document.createTextNode(" "));
    actionsCell.appendChild(createActionButton("Stop", service.name, "stop"));
    actionsCell.appendChild(document.createTextNode(" "));
    actionsCell.appendChild(createActionButton("Restart", service.name, "restart"));
    row.appendChild(actionsCell);

    return row;
  }

  function renderServices(services)
  {
    tableBodyEl.replaceChildren();

    for (const service of services)
    {
      tableBodyEl.appendChild(renderServiceRow(service));
    }

    tableWrapEl.hidden = false;
    statusEl.textContent = `${services.length} service(s)`;
  }

  async function loadServices()
  {
    statusEl.textContent = "Loading services…";

    const response = await fetch("/api/services");

    if (!response.ok)
    {
      statusEl.textContent = `Failed to load services (${response.status})`;
      return;
    }

    const services = await response.json();
    renderServices(services);
  }

  void loadServices();
})();
