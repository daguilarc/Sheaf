EMSDK ?= $(HOME)/.local/emsdk
EMSDK_EMXX := $(EMSDK)/upstream/emscripten/em++
EMSDK_PYTHON_BIN := $(firstword $(wildcard $(EMSDK)/python/*/bin))
EMSDK_ENV = $(if $(EMSDK_PYTHON_BIN),PATH=$(EMSDK_PYTHON_BIN):$(PATH)) EM_CACHE=$(EM_CACHE)
EMXX ?= $(if $(shell command -v em++ 2>/dev/null),em++,$(if $(wildcard $(EMSDK_EMXX)),$(EMSDK_EMXX),em++))
CXXFLAGS ?= -std=c++20 -O2
CPPFLAGS := -I../include -I../apps/miniapp -Icpp
BROWSER_BUILD_DIR := dist/wasm
EM_CACHE ?= $(abspath $(BROWSER_BUILD_DIR)/emscripten-cache)
CORE_SOURCES := ../src/ParameterModulation.cpp ../src/MidiController.cpp ../src/PatchPersistence.cpp ../src/DspWavetable.cpp ../src/Modules.cpp ../src/MidiReconcile.cpp ../src/MidiDevicePoller.cpp ../src/MidiConfigViewModel.cpp ../src/MidiConfigBlocks.cpp
MINIAPP_HEADERS := ../apps/miniapp/MiniApp.hpp ../apps/miniapp/MiniAppRegistration.hpp ../apps/miniapp/MiniAppUI.hpp ../apps/miniapp/MiniAppUiModel.hpp ../apps/miniapp/MiniAppDraw.hpp ../apps/miniapp/MiniAppCore.hpp ../apps/miniapp/DemoModulation.hpp
RANDOM_LFO_HEADERS := ../include/synth/DspMath.hpp ../include/synth/DspRandomLfo.hpp ../include/synth/GangedRandomLfoVisualizer.hpp
STANDARD_MODULATOR_HEADERS := ../include/synth/StandardModulators.hpp ../include/synth/ParameterModulation.hpp ../include/synth/ConstantBarVisualizer.hpp ../include/synth/NoiseWaveformVisualizer.hpp ../include/synth/DspConstant.hpp ../include/synth/DspNoise.hpp $(RANDOM_LFO_HEADERS)
EXPORTED_FUNCTIONS := '["_malloc","_free","_synth_browser_create","_synth_browser_initialize","_synth_browser_audio_output_channels","_synth_browser_prepare","_synth_browser_process","_synth_browser_start_audio_worklet","_synth_browser_audio_worklet_block_count","_synth_browser_audio_worklet_peak_microunits","_synth_browser_audio_worklet_deadline_microunits","_synth_browser_message_tick","_synth_browser_build_ui_frame","_synth_browser_dispatch_action","_synth_browser_consume_persistence_dirty","_synth_browser_submit_midi_endpoints","_synth_browser_dequeue_midi_action","_synth_browser_deliver_midi","_synth_browser_dequeue_midi_output","_synth_browser_destroy"]'
EXPORTED_RUNTIME_METHODS := '["stringToUTF8","lengthBytesUTF8","FS","IDBFS","HEAPU8","HEAPF32"]'
# Pthreads keep the engine's existing worker-backed facilities available;
# WASM_WORKERS is required by Emscripten's Wasm AudioWorklet runtime.
PTHREAD_FLAGS := -pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=16777216 -sAUDIO_WORKLET=1 -sWASM_WORKERS=1
FILESYSTEM_FLAGS := -lidbfs.js

.PHONY: build test browser-fake-app browser-fake-app-test browser-miniapp browser-miniapp-run browser-miniapp-smoke

build:
	npm run build

test:
	npm test

browser-fake-app: $(BROWSER_BUILD_DIR)/fake_browser_app.js
	cp $(BROWSER_BUILD_DIR)/fake_browser_app.js $(BROWSER_BUILD_DIR)/app.js

browser-fake-app-test: build browser-fake-app
	npm run check:generic-runtime
	npx playwright test tests/fake-app.e2e.spec.ts

browser-miniapp: $(BROWSER_BUILD_DIR)/miniapp.js
	cp $(BROWSER_BUILD_DIR)/miniapp.js $(BROWSER_BUILD_DIR)/app.js

browser-miniapp-run: build browser-miniapp
	node src/static-server.mjs

browser-miniapp-smoke: browser-fake-app-test
	$(MAKE) browser-miniapp
	SYNTH_BROWSER_FAKE_GATE_CONFIRMED=1 npx playwright test tests/miniapp-smoke.spec.ts

$(BROWSER_BUILD_DIR) $(EM_CACHE):
	mkdir -p $@

$(BROWSER_BUILD_DIR)/fake_browser_app.js: cpp/fake_app_entry.cpp cpp/BrowserRuntimeAbi.cpp cpp/FakeBrowserApp.hpp ../include/synth/browser/BrowserAppEntry.hpp ../include/synth/browser/BrowserRuntime.hpp ../include/synth/browser/BrowserRuntimeMainServices.hpp ../include/synth/browser/BrowserAudioDevices.hpp ../include/synth/browser/BrowserCommandBuffer.hpp ../include/synth/browser/BrowserMidiBridge.hpp ../include/synth/RuntimeFileService.hpp ../include/synth/RuntimeMainComponent.hpp $(CORE_SOURCES) | $(BROWSER_BUILD_DIR) $(EM_CACHE)
	$(EMSDK_ENV) $(EMXX) $(CPPFLAGS) $(CXXFLAGS) $(PTHREAD_FLAGS) $(FILESYSTEM_FLAGS) $(CORE_SOURCES) cpp/BrowserRuntimeAbi.cpp cpp/fake_app_entry.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sWASM_BIGINT -sEXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) -sEXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS) -o $@

$(BROWSER_BUILD_DIR)/miniapp.js: cpp/miniapp_entry.cpp $(MINIAPP_HEADERS) $(STANDARD_MODULATOR_HEADERS) cpp/BrowserRuntimeAbi.cpp ../include/synth/browser/BrowserAppEntry.hpp ../include/synth/browser/BrowserRuntime.hpp ../include/synth/browser/BrowserRuntimeMainServices.hpp ../include/synth/browser/BrowserAudioDevices.hpp ../include/synth/browser/BrowserCommandBuffer.hpp ../include/synth/browser/BrowserMidiBridge.hpp ../include/synth/RuntimeFileService.hpp ../include/synth/RuntimeMainComponent.hpp $(CORE_SOURCES) | $(BROWSER_BUILD_DIR) $(EM_CACHE)
	$(EMSDK_ENV) $(EMXX) $(CPPFLAGS) $(CXXFLAGS) $(PTHREAD_FLAGS) $(FILESYSTEM_FLAGS) $(CORE_SOURCES) cpp/BrowserRuntimeAbi.cpp cpp/miniapp_entry.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sWASM_BIGINT -sEXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) -sEXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS) -o $@
