CXX ?= clang++
CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
CPPFLAGS ?= -Iinclude
BUILD_DIR := build
BUILD_SENTINEL := $(BUILD_DIR)/.dir
LIB := $(BUILD_DIR)/libsynth.a
TEST_BIN := $(BUILD_DIR)/parameter_modulation_tests
DSP_TEST_BIN := $(BUILD_DIR)/dsp_tests
MODULE_TEST_BIN := $(BUILD_DIR)/module_tests
INSTRUMENT_TEST_BIN := $(BUILD_DIR)/instrument_tests
CONTRACT_TEST_BIN := $(BUILD_DIR)/contract_tests
LOGGING_TEST_BIN := $(BUILD_DIR)/logging_tests
ENGINE_TEST_BIN := $(BUILD_DIR)/engine_tests
RIG_TEST_BIN := $(BUILD_DIR)/rig_tests
MINIAPP_SYSTEM_TEST_BIN := $(BUILD_DIR)/miniapp_system_tests
SRC := src/ParameterModulation.cpp src/MidiController.cpp src/PatchPersistence.cpp src/DspWavetable.cpp src/Modules.cpp
OBJ := $(BUILD_DIR)/ParameterModulation.o $(BUILD_DIR)/MidiController.o $(BUILD_DIR)/PatchPersistence.o $(BUILD_DIR)/DspWavetable.o $(BUILD_DIR)/Modules.o
DSP_HEADERS := include/synth/DspMath.hpp include/synth/DspNumbers.hpp include/synth/DspTransferFunction.hpp include/synth/DspFilters.hpp include/synth/DspScope.hpp include/synth/DspWavetable.hpp include/synth/DspOscillators.hpp
APPS_DIR := apps
MINIAPP_DIR := $(APPS_DIR)/miniapp

.PHONY: all build test miniapp apps clean

all: build test

build: $(LIB)

$(BUILD_SENTINEL):
	mkdir -p $(BUILD_DIR)
	touch $@

$(BUILD_DIR)/ParameterModulation.o: src/ParameterModulation.cpp include/synth/ParameterModulation.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/MidiController.o: src/MidiController.cpp include/synth/MidiController.hpp include/synth/ParameterModulation.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/PatchPersistence.o: src/PatchPersistence.cpp include/synth/PatchPersistence.hpp include/synth/MidiController.hpp include/synth/ParameterModulation.hpp include/synth/Json.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/DspWavetable.o: src/DspWavetable.cpp $(DSP_HEADERS) | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/Modules.o: src/Modules.cpp include/synth/Modules.hpp include/synth/ParameterModulation.hpp $(DSP_HEADERS) | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(LIB): $(OBJ)
	ar rcs $@ $^

$(TEST_BIN): tests/parameter_modulation_tests.cpp include/synth/Json.hpp include/synth/PatchPersistence.hpp $(LIB)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

$(DSP_TEST_BIN): tests/dsp_tests.cpp $(LIB) $(DSP_HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

# -Iapps/miniapp is added for this rule only: DemoModulation.hpp lives under
# apps/miniapp/ (JUCE-free), and MiniAppCore still uses its per-sample
# ProcessLite helper.
$(MODULE_TEST_BIN): tests/module_tests.cpp apps/miniapp/DemoModulation.hpp $(LIB) include/synth/Modules.hpp include/synth/ParameterModulation.hpp
	$(CXX) $(CPPFLAGS) -Iapps/miniapp $(CXXFLAGS) $< $(LIB) -o $@

$(INSTRUMENT_TEST_BIN): tests/instrument_tests.cpp $(LIB) include/synth/MidiController.hpp include/synth/ParameterModulation.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

$(CONTRACT_TEST_BIN): tests/contract_tests.cpp $(LIB) include/synth/AppContext.hpp include/synth/AppConcepts.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

$(LOGGING_TEST_BIN): tests/logging_tests.cpp $(LIB) include/synth/AsyncLogger.hpp include/synth/CircularQueue.hpp include/synth/ThreadId.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

$(ENGINE_TEST_BIN): tests/engine_tests.cpp $(LIB) include/synth/Engine.hpp include/synth/AppContext.hpp include/synth/AppConcepts.hpp include/synth/AsyncLogger.hpp include/synth/MidiController.hpp include/synth/ParameterModulation.hpp include/synth/PatchPersistence.hpp include/synth/Json.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

$(RIG_TEST_BIN): tests/rig_tests.cpp tests/support/SynthRig.hpp $(LIB) include/synth/Engine.hpp include/synth/AppContext.hpp include/synth/AppConcepts.hpp include/synth/AsyncLogger.hpp include/synth/MidiController.hpp include/synth/ParameterModulation.hpp include/synth/PatchPersistence.hpp include/synth/Json.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

# -Iapps/miniapp is added for this rule only: MiniAppCore.hpp/DemoModulation.hpp
# live under apps/miniapp/ (JUCE-free), and this is the one JUCE-free test
# binary that includes them across directories. Building this target proves
# MiniAppCore compiles and links with no JUCE include paths at all.
$(MINIAPP_SYSTEM_TEST_BIN): tests/miniapp_system_tests.cpp tests/support/SynthRig.hpp apps/miniapp/MiniAppCore.hpp apps/miniapp/DemoModulation.hpp $(LIB) include/synth/Engine.hpp include/synth/AppContext.hpp include/synth/AppConcepts.hpp include/synth/AsyncLogger.hpp include/synth/MidiController.hpp include/synth/Modules.hpp include/synth/ParameterModulation.hpp include/synth/PatchPersistence.hpp include/synth/DspScope.hpp include/synth/Json.hpp
	$(CXX) $(CPPFLAGS) -Iapps/miniapp $(CXXFLAGS) $< $(LIB) -o $@

test: $(TEST_BIN) $(DSP_TEST_BIN) $(MODULE_TEST_BIN) $(INSTRUMENT_TEST_BIN) $(CONTRACT_TEST_BIN) $(LOGGING_TEST_BIN) $(ENGINE_TEST_BIN) $(RIG_TEST_BIN) $(MINIAPP_SYSTEM_TEST_BIN)
	$(TEST_BIN)
	$(DSP_TEST_BIN)
	$(MODULE_TEST_BIN)
	$(INSTRUMENT_TEST_BIN)
	$(CONTRACT_TEST_BIN)
	$(LOGGING_TEST_BIN)
	$(ENGINE_TEST_BIN)
	$(RIG_TEST_BIN)
	$(MINIAPP_SYSTEM_TEST_BIN)

miniapp:
	$(MAKE) -C $(MINIAPP_DIR)

apps:
	$(MAKE) -C $(APPS_DIR)/miniapp

clean:
	rm -rf $(BUILD_DIR)
	if [ -f "$(MINIAPP_DIR)/Makefile" ]; then $(MAKE) -C $(MINIAPP_DIR) clean; fi
