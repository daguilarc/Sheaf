# juce_build.mk — shared JUCE module build rules for Sheaf synth apps.
#
# Include this file from an app's Makefile (e.g. apps/<name>/Makefile) after
# setting the following variables:
#
#   APP_NAME        - base name of the built binary/bundle (e.g. SynthMiniapp)
#   APP_SOURCES     - app-specific .cpp sources (main entry point etc.)
#   APP_BUILD_DIR   - build output directory, must be distinct per app to
#                      avoid object-file collisions between apps
#   APP_INFO_PLIST  - path to the Info.plist to bundle
#
# Path anchoring: SYNTH_ROOT and all JUCE module paths are computed via
# $(lastword $(MAKEFILE_LIST)) on the first line below (before any further
# includes), so they resolve correctly regardless of the including Makefile's
# directory nesting or the caller's cwd. This Makefile's own abspath is used,
# not the includer's cwd. The includer should similarly anchor its own app paths.

JUCE_BUILD_MK_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
SYNTH_ROOT := $(JUCE_BUILD_MK_DIR)/..

CXX ?= clang++
JUCE_DIR ?= $(HOME)/JUCE

BUILD_DIR := $(APP_BUILD_DIR)
APP := $(BUILD_DIR)/$(APP_NAME)
APP_BUNDLE := $(BUILD_DIR)/$(APP_NAME).app
APP_BUNDLE_BINARY := $(APP_BUNDLE)/Contents/MacOS/$(APP_NAME)

SYNTH_SRC := $(SYNTH_ROOT)/src/ParameterModulation.cpp $(SYNTH_ROOT)/src/MidiController.cpp $(SYNTH_ROOT)/src/PatchPersistence.cpp $(SYNTH_ROOT)/src/DspWavetable.cpp \
	$(SYNTH_ROOT)/src/Modules.cpp $(SYNTH_ROOT)/src/MidiReconcile.cpp $(SYNTH_ROOT)/src/MidiDevicePoller.cpp $(SYNTH_ROOT)/src/MidiConfigViewModel.cpp $(SYNTH_ROOT)/src/MidiConfigBlocks.cpp
SYNTH_HEADERS := $(SYNTH_ROOT)/include/synth/ParameterModulation.hpp $(SYNTH_ROOT)/include/synth/MidiController.hpp \
	$(SYNTH_ROOT)/include/synth/Json.hpp \
	$(SYNTH_ROOT)/include/synth/Modules.hpp \
	$(SYNTH_ROOT)/include/synth/PatchPersistence.hpp \
	$(SYNTH_ROOT)/include/synth/DspMath.hpp \
	$(SYNTH_ROOT)/include/synth/DspNumbers.hpp \
	$(SYNTH_ROOT)/include/synth/DspTransferFunction.hpp \
	$(SYNTH_ROOT)/include/synth/DspFilters.hpp \
	$(SYNTH_ROOT)/include/synth/DspScope.hpp \
	$(SYNTH_ROOT)/include/synth/DspWavetable.hpp \
	$(SYNTH_ROOT)/include/synth/DspOscillators.hpp \
	$(SYNTH_ROOT)/include/synth/MidiReconcile.hpp \
	$(SYNTH_ROOT)/include/synth/MidiDevicePoller.hpp \
	$(SYNTH_ROOT)/include/synth/MidiConfigViewModel.hpp \
	$(SYNTH_ROOT)/include/synth/MidiConfigBlocks.hpp \
	$(SYNTH_ROOT)/include/synth/PortableUI.hpp \
	$(SYNTH_ROOT)/include/synth/PortableUIBuilders.hpp
SYNTH_JUCE_HEADERS := $(wildcard $(SYNTH_ROOT)/juce/*.hpp) $(SYNTH_ROOT)/runtime/Runtime.hpp $(SYNTH_ROOT)/runtime/MidiConnectionManager.hpp $(SYNTH_ROOT)/runtime/Shell.hpp $(SYNTH_ROOT)/runtime/MainPane.hpp $(SYNTH_ROOT)/runtime/AudioConfigPage.hpp $(SYNTH_ROOT)/runtime/FilePage.hpp $(SYNTH_ROOT)/runtime/ControllersPage.hpp

JUCE_MODULE_SRC := \
	$(JUCE_DIR)/modules/juce_audio_basics/juce_audio_basics.mm \
	$(JUCE_DIR)/modules/juce_audio_devices/juce_audio_devices.mm \
	$(JUCE_DIR)/modules/juce_core/juce_core.mm \
	$(JUCE_DIR)/modules/juce_core/juce_core_CompilationTime.cpp \
	$(JUCE_DIR)/modules/juce_data_structures/juce_data_structures.mm \
	$(JUCE_DIR)/modules/juce_events/juce_events.mm \
	$(JUCE_DIR)/modules/juce_graphics/juce_graphics.mm \
	$(JUCE_DIR)/modules/juce_graphics/juce_graphics_Harfbuzz.cpp \
	$(JUCE_DIR)/modules/juce_gui_basics/juce_gui_basics.mm \
	$(JUCE_DIR)/modules/juce_gui_extra/juce_gui_extra.mm
JUCE_MODULE_OBJ := \
	$(BUILD_DIR)/juce_audio_basics.o \
	$(BUILD_DIR)/juce_audio_devices.o \
	$(BUILD_DIR)/juce_core.o \
	$(BUILD_DIR)/juce_core_CompilationTime.o \
	$(BUILD_DIR)/juce_data_structures.o \
	$(BUILD_DIR)/juce_events.o \
	$(BUILD_DIR)/juce_graphics.o \
	$(BUILD_DIR)/juce_graphics_Harfbuzz.o \
	$(BUILD_DIR)/juce_gui_basics.o \
	$(BUILD_DIR)/juce_gui_extra.o
JUCE_C_MODULE_SRC := $(JUCE_DIR)/modules/juce_graphics/juce_graphics_Sheenbidi.c
JUCE_C_MODULE_OBJ := $(BUILD_DIR)/juce_graphics_Sheenbidi.o

CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
JUCE_CXXFLAGS := $(CXXFLAGS) -Wno-unused-but-set-variable
CFLAGS ?= -Wall -Wextra -O2
CPPFLAGS := -I$(SYNTH_ROOT)/include -I$(SYNTH_ROOT)/apps/miniapp -I$(SYNTH_ROOT)/juce -I$(SYNTH_ROOT)/runtime -I$(JUCE_DIR)/modules \
	-DNDEBUG \
	-DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 \
	-DJUCE_STANDALONE_APPLICATION=1 \
	-DJUCE_WEB_BROWSER=0 \
	-DJUCE_USE_CURL=0

LDFLAGS_DARWIN := -framework Cocoa -framework IOKit -framework CoreAudio -framework CoreMIDI -framework AudioToolbox -framework QuartzCore -framework Accelerate -framework Security

.PHONY: all check-juce clean

all: check-juce $(APP_BUNDLE)

check-juce:
	@test -d "$(JUCE_DIR)/modules" || (echo "JUCE checkout not found at $(JUCE_DIR). Install JUCE at ~/JUCE or set JUCE_DIR=/path/to/JUCE." && exit 1)

$(BUILD_DIR):
	mkdir -p $@

$(JUCE_C_MODULE_OBJ): $(JUCE_C_MODULE_SRC) | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_audio_basics.o: $(JUCE_DIR)/modules/juce_audio_basics/juce_audio_basics.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_audio_devices.o: $(JUCE_DIR)/modules/juce_audio_devices/juce_audio_devices.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_core.o: $(JUCE_DIR)/modules/juce_core/juce_core.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_core_CompilationTime.o: $(JUCE_DIR)/modules/juce_core/juce_core_CompilationTime.cpp | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_data_structures.o: $(JUCE_DIR)/modules/juce_data_structures/juce_data_structures.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_events.o: $(JUCE_DIR)/modules/juce_events/juce_events.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_graphics.o: $(JUCE_DIR)/modules/juce_graphics/juce_graphics.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_graphics_Harfbuzz.o: $(JUCE_DIR)/modules/juce_graphics/juce_graphics_Harfbuzz.cpp | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_gui_basics.o: $(JUCE_DIR)/modules/juce_gui_basics/juce_gui_basics.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/juce_gui_extra.o: $(JUCE_DIR)/modules/juce_gui_extra/juce_gui_extra.mm | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(JUCE_CXXFLAGS) -c $< -o $@

$(APP): $(APP_SOURCES) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(APP_SOURCES) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

$(APP_BUNDLE): $(APP) $(APP_INFO_PLIST)
	mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	cp $(APP_INFO_PLIST) "$(APP_BUNDLE)/Contents/Info.plist"
	cp "$(APP)" "$(APP_BUNDLE_BINARY)"
	touch "$(APP_BUNDLE)"

clean:
	rm -rf $(BUILD_DIR)
