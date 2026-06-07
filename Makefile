MAKEFLAGS += --warn-undefined-variables

PROJECTS := conductor web quest-runner dictator

.PHONY: all clean test help
.PHONY: $(PROJECTS)
.PHONY: conductor-build conductor-test conductor-run conductor-clean
.PHONY: web-build web-test web-clean
.PHONY: quest-runner-build quest-runner-test quest-runner-run quest-runner-clean
.PHONY: dictator-build dictator-test dictator-run dictator-clean

.DEFAULT_GOAL := all

all: $(PROJECTS)

$(PROJECTS):
	$(MAKE) -C projects/$@ all

clean:
	@for project in $(PROJECTS); do \
		$(MAKE) -C projects/$$project clean; \
	done

test:
	@for project in $(PROJECTS); do \
		$(MAKE) -C projects/$$project test; \
	done

conductor-build:
	$(MAKE) -C projects/conductor build

conductor-test:
	$(MAKE) -C projects/conductor test

conductor-run:
	$(MAKE) -C projects/conductor run

conductor-clean:
	$(MAKE) -C projects/conductor clean

web-build:
	$(MAKE) -C projects/web build

web-test:
	$(MAKE) -C projects/web test

web-clean:
	$(MAKE) -C projects/web clean

quest-runner-build:
	$(MAKE) -C projects/quest-runner all

quest-runner-test:
	$(MAKE) -C projects/quest-runner test

quest-runner-run:
	$(MAKE) -C projects/quest-runner run

quest-runner-clean:
	$(MAKE) -C projects/quest-runner clean

dictator-build:
	$(MAKE) -C projects/dictator build

dictator-test:
	$(MAKE) -C projects/dictator test

dictator-run:
	$(MAKE) -C projects/dictator run

dictator-clean:
	$(MAKE) -C projects/dictator clean

help:
	@echo "Repository targets:"
	@echo "  make all              Build and test every project under projects/"
	@echo "  make test             Run tests for every project"
	@echo "  make clean            Clean every project"
	@echo ""
	@echo "Project shortcuts:"
	@echo "  make <project>        Run that project's default all target"
	@echo "  make <project>-build  Build one project"
	@echo "  make <project>-test   Test one project"
	@echo "  make <project>-run    Run one project's service (if supported)"
	@echo "  make <project>-clean  Clean one project"
	@echo ""
	@echo "Projects: $(PROJECTS)"
	@echo ""
	@echo "Examples:"
	@echo "  make conductor"
	@echo "  make conductor-build"
	@echo "  make conductor-run"
	@echo "  make conductor-clean"
	@echo ""
	@echo "See structure/makefile.md for the full Makefile layout."

# Legacy apps/ targets retained until migration into projects/ is complete.
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
