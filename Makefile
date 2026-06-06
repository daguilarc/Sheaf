.PHONY: build-realtime-agent test-realtime-agent build-vscode-extension test-vscode-extension ci

build-realtime-agent:
	cd apps/realtime-agent && npm install && npm run build

test-realtime-agent:
	cd apps/realtime-agent && npm install && npm test

build-vscode-extension:
	cd apps/realtime-agent && npm install && npm run build
	cd apps/vscode-extension && npm install && npm run build

test-vscode-extension:
	cd apps/vscode-extension && npm install && npm test

ci: test-realtime-agent test-vscode-extension
