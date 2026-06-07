.PHONY: all install build test clean build-agent test-agent build-vscode-extension test-vscode-extension run-cli

CLI := src/agent/dist/src/agent/src/cli.js

all: install test

install:
	npm install

build: build-agent build-vscode-extension

test: test-agent test-vscode-extension

build-agent:
	npm run build:agent

test-agent:
	npm run test:agent

build-vscode-extension:
	npm run build:vscode-extension

test-vscode-extension:
	npm run test:vscode-extension

run-cli:
ifndef CONTEXT_FILE
	$(error CONTEXT_FILE is required, e.g. make run-cli CONTEXT_FILE=/path/to/context.md)
endif
	node $(CLI) --context-file $(CONTEXT_FILE)

clean:
	npm run clean
