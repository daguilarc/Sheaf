EMSDK ?= $(HOME)/.local/emsdk
EMSDK_EMXX := $(EMSDK)/upstream/emscripten/em++
EMSDK_PYTHON_BIN := $(firstword $(wildcard $(EMSDK)/python/*/bin))
# Quote both assignments: an inherited PATH routinely contains directories with
# spaces (for example "~/Library/Application Support/..."), and unquoted the
# shell splits the recipe there and fails with exit 127 before reaching node.
EMSDK_ENV = $(if $(EMSDK_PYTHON_BIN),PATH="$(EMSDK_PYTHON_BIN):$(PATH)") EM_CACHE="$(EM_CACHE)"
EMXX ?= $(if $(shell command -v em++ 2>/dev/null),em++,$(if $(wildcard $(EMSDK_EMXX)),$(EMSDK_EMXX),em++))
BROWSER_BUILD_DIR := dist/wasm
EM_CACHE ?= $(abspath $(BROWSER_BUILD_DIR)/emscripten-cache)

PACKAGE_APP_ID ?=
PACKAGE_SOURCE_DIR ?=
PACKAGE_OUTPUT_DIR ?=
PACKAGE_ENTRY ?=
PACKAGE_WASM ?=
PACKAGE_PTHREAD_WORKER ?= $(PACKAGE_ENTRY)
PACKAGE_WASM_WORKER ?= $(PACKAGE_ENTRY)
PACKAGE_AUDIO_WORKLET ?= $(PACKAGE_ENTRY)

.PHONY: build test browser-package browser-apps browser-fixture-app browser-apps-run browser-audio-input-test browser-apps-smoke

build:
	npm run build

test:
	npm test

browser-package: build
	@test -n "$(PACKAGE_APP_ID)" || { echo "PACKAGE_APP_ID is required" >&2; exit 2; }
	@test -n "$(PACKAGE_SOURCE_DIR)" || { echo "PACKAGE_SOURCE_DIR is required" >&2; exit 2; }
	@test -n "$(PACKAGE_OUTPUT_DIR)" || { echo "PACKAGE_OUTPUT_DIR is required" >&2; exit 2; }
	@test -n "$(PACKAGE_ENTRY)" || { echo "PACKAGE_ENTRY is required" >&2; exit 2; }
	@test -n "$(PACKAGE_WASM)" || { echo "PACKAGE_WASM is required" >&2; exit 2; }
	npm run package:app -- --app-id "$(PACKAGE_APP_ID)" --source-dir "$(PACKAGE_SOURCE_DIR)" --output-dir "$(PACKAGE_OUTPUT_DIR)" --entry "$(PACKAGE_ENTRY)" --wasm "$(PACKAGE_WASM)" --pthread-worker "$(PACKAGE_PTHREAD_WORKER)" --wasm-worker "$(PACKAGE_WASM_WORKER)" --audio-worklet "$(PACKAGE_AUDIO_WORKLET)"

browser-apps: build | $(EM_CACHE)
	$(EMSDK_ENV) EMXX="$(EMXX)" node dist/src/build-browser-apps.mjs

browser-fixture-app: build | $(EM_CACHE)
	$(EMSDK_ENV) EMXX="$(EMXX)" node dist/src/build-browser-apps.mjs --manifest tests/fixtures/fake-browser-apps.json --allowed-source-root tests/fixtures/cpp --output-root dist/wasm/fixture-apps

browser-apps-run: browser-apps
	# Run from src/, not dist/src/: the server roots its static mounts at
	# <its own directory>/.., so the dist copy serves browser/dist and every
	# request 404s. playwright.config.ts starts it the same way.
	node src/static-server.mjs

browser-audio-input-test: browser-fixture-app
	npx playwright test tests/audio-input.spec.ts --workers=1

browser-apps-smoke: browser-fixture-app
	$(MAKE) browser-apps
	npm run publish:site
	npx playwright test tests/audio-input.spec.ts tests/first-party-apps-smoke.spec.ts --workers=1
	npm run check:generic-runtime

$(EM_CACHE):
	mkdir -p $@
