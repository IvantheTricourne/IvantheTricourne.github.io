.PHONY: build serve watch clean rebuild check

# dart-sass is not a Haskell dependency; the generator shells out to it.
SASS := $(shell command -v sass 2> /dev/null)

check:
ifndef SASS
	$(error dart-sass not found. Install it from https://sass-lang.com/install)
endif

build: check
	stack build
	stack exec site -- build

# Rebuild on change and serve on http://localhost:8000.
serve watch: check
	stack build
	stack exec site -- watch

# Drop the generated site and Hakyll's cache, then build from scratch.
# No `check` dependency: cleaning does not need dart-sass.
clean:
	stack build
	stack exec site -- clean

rebuild: check
	stack build
	stack exec site -- rebuild
