EMXX ?= em++
CXXFLAGS ?= -std=c++20 -O2
CPPFLAGS := -I../include -I../apps/miniapp -Icpp
BROWSER_BUILD_DIR := wasm-build

.PHONY: build test browser-fake-app browser-miniapp

build:
	npm run build

test:
	npm test

browser-fake-app: $(BROWSER_BUILD_DIR)/fake_browser_app.wasm

browser-miniapp: $(BROWSER_BUILD_DIR)/miniapp.wasm

$(BROWSER_BUILD_DIR):
	mkdir -p $@

$(BROWSER_BUILD_DIR)/fake_browser_app.wasm: cpp/fake_app_entry.cpp cpp/FakeBrowserApp.hpp ../include/synth/browser/BrowserAppEntry.hpp | $(BROWSER_BUILD_DIR)
	$(EMXX) $(CPPFLAGS) $(CXXFLAGS) --no-entry -sSTANDALONE_WASM $< -o $@

$(BROWSER_BUILD_DIR)/miniapp.wasm: cpp/miniapp_entry.cpp ../apps/miniapp/MiniApp.hpp ../include/synth/browser/BrowserAppEntry.hpp | $(BROWSER_BUILD_DIR)
	$(EMXX) $(CPPFLAGS) $(CXXFLAGS) --no-entry -sSTANDALONE_WASM $< -o $@
