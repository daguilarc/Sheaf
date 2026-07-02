# apps/miniapp — placeholder scaffold app.
#
# Sets the parameters expected by runtime/juce_build.mk and includes it.
# This is a temporary placeholder (Main.cpp just returns 0); Task 6 replaces
# it with the real miniapp UI moved over from the old top-level miniapp/.
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
