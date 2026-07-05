APP_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

APP_NAME := ControllersHarness
APP_BUILD_DIR := $(APP_DIR)/build
APP_SOURCES := $(APP_DIR)/../../juce/ControllersHarnessApp.cpp
APP_INFO_PLIST := $(APP_DIR)/Info.plist

include $(APP_DIR)/../../runtime/juce_build.mk
