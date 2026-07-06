# apps/miniapp — the real SynthMiniapp app (Plan 3 Task 6), built on the
# shared runtime shell (runtime/Runtime.hpp, runtime/Shell.hpp,
# runtime/MainPane.hpp) rather than the bespoke JUCE app the old top-level
# miniapp/ directory used to build.
#
# Sets the parameters expected by runtime/juce_build.mk and includes it.
# APP_SOURCES is just Main.cpp: MiniApp.hpp/MiniAppCore.hpp/DemoModulation.hpp
# are all headers, pulled in transitively and picked up by juce_build.mk's
# dependency list below (so editing them still triggers a rebuild).
#
# Path anchoring: all paths (include, sources, assets) are resolved relative
# to this Makefile's directory via APP_DIR, so the build works correctly
# regardless of the caller's cwd. See juce_build.mk for SYNTH_ROOT anchoring.

APP_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

APP_NAME := SynthMiniapp
APP_BUILD_DIR := $(APP_DIR)/build
APP_SOURCES := $(APP_DIR)/Main.cpp
APP_INFO_PLIST := $(APP_DIR)/Info.plist

include $(APP_DIR)/../../runtime/juce_build.mk

# Extra header dependencies beyond juce_build.mk's SYNTH_JUCE_HEADERS glob
# (that glob only covers projects/synth/juce/*.hpp and the runtime/ headers,
# not this app's own MiniApp.hpp/MiniAppCore.hpp/DemoModulation.hpp), so a
# rebuild is triggered when any of them change.
APP_HEADERS := $(APP_DIR)/MiniApp.hpp $(APP_DIR)/MiniAppUI.hpp $(APP_DIR)/MiniAppUiModel.hpp $(APP_DIR)/MiniAppDraw.hpp $(APP_DIR)/MiniAppCore.hpp $(APP_DIR)/DemoModulation.hpp
$(APP): $(APP_HEADERS)

# EncoderComponentGeometryTests.cpp (projects/synth/juce/) is a pure-math
# test of synth_juce::EncoderComponent's angle/arc geometry helpers, but it
# still #includes EncoderComponent.hpp, which pulls in juce_gui_basics -- so
# it needs the same JUCE module objects as the app itself, not the JUCE-free
# tests under projects/synth/tests/. The old top-level miniapp/Makefile was
# the only build path for this test (grep confirms no other Makefile
# references it); this target replaces that path so the test isn't orphaned
# by miniapp/'s removal. Reuses juce_build.mk's JUCE_MODULE_OBJ/
# JUCE_C_MODULE_OBJ/CPPFLAGS/CXXFLAGS/LDFLAGS_DARWIN/BUILD_DIR/check-juce,
# set up by the include above.
GEOMETRY_TEST_SRC := $(SYNTH_ROOT)/juce/EncoderComponentGeometryTests.cpp
GEOMETRY_TEST := $(BUILD_DIR)/encoder_component_geometry_tests
PORTABLE_BACKEND_TEST_SRC := $(SYNTH_ROOT)/juce/PortableJuceBackendTests.cpp
PORTABLE_BACKEND_TEST := $(BUILD_DIR)/portable_juce_backend_tests
MINIAPP_PARITY_TEST_SRC := $(SYNTH_ROOT)/juce/MiniAppJuceBackendParityTests.cpp
MINIAPP_PARITY_TEST := $(BUILD_DIR)/miniapp_juce_backend_parity_tests
RUNTIME_PAGES_TEST_SRC := $(SYNTH_ROOT)/juce/RuntimePagesJuceTests.cpp
RUNTIME_PAGES_TEST := $(BUILD_DIR)/runtime_pages_juce_tests
FILE_PAGE_SIM_TEST_SRC := $(SYNTH_ROOT)/juce/FilePageSimulationTests.cpp
FILE_PAGE_SIM_TEST := $(BUILD_DIR)/file_page_simulation_tests
CONTROLLERS_PAGE_JUCE_TEST_SRC := $(SYNTH_ROOT)/juce/ControllersPageJuceTests.cpp
CONTROLLERS_PAGE_JUCE_TEST := $(BUILD_DIR)/controllers_page_juce_tests
CONTROLLERS_PAGE_SIM_TEST_SRC := $(SYNTH_ROOT)/juce/ControllersPageSimulationTests.cpp
CONTROLLERS_PAGE_SIM_TEST := $(BUILD_DIR)/controllers_page_simulation_tests

.PHONY: test

$(GEOMETRY_TEST): $(GEOMETRY_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(GEOMETRY_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(PORTABLE_BACKEND_TEST): $(PORTABLE_BACKEND_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(PORTABLE_BACKEND_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(MINIAPP_PARITY_TEST): $(MINIAPP_PARITY_TEST_SRC) $(APP_HEADERS) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(MINIAPP_PARITY_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(RUNTIME_PAGES_TEST): $(RUNTIME_PAGES_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(RUNTIME_PAGES_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(FILE_PAGE_SIM_TEST): $(FILE_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(FILE_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(CONTROLLERS_PAGE_JUCE_TEST): $(CONTROLLERS_PAGE_JUCE_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CONTROLLERS_PAGE_JUCE_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(CONTROLLERS_PAGE_SIM_TEST): $(CONTROLLERS_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CONTROLLERS_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

test: check-juce $(GEOMETRY_TEST) $(PORTABLE_BACKEND_TEST) $(MINIAPP_PARITY_TEST) $(RUNTIME_PAGES_TEST) $(FILE_PAGE_SIM_TEST) $(CONTROLLERS_PAGE_JUCE_TEST) $(CONTROLLERS_PAGE_SIM_TEST)
	$(GEOMETRY_TEST)
	$(PORTABLE_BACKEND_TEST)
	$(MINIAPP_PARITY_TEST)
	$(RUNTIME_PAGES_TEST)
	$(FILE_PAGE_SIM_TEST)
	$(CONTROLLERS_PAGE_JUCE_TEST)
	$(CONTROLLERS_PAGE_SIM_TEST)
