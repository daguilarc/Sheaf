.PHONY: test-server build-realtime-agent test-realtime-agent ci

test-server:
	PYTHONPATH=src .venv/bin/python -m pytest -q

build-realtime-agent:
	cd apps/realtime-agent && npm install && npm run build

test-realtime-agent:
	cd apps/realtime-agent && npm install && npm test

ci: test-server test-realtime-agent
