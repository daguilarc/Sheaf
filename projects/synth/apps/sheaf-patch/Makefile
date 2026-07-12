APP_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

APP_NAME := SheafPatch
APP_BUILD_DIR := $(APP_DIR)/build
APP_SOURCES := $(APP_DIR)/Main.cpp
APP_INFO_PLIST := $(APP_DIR)/Info.plist

include $(APP_DIR)/../../runtime/juce_build.mk

MINIAPP_DIR := $(APP_DIR)/../miniapp
BRAID4_DIR := $(APP_DIR)/../braid-4
CPPFLAGS += -I$(BRAID4_DIR)
APP_HEADERS := $(APP_DIR)/Launcher.hpp \
	$(BRAID4_DIR)/Braid4Registration.hpp \
	$(BRAID4_DIR)/Braid4.hpp \
	$(BRAID4_DIR)/Braid4UI.hpp \
	$(BRAID4_DIR)/Braid4UiModel.hpp \
	$(BRAID4_DIR)/Braid4Draw.hpp \
	$(BRAID4_DIR)/Braid4Core.hpp \
	$(MINIAPP_DIR)/MiniAppRegistration.hpp \
	$(MINIAPP_DIR)/MiniApp.hpp \
	$(MINIAPP_DIR)/MiniAppUI.hpp \
	$(MINIAPP_DIR)/MiniAppUiModel.hpp \
	$(MINIAPP_DIR)/MiniAppDraw.hpp \
	$(MINIAPP_DIR)/MiniAppCore.hpp \
	$(MINIAPP_DIR)/DemoModulation.hpp
$(APP): $(APP_HEADERS)

LAUNCHER_HARNESS_TEST_SRC := $(APP_DIR)/LauncherHarnessTests.cpp
LAUNCHER_HARNESS_TEST := $(BUILD_DIR)/launcher_harness_tests

.PHONY: test

$(LAUNCHER_HARNESS_TEST): $(LAUNCHER_HARNESS_TEST_SRC) $(APP_HEADERS) $(SYNTH_SRC) $(SYNTH_RUNTIME_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(LAUNCHER_HARNESS_TEST_SRC) $(SYNTH_SRC) $(SYNTH_RUNTIME_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

test: check-juce $(LAUNCHER_HARNESS_TEST)
	$(LAUNCHER_HARNESS_TEST)
