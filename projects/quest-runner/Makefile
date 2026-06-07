.PHONY: all test run clean venv

VENV_DIR := .venv
PYTHON := $(VENV_DIR)/bin/python
PIP := $(VENV_DIR)/bin/pip

SRC_DIR := src
TEST_MODULES := \
	tests.test_commit_metadata \
	tests.test_normalized_state_md \
	tests.test_state_machine_core \
	tests.test_quest_fs_core \
	tests.test_harness_quest_thread_core

all: test

venv: $(VENV_DIR)/bin/python

$(VENV_DIR)/bin/python: requirements.txt
	python3 -m venv $(VENV_DIR)
	$(PIP) install -r requirements.txt

test: venv
	PYTHONPATH=$(SRC_DIR) $(PYTHON) -m unittest $(TEST_MODULES)

run:
	bash start_quest_runner.sh

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc' -delete 2>/dev/null || true
	rm -rf .pytest_cache
	find src/quest_runner_service/dashboard_assets -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
