.PHONY: all install build test clean service-run

all: install test

install:
	npm install

build:
	npm run build

test:
	npm test

service-run: install build
	npm run service-run

clean:
	rm -rf dist
