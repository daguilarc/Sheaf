EMSDK ?= $(HOME)/.local/emsdk
EMSDK_EMXX := $(EMSDK)/upstream/emscripten/em++
EMXX ?= $(if $(shell command -v em++ 2>/dev/null),em++,$(if $(wildcard $(EMSDK_EMXX)),$(EMSDK_EMXX),em++))
CXXFLAGS ?= -std=c++20 -O2
CPPFLAGS := -I../include -I../apps/miniapp -Icpp
BROWSER_BUILD_DIR := dist/wasm
EM_CACHE ?= $(abspath $(BROWSER_BUILD_DIR)/emscripten-cache)
CORE_SOURCES := ../src/ParameterModulation.cpp ../src/MidiController.cpp ../src/PatchPersistence.cpp ../src/DspWavetable.cpp ../src/Modules.cpp ../src/MidiReconcile.cpp ../src/MidiDevicePoller.cpp ../src/MidiConfigViewModel.cpp ../src/MidiConfigBlocks.cpp
EXPORTED_FUNCTIONS := '["_malloc","_free","_synth_browser_create","_synth_browser_initialize","_synth_browser_audio_output_channels","_synth_browser_prepare","_synth_browser_process","_synth_browser_message_tick","_synth_browser_build_ui_frame","_synth_browser_dispatch_action","_synth_browser_submit_midi_endpoints","_synth_browser_dequeue_midi_action","_synth_browser_deliver_midi","_synth_browser_dequeue_midi_output","_synth_browser_destroy"]'
EXPORTED_RUNTIME_METHODS := '["stringToUTF8","lengthBytesUTF8","FS","IDBFS","HEAPU8","HEAPF32"]'
PTHREAD_FLAGS := -pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=16777216
FILESYSTEM_FLAGS := -lidbfs.js

.PHONY: build test browser-fake-app browser-fake-app-test browser-miniapp browser-miniapp-run browser-miniapp-smoke

build:
	npm run build

test:
	npm test

browser-fake-app: $(BROWSER_BUILD_DIR)/fake_browser_app.js

browser-fake-app-test: build browser-fake-app
	npm run check:generic-runtime
	npx playwright test tests/fake-app.e2e.spec.ts

browser-miniapp: $(BROWSER_BUILD_DIR)/miniapp.js

browser-miniapp-run: build browser-miniapp
	node src/static-server.mjs

browser-miniapp-smoke: browser-fake-app-test
	$(MAKE) browser-miniapp
	SYNTH_BROWSER_FAKE_GATE_CONFIRMED=1 npx playwright test tests/miniapp-smoke.spec.ts

$(BROWSER_BUILD_DIR) $(EM_CACHE):
	mkdir -p $@

$(BROWSER_BUILD_DIR)/fake_browser_app.js: cpp/fake_app_entry.cpp cpp/BrowserRuntimeAbi.cpp cpp/FakeBrowserApp.hpp ../include/synth/browser/BrowserAppEntry.hpp ../include/synth/browser/BrowserRuntime.hpp ../include/synth/browser/BrowserCommandBuffer.hpp ../include/synth/browser/BrowserMidiBridge.hpp $(CORE_SOURCES) | $(BROWSER_BUILD_DIR) $(EM_CACHE)
	EM_CACHE=$(EM_CACHE) $(EMXX) $(CPPFLAGS) $(CXXFLAGS) $(PTHREAD_FLAGS) $(FILESYSTEM_FLAGS) $(CORE_SOURCES) cpp/BrowserRuntimeAbi.cpp cpp/fake_app_entry.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sWASM_BIGINT -sEXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) -sEXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS) -o $@
	cp $@ $(BROWSER_BUILD_DIR)/app.js

$(BROWSER_BUILD_DIR)/miniapp.js: cpp/miniapp_entry.cpp ../apps/miniapp/MiniApp.hpp cpp/BrowserRuntimeAbi.cpp ../include/synth/browser/BrowserAppEntry.hpp ../include/synth/browser/BrowserRuntime.hpp ../include/synth/browser/BrowserCommandBuffer.hpp ../include/synth/browser/BrowserMidiBridge.hpp $(CORE_SOURCES) | $(BROWSER_BUILD_DIR) $(EM_CACHE)
	EM_CACHE=$(EM_CACHE) $(EMXX) $(CPPFLAGS) $(CXXFLAGS) $(PTHREAD_FLAGS) $(FILESYSTEM_FLAGS) $(CORE_SOURCES) cpp/BrowserRuntimeAbi.cpp cpp/miniapp_entry.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sWASM_BIGINT -sEXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) -sEXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS) -o $@
	cp $@ $(BROWSER_BUILD_DIR)/app.js
