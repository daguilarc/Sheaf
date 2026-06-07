.PHONY: all build test test-core run clean

all: build test

build:
	swift build

test:
	swift test

test-core:
	swift test --filter DictatorCoreTests

run:
	swift run DictatorService

clean:
	rm -rf .build .swiftpm .swiftpm-module-cache DerivedData build
