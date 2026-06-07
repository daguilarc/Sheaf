.PHONY: all install build test clean build-agent test-agent build-vscode-extension test-vscode-extension

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

clean:
	npm run clean
