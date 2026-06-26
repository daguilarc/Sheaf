CXX ?= clang++
CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
CPPFLAGS ?= -Iinclude
BUILD_DIR := build
BUILD_SENTINEL := $(BUILD_DIR)/.dir
LIB := $(BUILD_DIR)/libsynth.a
TEST_BIN := $(BUILD_DIR)/parameter_modulation_tests
SRC := src/ParameterModulation.cpp src/MidiController.cpp
OBJ := $(BUILD_DIR)/ParameterModulation.o $(BUILD_DIR)/MidiController.o
MINIAPP_DIR := miniapp
MINIAPP_MAKEFILE := $(MINIAPP_DIR)/Makefile

.PHONY: all build test miniapp clean

all: build test

build: $(LIB)

$(BUILD_SENTINEL):
	mkdir -p $(BUILD_DIR)
	touch $@

$(BUILD_DIR)/ParameterModulation.o: src/ParameterModulation.cpp include/synth/ParameterModulation.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(BUILD_DIR)/MidiController.o: src/MidiController.cpp include/synth/MidiController.hpp include/synth/ParameterModulation.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(LIB): $(OBJ)
	ar rcs $@ $^

$(TEST_BIN): tests/parameter_modulation_tests.cpp $(LIB)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

test: $(TEST_BIN)
	$(TEST_BIN)

miniapp:
	$(MAKE) -C $(MINIAPP_DIR)

clean:
	rm -rf $(BUILD_DIR)
	if [ -f "$(MINIAPP_MAKEFILE)" ]; then $(MAKE) -C $(MINIAPP_DIR) clean; fi
