# Dictator

Dictator is a Sheaf dictation service: it transcribes WAV audio, refines text through configurable LLM providers, and exposes an operational web UI plus an iOS keyboard client.

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
make build      # Swift package + iOS keyboard Xcode build
make test       # Swift package tests + iOS simulator tests
make test-core  # DictatorCore unit tests only
make run        # start DictatorService locally
```

From the Sheaf root:

```bash
make dictator-build
make dictator-test
```

## Documentation

See [docs/README.md](docs/README.md) for the full documentation index.
