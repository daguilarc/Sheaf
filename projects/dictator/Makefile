.PHONY: all build test test-core run clean ios-build ios-test

IOS_XCODEPROJ := src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj
IOS_SCHEME := DictatorKeyboardHost
IOS_SDK := iphonesimulator
IOS_DERIVED_DATA := .build/xcode

all: build test

build: swift-build ios-build

swift-build:
	swift build

ios-build:
	xcodebuild -project $(IOS_XCODEPROJ) -scheme $(IOS_SCHEME) -sdk $(IOS_SDK) -derivedDataPath $(IOS_DERIVED_DATA) CODE_SIGNING_ALLOWED=NO build

test: swift-test ios-test

swift-test:
	swift test

ios-test:
	xcodebuild -project $(IOS_XCODEPROJ) -scheme $(IOS_SCHEME) -sdk $(IOS_SDK) -derivedDataPath $(IOS_DERIVED_DATA) CODE_SIGNING_ALLOWED=NO -destination 'platform=iOS Simulator,name=iPhone 16' test

test-core:
	swift test --filter DictatorCoreTests

run:
	swift run DictatorService

clean:
	rm -rf .build .swiftpm .swiftpm-module-cache DerivedData build
