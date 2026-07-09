EMXX ?= em++
CXXFLAGS ?= -std=c++20 -O2
CPPFLAGS := -I../include -I../apps/miniapp -Icpp
BROWSER_BUILD_DIR := wasm-build
CORE_SOURCES := ../src/ParameterModulation.cpp ../src/MidiController.cpp ../src/PatchPersistence.cpp ../src/DspWavetable.cpp ../src/Modules.cpp ../src/MidiReconcile.cpp ../src/MidiDevicePoller.cpp ../src/MidiConfigViewModel.cpp ../src/MidiConfigBlocks.cpp
EXPORTED_FUNCTIONS := '["_malloc","_free","_synth_browser_create","_synth_browser_initialize","_synth_browser_prepare","_synth_browser_process","_synth_browser_message_tick","_synth_browser_build_ui_frame","_synth_browser_dispatch_action","_synth_browser_destroy"]'
EXPORTED_RUNTIME_METHODS := '["stringToUTF8","lengthBytesUTF8"]'

.PHONY: build test browser-fake-app browser-miniapp

build:
	npm run build

test:
	npm test

browser-fake-app: $(BROWSER_BUILD_DIR)/fake_browser_app.js

browser-miniapp: $(BROWSER_BUILD_DIR)/miniapp.js

$(BROWSER_BUILD_DIR):
	mkdir -p $@

$(BROWSER_BUILD_DIR)/fake_browser_app.js: cpp/fake_app_entry.cpp cpp/BrowserRuntimeAbi.cpp cpp/FakeBrowserApp.hpp ../include/synth/browser/BrowserAppEntry.hpp ../include/synth/browser/BrowserRuntime.hpp ../include/synth/browser/BrowserCommandBuffer.hpp $(CORE_SOURCES) | $(BROWSER_BUILD_DIR)
	$(EMXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE_SOURCES) cpp/BrowserRuntimeAbi.cpp cpp/fake_app_entry.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sWASM_BIGINT -sEXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) -sEXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS) -o $@

$(BROWSER_BUILD_DIR)/miniapp.js: cpp/miniapp_entry.cpp ../apps/miniapp/MiniApp.hpp cpp/BrowserRuntimeAbi.cpp ../include/synth/browser/BrowserAppEntry.hpp ../include/synth/browser/BrowserRuntime.hpp ../include/synth/browser/BrowserCommandBuffer.hpp $(CORE_SOURCES) | $(BROWSER_BUILD_DIR)
	$(EMXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE_SOURCES) cpp/BrowserRuntimeAbi.cpp cpp/miniapp_entry.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sWASM_BIGINT -sEXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) -sEXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS) -o $@
