CXX ?= clang++
CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
CPPFLAGS ?= -Iinclude
BUILD_DIR := build
BUILD_SENTINEL := $(BUILD_DIR)/.dir
LIB := $(BUILD_DIR)/libsynth.a
TEST_BIN := $(BUILD_DIR)/parameter_modulation_tests
SRC := src/ParameterModulation.cpp
OBJ := $(BUILD_DIR)/ParameterModulation.o

.PHONY: all build test clean

all: build test

build: $(LIB)

$(BUILD_SENTINEL):
	mkdir -p $(BUILD_DIR)
	touch $@

$(OBJ): $(SRC) include/synth/ParameterModulation.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(LIB): $(OBJ)
	ar rcs $@ $^

$(TEST_BIN): tests/parameter_modulation_tests.cpp $(LIB)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

test: $(TEST_BIN)
	$(TEST_BIN)

clean:
	rm -rf $(BUILD_DIR)
