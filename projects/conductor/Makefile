.PHONY: all install build test run clean

all: install test

install:
	npm install

build:
	npm run build

test:
	npm test

run: install build
	bash start_conductor.sh

clean:
	rm -rf dist
