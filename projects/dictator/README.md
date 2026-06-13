# Dictator

Dictator is a Sheaf macOS dictation service: it transcribes WAV audio, refines text through configurable LLM providers, and exposes an operational web UI. The old iOS keyboard client is retained in the repo for possible revival, but it is quarantined and not part of the default build or test workflow.

## Run the service

From the Sheaf repository root:

```bash
make dictator-run
```

The service registers on port **9003** in `config/services.json`. Health check:

```bash
curl http://127.0.0.1:9003/health
```

## Entry points

| Surface | URL or command |
|---------|----------------|
| Web UI | `http://127.0.0.1:9003/` |
| Dictation API | `POST http://127.0.0.1:9003/v1/dictate-audio` |
| Shutdown | `POST http://127.0.0.1:9003/exit` |

## Build and test

From this directory:

```bash
make build      # Swift package build
make test       # Swift package tests
make test-core  # DictatorCore unit tests only
make run        # start DictatorService locally
```

From the Sheaf root:

```bash
make dictator-build
make dictator-test
```

The retained iOS keyboard app has opt-in manual lanes only:

```bash
make ios-build
make ios-test   # requires Xcode and an available iOS Simulator
```

## Documentation

See [docs/README.md](docs/README.md) for the full documentation index.
