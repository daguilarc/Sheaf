EDITOR_CLI ?= cursor
VSIX := sheaf-unstaged-hunk-pane-0.0.1.vsix

.PHONY: all deps install package build test clean

all: deps test

deps:
	npm install

build: deps
	npm run build

package: build
	npx --no-install vsce package --allow-missing-repository --out $(VSIX)

install: package
	@command -v $(EDITOR_CLI) >/dev/null || { echo "EDITOR_CLI '$(EDITOR_CLI)' not found. Try: make install EDITOR_CLI=code"; exit 1; }
	$(EDITOR_CLI) --install-extension $(VSIX) --force

test: deps
	npm test

clean:
	npm run clean
