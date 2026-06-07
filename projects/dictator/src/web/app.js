(function ()
{
  "use strict";

  const state = {
    status: null,
    configFields: [],
    configOptions: {},
    promptDir: "",
    selectedPromptPath: null,
    selectedInteractionId: null
  };
  let configControlCounter = 0;

  async function api(path, options)
  {
    const response = await fetch(path, options);
    const contentType = response.headers.get("content-type") || "";
    const isJSON = contentType.includes("application/json");
    const body = isJSON ? await response.json() : await response.text();
    if (!response.ok)
    {
      const message = isJSON && body && body.error ? body.error : String(body);
      throw new Error(message || "Request failed");
    }
    return body;
  }

  function showError(elementId, message)
  {
    const el = document.getElementById(elementId);
    if (!el)
    {
      return;
    }
    if (!message)
    {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function statusClass(ok, warn)
  {
    if (ok)
    {
      return "ok";
    }
    if (warn)
    {
      return "warn";
    }
    return "bad";
  }

  function renderStatus(status)
  {
    const strip = document.getElementById("status-strip");
    if (!strip)
    {
      return;
    }

    const items = [
      { label: "Health", value: status.healthy ? "Healthy" : "Unhealthy", cls: statusClass(status.healthy) },
      { label: "Uptime", value: status.uptime.toFixed(1) + "s", cls: "" },
      { label: "Dictation", value: status.dictation_state, cls: status.dictation_state === "processing" ? "warn" : "ok" },
      { label: "Provider", value: status.provider_mode, cls: "" },
      { label: "Cloud model", value: status.cloud_model, cls: "" },
      { label: "Local model", value: status.local_model, cls: "" },
      { label: "Fallback", value: status.fallback_mode, cls: "" },
      {
        label: "OpenAI key",
        value: status.api_keys.openai_configured ? "Configured" : "Missing",
        cls: statusClass(status.api_keys.openai_configured)
      },
      {
        label: "STT model",
        value: status.stt_model_present ? "Present" : "Missing",
        cls: statusClass(status.stt_model_present)
      },
      {
        label: "Ollama",
        value: status.ollama_reachable === null ? "Not checked" : (status.ollama_reachable ? "Reachable" : "Unavailable"),
        cls: status.ollama_reachable === false ? "bad" : (status.ollama_reachable ? "ok" : "")
      }
    ];

    if (status.warning)
    {
      items.push({ label: "Warning", value: status.warning, cls: "warn" });
    }
    if (status.ollama_warning)
    {
      items.push({ label: "Ollama note", value: status.ollama_warning, cls: "warn" });
    }

    strip.innerHTML = items.map(function (item)
    {
      return '<div class="status-item"><span class="status-label">' + item.label +
        '</span><span class="status-value ' + item.cls + '">' + escapeHtml(item.value) + "</span></div>";
    }).join("");

    const endpoint = document.getElementById("dictate-endpoint");
    if (endpoint)
    {
      endpoint.textContent = status.dictate_endpoint + "\n" + status.health_endpoint +
        "\nData: " + status.data_path + "\nLogs: " + status.log_path;
    }
  }

  function escapeHtml(value)
  {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadConfigOptions(fieldName)
  {
    if (Object.prototype.hasOwnProperty.call(state.configOptions, fieldName))
    {
      return state.configOptions[fieldName];
    }
    const data = await api("/api/config/options?name=" + encodeURIComponent(fieldName));
    state.configOptions[fieldName] = data.options || [];
    return state.configOptions[fieldName];
  }

  function fieldByName(name)
  {
    return state.configFields.find(function (field)
    {
      return field.name === name;
    });
  }

  function optionDatalistId(fieldName)
  {
    configControlCounter += 1;
    return "config-options-" + fieldName + "-" + configControlCounter;
  }

  function createFallbackInput(field)
  {
    const input = document.createElement(field.name === "interactions_buffer_bytes" ? "input" : "input");
    input.name = field.name;
    input.value = field.current.value;

    if (field.name === "interactions_buffer_bytes")
    {
      input.type = "number";
      input.min = "1";
      input.step = "1";
      input.value = String(Math.max(1, parseInt(field.current.value.replace(/[^0-9]/g, ""), 10) || 100));
      input.dataset.unit = "mb";
      return input;
    }

    input.type = "text";
    input.autocomplete = "off";
    return input;
  }

  function createBoolInput(field)
  {
    const input = document.createElement("select");
    input.innerHTML = '<option value="true">true</option><option value="false">false</option>';
    input.value = field.current.value;
    input.name = field.name;
    return input;
  }

  function createInputWithOptions(field, options)
  {
    const input = createFallbackInput(field);
    if (!options.length || field.name === "interactions_buffer_bytes")
    {
      return input;
    }

    const list = document.createElement("datalist");
    list.id = optionDatalistId(field.name);
    list.innerHTML = options.map(function (opt)
    {
      return '<option value="' + escapeHtml(opt.value) + '"></option>';
    }).join("");
    input.setAttribute("list", list.id);

    const fragment = document.createDocumentFragment();
    fragment.appendChild(input);
    fragment.appendChild(list);
    return fragment;
  }

  async function createConfigInput(field)
  {
    if (field.type === "bool")
    {
      return createBoolInput(field);
    }

    try
    {
      return createInputWithOptions(field, await loadConfigOptions(field.name));
    }
    catch (err)
    {
      showError("config-error", "Some setting options could not be loaded: " + err.message);
      return createFallbackInput(field);
    }
  }

  function appendConfigControl(container, field, inputNode)
  {
    const wrapper = document.createElement("div");
    wrapper.className = "config-field";
    wrapper.dataset.fieldName = field.name;

    const label = document.createElement("label");
    label.textContent = field.label;
    wrapper.appendChild(label);
    wrapper.appendChild(inputNode);
    container.appendChild(wrapper);
  }

  function normalizedFieldValue(field, value)
  {
    if (field.name === "interactions_buffer_bytes")
    {
      return String(Math.max(1, parseInt(String(value).replace(/[^0-9]/g, ""), 10) || 100));
    }
    return String(value);
  }

  async function renderConfigForm()
  {
    const form = document.getElementById("config-form");
    if (!form)
    {
      return;
    }

    const config = await api("/api/config");
    state.configFields = config.fields || [];
    form.innerHTML = "";

    for (const field of state.configFields)
    {
      if (!field.editable)
      {
        continue;
      }

      appendConfigControl(form, field, await createConfigInput(field));
    }

    await renderTopSettingsForm();
  }

  function collectConfigPatch()
  {
    const patch = {};
    const form = document.getElementById("config-form");
    if (!form)
    {
      return patch;
    }

    for (const field of state.configFields)
    {
      const input = form.querySelector('[name="' + field.name + '"]');
      if (!input)
      {
        continue;
      }
      const original = field.current.value;
      const next = input.value;
      if (normalizedFieldValue(field, next) === normalizedFieldValue(field, original))
      {
        continue;
      }
      if (field.type === "bool")
      {
        patch[field.name] = next === "true";
      }
      else if (field.name === "interactions_buffer_bytes")
      {
        const digits = next.replace(/[^0-9]/g, "");
        const mb = parseInt(digits, 10) || 100;
        patch[field.name] = mb * 1024 * 1024;
      }
      else
      {
        patch[field.name] = next;
      }
    }
    return patch;
  }

  async function saveConfig()
  {
    showError("config-error", null);
    const patch = collectConfigPatch();
    if (Object.keys(patch).length === 0)
    {
      showError("config-error", "No configuration changes to save.");
      return;
    }
    await api("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    state.selectedPromptPath = null;
    await refresh();
  }

  async function resetConfig()
  {
    showError("config-error", null);
    showError("top-settings-error", null);
    await api("/api/config/reset", { method: "POST" });
    state.selectedPromptPath = null;
    await refresh();
  }

  async function renderTopSettingsForm()
  {
    const form = document.getElementById("top-settings-form");
    if (!form || !state.configFields.length)
    {
      return;
    }

    const topFields = [
      "use_cloud",
      "cloud_model",
      "local_model",
      "system_prompt",
      "interactions_buffer_bytes"
    ];

    form.innerHTML = '<div class="top-settings-title">Settings</div>';
    for (const name of topFields)
    {
      const field = fieldByName(name);
      if (!field)
      {
        continue;
      }
      appendConfigControl(form, field, await createConfigInput(field));
    }

    const actions = document.createElement("div");
    actions.className = "top-settings-actions";
    actions.innerHTML = '<button type="submit" class="btn btn-primary">Save</button>' +
      '<button type="button" id="top-settings-reset-btn" class="btn btn-secondary">Reset</button>';
    form.appendChild(actions);

    const reset = document.getElementById("top-settings-reset-btn");
    if (reset)
    {
      reset.addEventListener("click", function ()
      {
        resetConfig().catch(function (err)
        {
          showError("top-settings-error", err.message);
        });
      });
    }
  }

  function collectTopSettingsPatch()
  {
    const patch = {};
    const form = document.getElementById("top-settings-form");
    if (!form)
    {
      return patch;
    }

    for (const field of state.configFields)
    {
      const input = form.querySelector('[name="' + field.name + '"]');
      if (!input)
      {
        continue;
      }
      const original = field.current.value;
      const next = input.value;
      if (normalizedFieldValue(field, next) === normalizedFieldValue(field, original))
      {
        continue;
      }
      if (field.type === "bool")
      {
        patch[field.name] = next === "true";
      }
      else if (field.name === "interactions_buffer_bytes")
      {
        const mb = Math.max(1, parseInt(next.replace(/[^0-9]/g, ""), 10) || 100);
        patch[field.name] = mb * 1024 * 1024;
      }
      else
      {
        patch[field.name] = next;
      }
    }
    return patch;
  }

  async function saveTopSettings()
  {
    showError("top-settings-error", null);
    const patch = collectTopSettingsPatch();
    if (Object.keys(patch).length === 0)
    {
      showError("top-settings-error", "No configuration changes to save.");
      return;
    }
    await api("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    state.selectedPromptPath = null;
    await refresh();
  }

  async function loadPromptDirectory(dir)
  {
    showError("prompt-error", null);
    state.promptDir = dir;
    const data = await api("/api/prompts?dir=" + encodeURIComponent(dir));
    const list = document.getElementById("prompt-entries");
    const pathLabel = document.getElementById("prompt-current-dir");
    if (pathLabel)
    {
      pathLabel.textContent = dir ? "/" + dir : "/";
    }
    if (!list)
    {
      return;
    }

    list.innerHTML = "";
    if (dir)
    {
      const up = document.createElement("li");
      up.textContent = "..";
      up.addEventListener("click", function ()
      {
        const parts = dir.split("/").filter(Boolean);
        parts.pop();
        loadPromptDirectory(parts.join("/"));
      });
      list.appendChild(up);
    }

    for (const entry of data.entries || [])
    {
      const item = document.createElement("li");
      item.textContent = entry.name;
      if (entry.kind === "directory")
      {
        item.classList.add("dir");
        item.addEventListener("click", function ()
        {
          const next = dir ? dir + "/" + entry.name : entry.name;
          loadPromptDirectory(next);
        });
      }
      else
      {
        item.addEventListener("click", function ()
        {
          previewPrompt(entry.path);
        });
      }
      list.appendChild(item);
    }
  }

  async function previewPrompt(path)
  {
    showError("prompt-error", null);
    state.selectedPromptPath = path;
    const data = await api("/api/prompts/preview?path=" + encodeURIComponent(path));
    const heading = document.getElementById("prompt-preview-heading");
    if (heading)
    {
      heading.textContent = path;
    }
    const preview = document.getElementById("prompt-preview");
    if (preview)
    {
      preview.textContent = data.body;
    }
  }

  async function previewCurrentSystemPrompt()
  {
    const field = fieldByName("system_prompt");
    if (!field || state.selectedPromptPath)
    {
      return;
    }

    const preview = document.getElementById("prompt-preview");
    const heading = document.getElementById("prompt-preview-heading");
    if (heading)
    {
      heading.textContent = "Current primary prompt: " + field.current.value;
    }
    if (preview)
    {
      preview.textContent = "Loading current prompt: " + field.current.value;
    }

    try
    {
      await previewPrompt(field.current.value);
      state.selectedPromptPath = field.current.value;
      const target = document.getElementById("prompt-target");
      if (target)
      {
        target.value = "primary";
      }
    }
    catch (err)
    {
      showError("prompt-error", "Current prompt could not be loaded: " + err.message);
    }
  }

  async function selectPrompt()
  {
    showError("prompt-error", null);
    if (!state.selectedPromptPath)
    {
      showError("prompt-error", "Select a prompt file first.");
      return;
    }
    const target = document.getElementById("prompt-target");
    await api("/api/prompts/selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: target ? target.value : "primary",
        path: state.selectedPromptPath
      })
    });
    if (!target || target.value === "primary")
    {
      state.selectedPromptPath = null;
    }
    await refresh();
  }

  async function loadInteractions()
  {
    const data = await api("/api/interactions");
    const list = document.getElementById("interaction-list");
    if (!list)
    {
      return;
    }
    list.innerHTML = "";
    for (const item of data.interactions || [])
    {
      const li = document.createElement("li");
      li.dataset.id = item.id;
      li.innerHTML = '<strong>' + escapeHtml(item.status) + "</strong> " +
        escapeHtml(item.occurred_at) + "<br>" +
        escapeHtml(item.output_preview || item.error_preview || "");
      li.addEventListener("click", function ()
      {
        loadInteractionDetail(item.id);
      });
      list.appendChild(li);
    }
  }

  async function loadInteractionDetail(id)
  {
    state.selectedInteractionId = id;
    const detail = await api("/api/interactions/" + encodeURIComponent(id));
    const container = document.getElementById("interaction-detail");
    const list = document.getElementById("interaction-list");
    if (list)
    {
      for (const li of list.querySelectorAll("li"))
      {
        li.classList.toggle("selected", li.dataset.id === id);
      }
    }
    if (!container)
    {
      return;
    }
    container.textContent = JSON.stringify(detail, null, 2);
  }

  async function submitDictation(event)
  {
    event.preventDefault();
    const fileInput = document.getElementById("dictate-file");
    const result = document.getElementById("dictate-result");
    if (!fileInput || !fileInput.files || !fileInput.files[0])
    {
      if (result)
      {
        result.textContent = "Choose a WAV file first.";
      }
      return;
    }

    const sampleRate = document.getElementById("dictate-sample-rate");
    const locale = document.getElementById("dictate-locale");
    const session = document.getElementById("dictate-session");
    const wav = await fileInput.files[0].arrayBuffer();

    try
    {
      const response = await fetch("/v1/dictate-audio", {
        method: "POST",
        headers: {
          "Content-Type": "audio/wav",
          "X-Sample-Rate": sampleRate ? sampleRate.value : "16000",
          "X-Locale": locale ? locale.value : "en-US",
          "X-Session-Id": session ? session.value : "web-ui-test",
          "X-Request-Id": "web-" + Date.now()
        },
        body: wav
      });
      const body = await response.json();
      if (result)
      {
        result.textContent = JSON.stringify(body, null, 2);
      }
      await loadInteractions();
      await loadStatus();
    }
    catch (err)
    {
      if (result)
      {
        result.textContent = String(err);
      }
    }
  }

  async function loadStatus()
  {
    state.status = await api("/api/status");
    renderStatus(state.status);
  }

  async function refresh()
  {
    await loadStatus();
    await renderConfigForm();
    await loadPromptDirectory(state.promptDir);
    await previewCurrentSystemPrompt();
    await loadInteractions();
    if (state.selectedInteractionId)
    {
      await loadInteractionDetail(state.selectedInteractionId);
    }
  }

  function bindEvents()
  {
    const saveBtn = document.getElementById("config-save-btn");
    const resetBtn = document.getElementById("config-reset-btn");
    const promptBtn = document.getElementById("prompt-select-btn");
    const dictateForm = document.getElementById("dictate-form");
    const topSettingsForm = document.getElementById("top-settings-form");

    if (saveBtn)
    {
      saveBtn.addEventListener("click", function ()
      {
        saveConfig().catch(function (err)
        {
          showError("config-error", err.message);
        });
      });
    }
    if (resetBtn)
    {
      resetBtn.addEventListener("click", function ()
      {
        resetConfig().catch(function (err)
        {
          showError("config-error", err.message);
        });
      });
    }
    if (promptBtn)
    {
      promptBtn.addEventListener("click", function ()
      {
        selectPrompt().catch(function (err)
        {
          showError("prompt-error", err.message);
        });
      });
    }
    if (dictateForm)
    {
      dictateForm.addEventListener("submit", submitDictation);
    }
    if (topSettingsForm)
    {
      topSettingsForm.addEventListener("submit", function (event)
      {
        event.preventDefault();
        saveTopSettings().catch(function (err)
        {
          showError("top-settings-error", err.message);
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function ()
  {
    bindEvents();
    refresh().catch(function (err)
    {
      const strip = document.getElementById("status-strip");
      if (strip)
      {
        strip.innerHTML = '<div class="inline-error">Failed to load dashboard: ' + escapeHtml(err.message) + "</div>";
      }
    });
    setInterval(function ()
    {
      loadStatus().catch(function () {});
    }, 5000);
  });
})();
