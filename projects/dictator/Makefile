.PHONY: all build test test-core run clean ios-build ios-test install-talon-bridge

IOS_XCODEPROJ := src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj
IOS_SCHEME := DictatorKeyboardHost
IOS_SDK := iphonesimulator
IOS_DERIVED_DATA := .build/xcode
TALON_HOME ?= $(HOME)/.talon
TALON_BRIDGE_SOURCE := $(abspath src/talon/sheaf_control)
TALON_BRIDGE_TARGET := $(TALON_HOME)/user/sheaf_control

all: build test

build: swift-build

swift-build:
	swift build

ios-build:
	xcodebuild -project $(IOS_XCODEPROJ) -scheme $(IOS_SCHEME) -sdk $(IOS_SDK) -derivedDataPath $(IOS_DERIVED_DATA) CODE_SIGNING_ALLOWED=NO build

test: swift-test

swift-test:
	swift test

ios-test:
	xcodebuild -project $(IOS_XCODEPROJ) -scheme $(IOS_SCHEME) -sdk $(IOS_SDK) -derivedDataPath $(IOS_DERIVED_DATA) CODE_SIGNING_ALLOWED=NO -destination 'platform=iOS Simulator,name=iPhone 16' test

test-core:
	swift test --filter DictatorCoreTests

run:
	swift run DictatorService

install-talon-bridge:
	@mkdir -p "$(TALON_HOME)/user"
	@if [ -L "$(TALON_BRIDGE_TARGET)" ]; then \
		current=$$(readlink "$(TALON_BRIDGE_TARGET)"); \
		if [ "$$current" = "$(TALON_BRIDGE_SOURCE)" ]; then \
			echo "Talon bridge already installed: $(TALON_BRIDGE_TARGET) -> $(TALON_BRIDGE_SOURCE)"; \
		else \
			echo "Refusing to replace existing symlink: $(TALON_BRIDGE_TARGET) -> $$current"; \
			exit 1; \
		fi; \
	elif [ -e "$(TALON_BRIDGE_TARGET)" ]; then \
		echo "Refusing to replace existing path: $(TALON_BRIDGE_TARGET)"; \
		exit 1; \
	else \
		ln -s "$(TALON_BRIDGE_SOURCE)" "$(TALON_BRIDGE_TARGET)"; \
		echo "Installed Talon bridge: $(TALON_BRIDGE_TARGET) -> $(TALON_BRIDGE_SOURCE)"; \
	fi

clean:
	rm -rf .build .swiftpm .swiftpm-module-cache DerivedData build
