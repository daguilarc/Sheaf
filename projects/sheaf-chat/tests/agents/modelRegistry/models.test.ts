import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

import {
  CreateSheafModelRegistry,
  ListModels,
  ModelValidationError,
  ValidateModelSelection,
  x_localDefaultModelId,
  x_localFetchFailedReason,
  x_localMissingKeyReason,
  x_localMissingUrlReason,
  x_localProviderName,
} from "../../../src/agents/models.js";
import {
  BuildModelsEndpointUrl,
  FetchLocalModels,
} from "../../../src/agents/localProvider.js";
import { CreateSheafProviderExtension } from "../../../src/agents/providerExtension.js";
import { CreateSheafAuthStorage } from "../../../src/agents/auth.js";
import {
  BuildTestConfig,
  CreateInMemoryAuthStorage,
  CreateMockFetch,
  WithFakeRepoAsync,
} from "./helpers.js";

async function WithOpenAiEnvCleared(callback: () => Promise<void>): Promise<void>
{
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try
  {
    await callback();
  }
  finally
  {
    if (previous === undefined)
    {
      delete process.env.OPENAI_API_KEY;
    }
    else
    {
      process.env.OPENAI_API_KEY = previous;
    }
  }
}

test("BuildModelsEndpointUrl appends /models to a /v1 base URL", () =>
{
  assert.equal(
    BuildModelsEndpointUrl("http://studio.local:8000/v1/"),
    "http://studio.local:8000/v1/models",
  );
});

test("FetchLocalModels reports missing url and key with stable reasons", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const missingUrl = BuildTestConfig(repoRoot);
    const missingUrlState = await FetchLocalModels(missingUrl);
    assert.equal(missingUrlState.unavailableReason, x_localMissingUrlReason);
    assert.equal(missingUrlState.models[0]?.id, x_localDefaultModelId);

    const missingKey = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
    });
    const missingKeyState = await FetchLocalModels(missingKey);
    assert.equal(missingKeyState.unavailableReason, x_localMissingKeyReason);
  });
});

test("FetchLocalModels maps a successful /models response", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
      localInferenceApiKey: "local-secret",
      localInferenceAvailable: true,
    });

    const fetchImpl = CreateMockFetch((url) =>
    {
      assert.equal(url, "http://studio.local:8000/v1/models");
      return new Response(
        JSON.stringify({
          data: [
            { id: "qwen3-coder", name: "Qwen3 Coder", context_window: 32768 },
          ],
        }),
        { status: 200 },
      );
    });

    const state = await FetchLocalModels(config, { fetchImpl });
    assert.equal(state.unavailableReason, null);
    assert.deepEqual(state.models, [
      {
        id: "qwen3-coder",
        displayName: "Qwen3 Coder",
        contextTokens: 32768,
      },
    ]);
  });
});

test("FetchLocalModels marks fetch failures unavailable", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
      localInferenceApiKey: "local-secret",
      localInferenceAvailable: true,
    });

    const fetchImpl = CreateMockFetch(() => new Response("nope", { status: 503 }));
    const state = await FetchLocalModels(config, { fetchImpl });

    assert.equal(state.unavailableReason, x_localFetchFailedReason);
    assert.match(state.fetchError ?? "", /503/);
  });
});

test("CreateSheafModelRegistry merges local models into metadata", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
      localInferenceApiKey: "local-secret",
      localInferenceAvailable: true,
    });
    const authStorage = CreateSheafAuthStorage(config);
    const localProviderState = {
      models: [
        {
          id: "qwen3-coder",
          displayName: "Qwen3 Coder",
          contextTokens: 32768,
        },
      ],
      fetchError: null,
      unavailableReason: null,
    };

    const bundle = await CreateSheafModelRegistry(config, authStorage, {
      localProviderState,
    });
    const models = ListModels(config, bundle.modelRegistry, bundle.localProviderState);
    const localModel = models.find(
      (entry) => entry.provider === x_localProviderName && entry.id === "qwen3-coder",
    );

    assert.ok(localModel);
    assert.equal(localModel.available, true);
    assert.equal(localModel.displayName, "Qwen3 Coder");
    assert.equal(localModel.contextTokens, 32768);
  });
});

test("ListModels marks OpenAI models available when an API key is configured", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      openAiApiKey: "openai-secret",
    });
    const authStorage = CreateInMemoryAuthStorage();
    const bundle = await CreateSheafModelRegistry(config, authStorage, {
      localProviderState: {
        models: [],
        fetchError: null,
        unavailableReason: null,
      },
    });

    const models = ListModels(config, bundle.modelRegistry, bundle.localProviderState);
    const openAiModel = models.find(
      (entry) => entry.provider === "openai" && entry.id === "gpt-4",
    );

    assert.ok(openAiModel);
    assert.equal(openAiModel.available, true);
  });
});

test("ListModels marks OpenAI models unavailable without an API key", async () =>
{
  await WithOpenAiEnvCleared(async () =>
  {
    await WithFakeRepoAsync(async (repoRoot) =>
    {
      const config = BuildTestConfig(repoRoot);
      const authStorage = CreateInMemoryAuthStorage();
      const bundle = await CreateSheafModelRegistry(config, authStorage, {
        localProviderState: {
          models: [],
          fetchError: null,
          unavailableReason: null,
        },
      });

      const models = ListModels(config, bundle.modelRegistry, bundle.localProviderState);
      const openAiModel = models.find(
        (entry) => entry.provider === "openai" && entry.id === "gpt-4",
      );

      assert.ok(openAiModel);
      assert.equal(openAiModel.available, false);
    });
  });
});

test("ListModels excludes unsupported built-in providers", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot);
    const authStorage = CreateInMemoryAuthStorage();
    const bundle = await CreateSheafModelRegistry(config, authStorage, {
      localProviderState: {
        models: [],
        fetchError: null,
        unavailableReason: null,
      },
    });
    const unsupported = bundle.modelRegistry.getAll().find(
      (entry) => entry.provider === "anthropic",
    );

    assert.ok(unsupported);
    const models = ListModels(config, bundle.modelRegistry, bundle.localProviderState);
    assert.equal(models.some((entry) => entry.provider === "anthropic"), false);
    assert.ok(
      models.every((entry) =>
        entry.provider === "openai" || entry.provider === x_localProviderName),
    );
    assert.throws(
      () =>
        ValidateModelSelection(
          config,
          bundle.modelRegistry,
          bundle.localProviderState,
          { provider: unsupported.provider, id: unsupported.id },
        ),
      (error: unknown) =>
        error instanceof ModelValidationError && error.code === "model_not_found",
    );
  });
});

test("ListModels marks local models unavailable when endpoint config is incomplete", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
    });
    const authStorage = CreateInMemoryAuthStorage();
    const bundle = await CreateSheafModelRegistry(config, authStorage, {
      localProviderState: {
        models: [{ id: x_localDefaultModelId, displayName: x_localDefaultModelId }],
        fetchError: x_localMissingKeyReason,
        unavailableReason: x_localMissingKeyReason,
      },
    });

    const models = ListModels(config, bundle.modelRegistry, bundle.localProviderState);
    const localModel = models.find((entry) => entry.provider === x_localProviderName);

    assert.ok(localModel);
    assert.equal(localModel.available, false);
    assert.equal(localModel.unavailableReason, x_localMissingKeyReason);
  });
});

test("ValidateModelSelection rejects unknown and unavailable models", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
    });
    const authStorage = CreateInMemoryAuthStorage();
    const bundle = await CreateSheafModelRegistry(config, authStorage, {
      localProviderState: {
        models: [{ id: x_localDefaultModelId, displayName: x_localDefaultModelId }],
        fetchError: x_localMissingKeyReason,
        unavailableReason: x_localMissingKeyReason,
      },
    });

    assert.throws(
      () =>
        ValidateModelSelection(
          config,
          bundle.modelRegistry,
          bundle.localProviderState,
          { provider: "missing", id: "model" },
        ),
      (error: unknown) =>
        error instanceof ModelValidationError && error.code === "model_not_found",
    );

    assert.throws(
      () =>
        ValidateModelSelection(
          config,
          bundle.modelRegistry,
          bundle.localProviderState,
          { provider: x_localProviderName, id: x_localDefaultModelId },
        ),
      (error: unknown) =>
        error instanceof ModelValidationError && error.code === "model_unavailable",
    );
  });
});

test("ValidateModelSelection accepts an available local model", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
      localInferenceApiKey: "local-secret",
      localInferenceAvailable: true,
    });
    const authStorage = CreateInMemoryAuthStorage();
    const bundle = await CreateSheafModelRegistry(config, authStorage, {
      localProviderState: {
        models: [{ id: "qwen3-coder", displayName: "Qwen3 Coder" }],
        fetchError: null,
        unavailableReason: null,
      },
    });

    const metadata = ValidateModelSelection(
      config,
      bundle.modelRegistry,
      bundle.localProviderState,
      { provider: x_localProviderName, id: "qwen3-coder" },
    );

    assert.equal(metadata.available, true);
    assert.equal(metadata.provider, x_localProviderName);
    assert.equal(metadata.id, "qwen3-coder");
  });
});

test("CreateSheafProviderExtension registers the local provider", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot, {
      localInferenceUrl: "http://studio.local:8000/v1/",
      localInferenceApiKey: "local-secret",
      localInferenceAvailable: true,
    });
    const localProviderState = {
      models: [{ id: "qwen3-coder", displayName: "Qwen3 Coder" }],
      fetchError: null,
      unavailableReason: null,
    };

    const registered: Array<{ provider: string; baseUrl?: string }> = [];
    const extension = CreateSheafProviderExtension(config, localProviderState);
    const fakePi = {
      registerProvider: (provider: string, providerConfig: ProviderConfig) =>
      {
        registered.push({ provider, baseUrl: providerConfig.baseUrl });
      },
    } as Pick<ExtensionAPI, "registerProvider">;

    extension(fakePi as ExtensionAPI);

    assert.deepEqual(registered, [
      {
        provider: x_localProviderName,
        baseUrl: "http://studio.local:8000/v1",
      },
    ]);
  });
});
