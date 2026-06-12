.PHONY: all build test install check clean
.PHONY: install-repo check-repo clean-repo
.PHONY: install-global check-global clean-global

AGENTS_INSTALL_FLAGS ?=

all: check

build: check

test: check

install:
	python3 scripts/install.py install --scope all $(AGENTS_INSTALL_FLAGS)

check:
	python3 scripts/install.py check --scope all

clean:
	python3 scripts/install.py clean --scope all

install-repo:
	python3 scripts/install.py install --scope repo $(AGENTS_INSTALL_FLAGS)

check-repo:
	python3 scripts/install.py check --scope repo

clean-repo:
	python3 scripts/install.py clean --scope repo

install-global:
	python3 scripts/install.py install --scope global $(AGENTS_INSTALL_FLAGS)

check-global:
	python3 scripts/install.py check --scope global

clean-global:
	python3 scripts/install.py clean --scope global
